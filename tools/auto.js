/* 自动配平：三条线各自扫参数逼近 25%，第四条由「四条线总和≈100%」自动收敛
   用法：node auto.js <人数> [每档局数] [起始JSON]
*/
const fs = require('fs');
const path = require('path');
const E = require(path.join(__dirname, '..', 'js', 'engine.js'));
const AI = require(path.join(__dirname, '..', 'js', 'ai.js'));

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'cards.json'), 'utf8'));
const cards = data.cards;
const NPLAYERS = parseInt(process.argv[2] || '2', 10);
const GAMES = parseInt(process.argv[3] || '240', 10);
const TARGET = 25;

const base = E.BALANCE[NPLAYERS];
let P = {
  fameTarget: base.fame, schoolTarget: base.schools,
  themeSize: base.themeSize, themeEras: base.themeEras,
  eraDoubleSegs: base.doubles, eraMinCards: base.minCards, eraMinGroups: base.groups
};
if (process.argv[4]) Object.assign(P, JSON.parse(process.argv[4]));

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
  return g.state.winBy;
}

function measure(cfg, games) {
  const by = {};
  for (let i = 0; i < games; i++) {
    const w = runOne(9000 + i * 37, cfg);
    by[w] = (by[w] || 0) + 1;
  }
  const p = k => 100 * (by[k] || 0) / games;
  return { fame: p('fame'), eras: p('eras'), schools: p('schools'), themes: p('themes'), timeout: p('timeout') };
}

/** 在 [lo,hi] 区间线性扫描整数，取最接近 25 的值；同分取超时低的 */
function scan(key, lo, hi, line) {
  let best = null;
  for (let v = lo; v <= hi; v++) {
    const trial = Object.assign({}, P, { [key]: v });
    const m = measure(trial, GAMES);
    const dev = Math.abs(m[line] - TARGET);
    const score = dev + 0.35 * Math.max(0, m.timeout - 4);
    if (!best || score < best.score) best = { v, score, m, dev };
  }
  P[key] = best.v;
  return best;
}

function show(tag) {
  const m = measure(P, GAMES);
  console.log(`${tag}  声名 ${m.fame.toFixed(1)} 通史 ${m.eras.toFixed(1)} 立派 ${m.schools.toFixed(1)} 成题 ${m.themes.toFixed(1)} | 超时 ${m.timeout.toFixed(1)}`);
  return m;
}

console.log(`[${NPLAYERS}人] 起点 ` + JSON.stringify(P));
show('   起点');

for (let round = 1; round <= 3; round++) {
  let a = scan('fameTarget', 34, 60, 'fame');
  console.log(`  第${round}轮 声名目标→${a.v}（声名 ${a.m.fame.toFixed(1)}%）`);
  let b = scan('eraDoubleSegs', 1, 5, 'eras');
  let c = scan('eraMinCards', 8, 12, 'eras');
  console.log(`  第${round}轮 通史→双收${b.v}段 / ${c.v}张（通史 ${c.m.eras.toFixed(1)}%，超时 ${c.m.timeout.toFixed(1)}%）`);
  let d = scan('themeSize', 5, 9, 'themes');
  let e = scan('themeEras', 2, 5, 'themes');
  console.log(`  第${round}轮 成题→${d.v}首跨${e.v}代（成题 ${e.m.themes.toFixed(1)}%）`);
  show('   现状');
}

const fin = measure(P, Math.max(GAMES * 3, 600));
console.log('\n[最终] ' + JSON.stringify(P));
console.log(`  声名 ${fin.fame.toFixed(1)} / 通史 ${fin.eras.toFixed(1)} / 立派 ${fin.schools.toFixed(1)} / 成题 ${fin.themes.toFixed(1)} | 超时 ${fin.timeout.toFixed(1)}`);
console.log(`BALANCE[${NPLAYERS}] = { fame: ${P.fameTarget}, eras: 6, schools: ${P.schoolTarget}, themeSize: ${P.themeSize}, themeEras: ${P.themeEras}, groups: ${P.eraMinGroups}, minCards: ${P.eraMinCards}, doubles: ${P.eraDoubleSegs} }`);
