/* 达成轮次期望（Expected Rounds to Done）
   对每条终点线：让所有玩家都只盯这一条线打，记录「第一个达成」的轮次。
   四个期望值越接近，四条线的实际难度就越接近。
   用法：
     node erd.js <人数> <局数> ['{"fameTarget":..}']
     node erd.js 2 200 --curve        # 每条线的参数-期望曲线
*/
const fs = require('fs');
const path = require('path');
const E = require(path.join(__dirname, '..', 'js', 'engine.js'));
const AI = require(path.join(__dirname, '..', 'js', 'ai.js'));

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'cards.json'), 'utf8'));
const cards = data.cards;
const NPLAYERS = parseInt(process.argv[2] || '2', 10);
const GAMES = parseInt(process.argv[3] || '200', 10);
const ARG4 = process.argv[4] || '{}';
const CURVE = ARG4 === '--curve';

const base = E.BALANCE[NPLAYERS];
let P = {
  fameTarget: base.fame, schoolTarget: base.schools,
  themeSize: base.themeSize, themeEras: base.themeEras,
  eraDoubleSegs: base.doubles, eraMinCards: base.minCards, eraMinGroups: base.groups
};
if (!CURVE) Object.assign(P, JSON.parse(ARG4));

const LINES = ['fame', 'eras', 'schools', 'themes'];

function done(pg, line) {
  if (line === 'fame') return pg.fame.now >= pg.fame.target;
  if (line === 'eras') return pg.eras.ok;
  if (line === 'schools') return pg.schools.now >= pg.schools.target;
  return pg.themes.now >= pg.themes.target;
}

/** 返回 {rounds, done, waste}：done=false 时 waste 是「谱打满/终局」的轮次 */
function oneRun(seed, cfg, line) {
  const roster = [];
  for (let i = 0; i < NPLAYERS; i++) roster.push({ name: 'P' + i, isAI: true });
  const g = new E.Game(cards, { seed, eraCount: 6, players: roster, config: cfg });
  let guard = 0;
  while (!g.state.over && guard++ < 500) {
    const cur = g.state.current;
    const step = AI.decide(g, cur, 'normal', line);
    if (step.type === 'place') {
      const r = g.place(step.cardId, cur);
      if (!r.ok) g.gather(cur);
    } else g.gather(cur);

    // 先判达成，再看终局：达成的那一手会同时把 over 置真
    for (const p of g.state.players) {
      if (p.hand.length && done(E.progress(p, g.config), line)) {
        return { rounds: g.state.round, done: true, hand: p.hand.length };
      }
    }
    if (g.state.over) break;
    g.endTurn();
  }
  return { rounds: null, done: false, waste: g.state.round, hand: g.config.handLimit };
}

function measure(cfg, line, games) {
  let sum = 0, ok = 0, hands = 0, total = 0;
  for (let i = 0; i < games; i++) {
    const r = oneRun(9000 + i * 37, cfg, line);
    if (r.done) { sum += r.rounds; ok++; hands += r.hand; total += r.rounds; }
    // 失败按「谱打满的轮次 + 8」计：不但白花这些轮，还输掉整局
    else total += Math.max(r.waste, 10) + 8;
  }
  return {
    avg: ok ? sum / ok : null,
    expect: total / games,          // 含失败的期望（越小越容易）
    rate: 100 * ok / games,
    hand: ok ? hands / ok : null
  };
}

if (CURVE) {
  for (const line of LINES) {
    console.log('\n=== ' + line + ' ===');
    const ranges = {
      fame: ['fameTarget', [36, 40, 44, 46, 48, 50, 52, 56, 60]],
      eras: ['eraDoubleSegs', [2, 3, 4, 5]],
      schools: ['schoolTarget', [3, 4, 5, 6, 7]],
      themes: ['themeSize', [5, 6, 7, 8, 9]]
    }[line];
    for (const v of ranges[1]) {
      const cfg = Object.assign({}, P, { [ranges[0]]: v });
      const m = measure(cfg, line, 120);
      console.log(`  ${ranges[0]}=${v}\t成功期望 ${m.avg == null ? '—' : m.avg.toFixed(2)}\t含失败 ${m.expect.toFixed(2)} 轮\t达成率 ${m.rate.toFixed(0)}%\t用牌 ${m.hand == null ? '—' : m.hand.toFixed(1)}`);
    }
  }
  process.exit(0);
}

console.log(`[${NPLAYERS}人] ` + JSON.stringify(P));
const rows = {};
for (const line of LINES) {
  const m = measure(P, line, GAMES);
  rows[line] = m;
  console.log(`  ${line.padEnd(8)} 含失败期望 ${m.expect.toFixed(2)} 轮   成功 ${m.avg == null ? '—' : m.avg.toFixed(2)} 轮   达成率 ${m.rate.toFixed(0)}%   用牌 ${m.hand == null ? '—' : m.hand.toFixed(1)}`);
}
const vals = LINES.map(l => rows[l].expect);
const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
console.log(`  四线均值 ${mean.toFixed(2)} 轮   最大偏差 ${Math.max(...vals.map(v => Math.abs(v - mean))).toFixed(2)} 轮`);
