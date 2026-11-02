/* 棋局（第二局）的无界面模拟器：与 js/board.js 同规则，用来配平「声名目标 / 卷数」
   用法：
     node sim_board.js <人数> <局数> [fameTarget] [laps]
   输出：胜者来源、圈数、声名、回合数分布
*/
const fs = require('fs');
const path = require('path');
const E = require(path.join(__dirname, '..', 'js', 'engine.js'));

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'cards.json'), 'utf8'));
const cards = data.cards;
const erasMeta = (data.meta && data.meta.eras) || [];

const N = parseInt(process.argv[2] || '2', 10);
const GAMES = parseInt(process.argv[3] || '200', 10);
const FAME = parseInt(process.argv[4] || '48', 10);
const LAPS = parseInt(process.argv[5] || '2', 10);

const B = {
  size: 49, perEra: 8, laps: LAPS, fameTarget: FAME,
  startInk: 2, income: 1, passGain: 3, groupSize: 3, groupBonus: 4,
  maxToll: 3, debtPenalty: 1, startBonus: 2, handLimit: 0,
  tollPerLap: 1, tollLapCap: 2
};

const CHANCE = [
  { ink: 3 }, { ink: 4 }, { fame: 2 }, { fame: 3 }, { ink: 2, fame: 1 },
  { move: 3 }, { move: 2, ink: 2 }, { free: true }, { ink: 5 }, { fame: 4 }
];
const FATE = [
  { fame: -2 }, { fame: -3 }, { ink: -3 }, { move: -3 }, { ink: -2, fame: -1 },
  { skip: true }, { fame: 1 }, { ink: 3 }, { fame: 2 }, { ink: 2, fame: -1 }
];

function buildBoard(rnd) {
  const byEra = {};
  cards.forEach(c => { (byEra[c.era] = byEra[c.era] || []).push(c); });
  Object.keys(byEra).forEach(k => E.shuffle(byEra[k], rnd));
  const cells = [{ i: 0, era: -1, kind: 'start', card: null, owner: null, isStart: false, revealed: true }];
  let idx = 1;
  erasMeta.forEach((e, ei) => {
    const pool = byEra[ei] || [];
    for (let j = 0; j < B.perEra; j++) {
      let kind, card = null;
      if (j === B.perEra - 1) kind = (ei % 2 === 0) ? 'chance' : 'fate';
      else { kind = 'song'; card = pool.length ? pool.pop() : null; }
      cells.push({ i: idx++, era: ei, kind, card, owner: null, isStart: j === 0, revealed: false });
    }
  });
  return cells;
}

function makePlayers(n) {
  return Array.from({ length: n }, (_, i) => ({
    idx: i, pos: -1, ink: B.startInk + i, fame: i * 2, hand: [], lap: 0,
    rewarded: {}, freeNext: false, skipTurn: false
  }));
}

function countDim(cells, idx, dim, val) {
  let n = 0;
  cells.forEach(c => {
    if (c.owner !== idx || !c.card) return;
    if (dim === 'era' && c.era === val) n++;
    else if (dim === 'type' && c.card.typeGroup === val) n++;
    else if (dim === 'staff' && E.creatorsOf(c.card).indexOf(val) >= 0) n++;
  });
  return n;
}

function tollOf(cells, cell, owner) {
  const counts = [countDim(cells, owner, 'era', cell.era)];
  if (cell.card) {
    counts.push(countDim(cells, owner, 'type', cell.card.typeGroup));
    E.creatorsOf(cell.card).forEach(v => counts.push(countDim(cells, owner, 'staff', v)));
  }
  return Math.max(1, Math.min(B.maxToll, Math.max.apply(null, counts)));
}

function checkGroups(cells, p) {
  const tally = {};
  cells.forEach(c => {
    if (c.owner !== p.idx || !c.card) return;
    tally['era:' + c.era] = (tally['era:' + c.era] || 0) + 1;
    tally['type:' + c.card.typeGroup] = (tally['type:' + c.card.typeGroup] || 0) + 1;
    E.creatorsOf(c.card).forEach(v => { tally['staff:' + v] = (tally['staff:' + v] || 0) + 1; });
  });
  Object.keys(tally).forEach(k => {
    if (tally[k] < B.groupSize || p.rewarded[k]) return;
    p.rewarded[k] = true;
    p.fame += B.groupBonus;
  });
}

/** 与 board.js 的 groupScore 同口径 */
function groupScore(cells, p, card, cell) {
  const vals = [{ dim: 'era', v: cell.era }, { dim: 'type', v: card.typeGroup }];
  E.creatorsOf(card).forEach(v => vals.push({ dim: 'staff', v }));
  let s = 0;
  vals.forEach(x => {
    const c = countDim(cells, p.idx, x.dim, x.v);
    if (c + 1 >= B.groupSize) s += 5.5;
    else if (c + 1 === B.groupSize - 1) s += 2.2;
    else s += c * 0.35;
  });
  return s;
}

function runOne(seed) {
  const rnd = E.mulberry32(seed);
  const cells = buildBoard(rnd);
  const players = makePlayers(N);
  let turn = 0, chanceIdx = 0, fateIdx = 0, guard = 0;
  let winner = null, winBy = null;
  let firstTurn = true;

  while (guard++ < 900) {
    const p = players[turn];
    // 开局第一手不领回合墨（起手墨已给），其余每手上手先得 1 墨
    if (!firstTurn) p.ink += B.income;
    firstTurn = false;

    if (p.skipTurn) { p.skipTurn = false; turn = (turn + 1) % N; continue; }

    const d = 1 + Math.floor(rnd() * 6);
    if (p.pos < 0) p.pos = d - 1;
    else {
      const np = p.pos + d;
      if (np >= B.size) {
        p.lap++;
        p.fame += B.passGain;
        if (p.lap >= B.laps) { winner = p.idx; winBy = 'laps'; break; }
      }
      p.pos = np % B.size;
    }

    const c = cells[p.pos];
    c.revealed = true;

    if (c.kind === 'start') {
      p.fame += B.startBonus;
    } else if (c.kind === 'chance' || c.kind === 'fate') {
      const deck = c.kind === 'chance' ? CHANCE : FATE;
      const ci = c.kind === 'chance' ? chanceIdx : fateIdx;
      const card = deck[ci % deck.length];
      if (c.kind === 'chance') chanceIdx = (ci + 1) % deck.length;
      else fateIdx = (ci + 1) % deck.length;
      p.ink = Math.max(0, p.ink + (card.ink || 0));
      p.fame = Math.max(0, p.fame + (card.fame || 0));
      if (card.free) p.freeNext = true;
      if (card.skip) p.skipTurn = true;
      if (card.move) p.pos = (p.pos + card.move + B.size) % B.size;
    } else if (c.card) {
      if (c.isStart) p.fame += 1;
      if (c.owner === p.idx) {
        /* 自己的地，无变化 */
      } else if (c.owner != null) {
        const fee = tollOf(cells, c, c.owner) + Math.min(B.tollLapCap, p.lap * B.tollPerLap);
        if (p.ink >= fee) { p.ink -= fee; players[c.owner].fame += fee; }
        else p.fame = Math.max(0, p.fame - B.debtPenalty);
      } else {
        const ev = E.evaluate(c.card, p.hand, false);
        const cost = p.freeNext ? 0 : ev.cost;
        const gs = groupScore(cells, p, c.card, c);
        const worth = ev.fame / Math.max(1, cost);
        const good = gs >= 2.0 || ev.fame >= 5 || worth >= 2.2;
        const buyIt = (!B.handLimit || p.hand.length < B.handLimit) && (good || p.ink >= 8);
        if (buyIt && p.ink >= cost) {
          p.ink -= cost;
          if (p.freeNext) p.freeNext = false;
          p.fame += ev.fame;
          p.hand.push(c.card);
          c.owner = p.idx;
          checkGroups(cells, p);
        }
      }
    }

    if (p.fame >= B.fameTarget) { winner = p.idx; winBy = 'fame'; break; }
    turn = (turn + 1) % N;
  }

  if (winner == null) {
    // 保险：跑太久按声名判
    const best = players.slice().sort((a, b) => b.fame - a.fame)[0];
    winner = best.idx; winBy = 'stall';
  }
  return {
    winBy, laps: players.map(x => x.lap), fame: players.map(x => x.fame),
    turn: guard, hand: players.map(x => x.hand.length)
  };
}

const res = [];
for (let i = 0; i < GAMES; i++) res.push(runOne(7000 + i * 53));

const pct = k => (100 * res.filter(r => r.winBy === k).length / res.length).toFixed(1) + '%';
const avg = a => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
const winFame = res.map(r => Math.max(...r.fame));
console.log(`[${N}人] 目标 ${FAME} 声名 / ${LAPS} 卷`);
console.log('  终局方式：' + JSON.stringify({ fame: pct('fame'), laps: pct('laps'), stall: pct('stall') }));
console.log('  平均圈数 ' + avg(res.map(r => Math.max(...r.laps))) + '　平均回合 ' + avg(res.map(r => r.turn)));
const fames = res.map(r => Math.max(...r.fame)).sort((a, b) => a - b);
const q = t => fames[Math.min(fames.length - 1, Math.floor(t * fames.length))];
console.log('  平均声名 ' + avg(fames) + '　分位 p10 ' + q(0.1) + ' / p50 ' + q(0.5) + ' / p90 ' + q(0.9) + ' / max ' + fames[fames.length - 1]);
console.log('  平均谱 ' + avg(res.map(r => Math.max(...r.hand))));
if (winFame.length) console.log('  以声名结束时：' + winFame.length + ' 局，平均 ' + avg(winFame));
