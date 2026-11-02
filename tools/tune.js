/* 参数搜索：让「声名/通史/立派/成题」四条线胜率都贴近 25%
   用法：
     node tune.js <人数> [每档局数]
   会做坐标下降（逐个旋钮试 ±1），最后打印最优参数与四条线分布。
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
    } else {
      g.gather(cur);
    }
    if (g.state.over) break;
    g.endTurn();
  }
  return { winBy: g.state.winBy, round: g.state.round };
}

function measure(cfg, games) {
  const by = { fame: 0, eras: 0, schools: 0, themes: 0, timeout: 0 };
  let rounds = 0;
  for (let i = 0; i < games; i++) {
    const r = runOne(9000 + i * 37, cfg);
    by[r.winBy] = (by[r.winBy] || 0) + 1;
    rounds += r.round;
  }
  const pct = k => 100 * (by[k] || 0) / games;
  return {
    fame: pct('fame'), eras: pct('eras'), schools: pct('schools'),
    themes: pct('themes'), timeout: pct('timeout'), rounds: rounds / games
  };
}

function cost(m) {
  const dev = ['fame', 'eras', 'schools', 'themes']
    .reduce((s, k) => s + Math.pow(m[k] - TARGET, 2), 0);
  // 超时率高说明四条线都做不到，加罚
  return dev + 6 * Math.pow(Math.max(0, m.timeout - 5), 1.5);
}

const KNOBS = [
  { key: 'fameTarget', step: 1, min: 30, max: 70 },
  { key: 'schoolTarget', step: 1, min: 3, max: 8 },
  { key: 'themeSize', step: 1, min: 4, max: 10 },
  { key: 'themeEras', step: 1, min: 2, max: 6 },
  { key: 'eraDoubleSegs', step: 1, min: 1, max: 6 },
  { key: 'eraMinCards', step: 1, min: 9, max: 12 },
  { key: 'eraMinGroups', step: 1, min: 2, max: 4 }
];

// 以当前 BALANCE 为起点
const base = E.BALANCE[NPLAYERS];
let best = {
  fameTarget: base.fame, schoolTarget: base.schools,
  themeSize: base.themeSize, themeEras: base.themeEras,
  eraDoubleSegs: base.doubles, eraMinCards: base.minCards, eraMinGroups: base.groups
};

if (process.argv[4]) Object.assign(best, JSON.parse(process.argv[4]));
let bestM = measure(best, GAMES);
console.log(`[起点] ${JSON.stringify(best)}`);
console.log(`   -> 声名 ${bestM.fame.toFixed(1)} / 通史 ${bestM.eras.toFixed(1)} / 立派 ${bestM.schools.toFixed(1)} / 成题 ${bestM.themes.toFixed(1)} | 超时 ${bestM.timeout.toFixed(1)} | 轮 ${bestM.rounds.toFixed(2)} | cost ${cost(bestM).toFixed(1)}`);

for (let pass = 0; pass < 6; pass++) {
  let improved = false;
  for (const k of KNOBS) {
    for (const d of [1, -1]) {
      const v = best[k.key] + d * k.step;
      if (v < k.min || v > k.max) continue;
      const trial = Object.assign({}, best, { [k.key]: v });
      const m = measure(trial, GAMES);
      const c = cost(m);
      if (c + 0.15 < cost(bestM)) {
        console.log(`[第${pass + 1}轮] ${k.key} ${best[k.key]}→${v}  cost ${cost(bestM).toFixed(1)}→${c.toFixed(1)}  声名 ${m.fame.toFixed(1)} 通史 ${m.eras.toFixed(1)} 立派 ${m.schools.toFixed(1)} 成题 ${m.themes.toFixed(1)} 超时 ${m.timeout.toFixed(1)}`);
        best = trial; bestM = m; improved = true;
      }
    }
  }
  if (!improved) break;
}

console.log('\n[最优] ' + JSON.stringify(best));
const fin = measure(best, Math.max(GAMES * 2, 600));
console.log(`   -> 声名 ${fin.fame.toFixed(1)} / 通史 ${fin.eras.toFixed(1)} / 立派 ${fin.schools.toFixed(1)} / 成题 ${fin.themes.toFixed(1)} | 超时 ${fin.timeout.toFixed(1)} | 轮 ${fin.rounds.toFixed(2)}`);
console.log('BALANCE[' + NPLAYERS + '] = { fame: ' + best.fameTarget + ', eras: 6, schools: ' +
  best.schoolTarget + ', themeSize: ' + best.themeSize + ', themeEras: ' + best.themeEras +
  ', groups: ' + best.eraMinGroups + ', minCards: ' + best.eraMinCards + ', doubles: ' + best.eraDoubleSegs + ' }');
