/* 参数扫描：找出三条终点线最均衡的立派参数
   用法：node scan.js
*/
const fs = require('fs');
const path = require('path');
const E = require(path.join(__dirname, '..', 'js', 'engine.js'));
const AI = require(path.join(__dirname, '..', 'js', 'ai.js'));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'cards.json'), 'utf8'));
const cards = data.cards;

function trial(config, n, seedBase) {
  const by = {}; let sumRound = 0, sumHand = 0;
  for (let i = 0; i < n; i++) {
    const g = new E.Game(cards, { seed: seedBase + i * 91, eraCount: 6, config });
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
    by[g.state.winBy] = (by[g.state.winBy] || 0) + 1;
    sumRound += g.state.round;
    sumHand += Math.max(g.state.players[0].hand.length, g.state.players[1].hand.length);
  }
  const pct = k => +((100 * (by[k] || 0)) / n).toFixed(1);
  return {
    fame: pct('fame'), eras: pct('eras'), schools: pct('schools'), themes: pct('themes'), timeout: pct('timeout'),
    rounds: +(sumRound / n).toFixed(2), hand: +(sumHand / n).toFixed(2)
  };
}

const variants = [
  { label: '均衡 f26 t3e3 s3', cfg: { fameTarget: 26, themeSize: 3, themeEras: 3, schoolTarget: 3, schoolExclusive: false } },
  { label: '随机 f26 t3e3 s3', cfg: { balancedDraw: false, fameTarget: 26, themeSize: 3, themeEras: 3, schoolTarget: 3, schoolExclusive: false } },
  { label: '随机 f26 t3e3 s2', cfg: { balancedDraw: false, fameTarget: 26, themeSize: 3, themeEras: 3, schoolTarget: 2 } },
  { label: '随机 f28 t3e3 s3', cfg: { balancedDraw: false, fameTarget: 28, themeSize: 3, themeEras: 3, schoolTarget: 3, schoolExclusive: false } },
  { label: '随机 f26 t3e2 s3', cfg: { balancedDraw: false, fameTarget: 26, themeSize: 3, themeEras: 2, schoolTarget: 3, schoolExclusive: false } },
];
console.log('当前（排他）配置下：');
variants.forEach(v => {
  console.log(v.label.padEnd(20), JSON.stringify(trial(v.cfg, 120, 5000)));
});
