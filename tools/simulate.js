/* 平衡性模拟：AI 互搏若干局，统计三条终点线的可达性
   用法：node simulate.js [局数]
*/
const fs = require('fs');
const path = require('path');
const E = require(path.join(__dirname, '..', 'js', 'engine.js'));
const AI = require(path.join(__dirname, '..', 'js', 'ai.js'));

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'cards.json'), 'utf8'));
const cards = data.cards;
const N = parseInt(process.argv[2] || '400', 10);
const NPLAYERS = parseInt(process.argv[3] || '2', 10);

function runOne(seed, diffA, diffB) {
  const g = new E.Game(cards, { seed, eraCount: 6, players: [
    { name: 'P0', isAI: true }, { name: 'P1', isAI: true },
    ...(NPLAYERS > 2 ? [{ name: 'P2', isAI: true }] : []),
    ...(NPLAYERS > 3 ? [{ name: 'P3', isAI: true }] : [])
  ] });
  let guard = 0;
  while (!g.state.over && guard++ < 400) {
    const cur = g.state.current;
    const diff = cur === 0 ? diffA : diffB;
    const step = AI.decide(g, cur, diff);
    if (step.type === 'place') {
      const r = g.place(step.cardId, cur);
      if (!r.ok) g.gather(cur);
    } else {
      g.gather(cur);
    }
    if (g.state.over) break;
    g.endTurn();
  }
  const ps = g.state.players;
  return {
    winner: g.state.winner, winBy: g.state.winBy, round: g.state.round,
    fame: ps.map(p => p.fame), cards: ps.map(p => p.hand.length),
    winFame: g.state.winner == null ? 0 : g.state.players[g.state.winner].fame
  };
}

function stat(arr) {
  const s = arr.slice().sort((x, y) => x - y);
  const avg = s.reduce((x, y) => x + y, 0) / s.length;
  return { avg: +avg.toFixed(2), min: s[0], p50: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
}

function batch(diffA, diffB, n) {
  const res = [];
  for (let i = 0; i < n; i++) res.push(runOne(9000 + i * 37, diffA, diffB));
  const byWin = {};
  res.forEach(r => { byWin[r.winBy] = (byWin[r.winBy] || 0) + 1; });
  const winnerCount = new Array(NPLAYERS).fill(0);
  res.forEach(r => { if (r.winner != null) winnerCount[r.winner]++; });
  return {
    label: `${diffA} vs ${diffB}`,
    n,
    winBy: Object.fromEntries(Object.entries(byWin).map(([k, v]) => [k, +(100 * v / n).toFixed(1) + '%'])),
    win: winnerCount.map(x => +(100 * x / n).toFixed(1) + '%'),
    rounds: stat(res.map(r => r.round)),
    handSize: stat(res.map(r => Math.max(...r.cards))),
    winFame: stat(res.filter(r => r.winBy === 'fame').map(r => r.winFame))
  };
}

console.log('卡片总数', cards.length, '| 局数', N);
console.log(JSON.stringify(batch('normal', 'normal', N), null, 1));
console.log(JSON.stringify(batch('hard', 'normal', N), null, 1));
console.log(JSON.stringify(batch('easy', 'normal', Math.floor(N / 2)), null, 1));
