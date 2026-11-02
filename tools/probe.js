/* 单点测量：node probe.js <人数> <局数> '{"fameTarget":45,...}'
   可一次传多组（用 ; 分隔），并排比较。 */
const fs = require('fs');
const path = require('path');
const E = require(path.join(__dirname, '..', 'js', 'engine.js'));
const AI = require(path.join(__dirname, '..', 'js', 'ai.js'));

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'cards.json'), 'utf8'));
const cards = data.cards;
const NPLAYERS = parseInt(process.argv[2] || '2', 10);
const GAMES = parseInt(process.argv[3] || '300', 10);
const SPECS = (process.argv[4] || '{}').split(';').filter(Boolean);

function runOne(seed, cfg) {
  const roster = [];
  for (let i = 0; i < NPLAYERS; i++) roster.push({ name: 'P' + i, isAI: true });
  const g = new E.Game(cards, { seed, eraCount: 6, players: roster, config: cfg });
  let guard = 0;
  while (!g.state.over && guard++ < 400) {
    const cur = g.state.current;
    const step = AI.decide(g, cur, 'normal');
    if (step.type === 'place') {
      const r = g.place(step.cardId, cur);
      if (!r.ok) g.gather(cur);
    } else g.gather(cur);
    if (g.state.over) break;
    g.endTurn();
  }
  return { winBy: g.state.winBy, round: g.state.round };
}

for (const spec of SPECS) {
  const cfg = JSON.parse(spec);
  const by = {};
  let rounds = 0;
  for (let i = 0; i < GAMES; i++) {
    const r = runOne(9000 + i * 37, cfg);
    by[r.winBy] = (by[r.winBy] || 0) + 1;
    rounds += r.round;
  }
  const p = k => (100 * (by[k] || 0) / GAMES).toFixed(1);
  const spread = ['fame', 'eras', 'schools', 'themes'].map(k => Math.abs(+p(k) - 25));
  console.log(`${spec}\n   声名 ${p('fame')} / 通史 ${p('eras')} / 立派 ${p('schools')} / 成题 ${p('themes')} | 超时 ${p('timeout')} | 轮 ${(rounds / GAMES).toFixed(2)} | 最大偏差 ${Math.max(...spread).toFixed(1)}`);
}
