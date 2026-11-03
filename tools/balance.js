/* ===========================================================
   配平与对局统计（词宗 / 词路）
   -----------------------------------------------------------
   用法：
     node tools/balance.js deck <人数> [局数] [难度]
     node tools/balance.js board <人数> [局数] [难度]
     node tools/balance.js tune-deck <人数> [每档局数]
     node tools/balance.js tune-seat <deck|board> <人数> [每档局数]
     node tools/balance.js strategies [每档局数]
     node tools/balance.js all

   说明：
   - deck 直接调用 js/engine.js + js/ai.js，和网页是同一套逻辑。
   - board 是 js/board.js 的无界面复刻；改 board.js 的规则时要同步这里。
   - 难度：easy=初涉 / normal=熟手 / hard=老吏。
   =========================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const E = require(path.join(__dirname, '..', 'js', 'engine.js'));
const AI = require(path.join(__dirname, '..', 'js', 'ai.js'));

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'cards.json'), 'utf8'));
const CARDS = data.cards;
const ERAS = (data.meta && data.meta.eras) || [];

const DIFF_CN = { easy: '初涉', normal: '熟手', hard: '老吏' };
const BOARD_BALANCE = {
  2: { fame: 120, inkStep: 0, fameTable: [0, 0], income: 1 },
  3: { fame: 120, inkStep: 0, fameTable: [3, 2, 8], income: 1 },
  4: { fame: 120, inkStep: 1, fameTable: [6, 0, 2, 6], income: 2 }
};
const LINE_CN = { fame: '声名', eras: '通史', schools: '立派', themes: '成题', timeout: '超时' };

/* ---------------- 词宗 ---------------- */
function deckConfig(n, p) {
  const b = E.BALANCE[n] || E.BALANCE[2];
  p = p || b;
  return {
    fameTarget: p.fame,
    eraTarget: p.eras || 6,
    schoolTarget: p.schools,
    schoolMinCards: p.schoolMinCards || 0,
    schoolDeep: !!p.schoolDeep,
    themeSize: p.themeSize,
    themeEras: p.themeEras,
    eraMinGroups: p.groups,
    eraDoubleSegs: p.doubles,
    eraMinCards: p.minCards == null ? 8 : p.minCards,
    income: p.income,
    aiBias: p.aiBias,
    secondBonus: p.inkStep == null ? 1 : p.inkStep,
    seatFameTable: p.fameTable || [0]
  };
}

function runDeck(seed, n, cfg, diffs) {
  const roster = Array.from({ length: n }, (_, i) => ({ name: 'P' + i, isAI: true }));
  const g = new E.Game(CARDS, { seed, eraCount: 6, players: roster, config: cfg });
  let guard = 0;
  while (!g.state.over && guard++ < 600) {
    const cur = g.state.current;
    const step = AI.decide(g, cur, diffs[cur % diffs.length]);
    if (step.type === 'place') {
      const r = g.place(step.cardId, cur);
      if (!r.ok) g.gather(cur);
    } else {
      g.gather(cur);
    }
    if (g.state.over) break;
    g.endTurn();
  }
  return {
    winBy: g.state.winBy,
    winner: g.state.winner,
    round: g.state.round,
    fame: g.state.players.map(p => p.fame),
    hand: g.state.players.map(p => p.hand.length)
  };
}

function deckStats(n, cfg, diffs, games, seedBase) {
  const by = { fame: 0, eras: 0, schools: 0, themes: 0, timeout: 0 };
  const seats = new Array(n).fill(0);
  let rounds = 0, total = 0;
  for (let i = 0; i < games; i++) {
    const r = runDeck((seedBase || 9000) + i * 37, n, cfg, diffs);
    by[r.winBy] = (by[r.winBy] || 0) + 1;
    if (r.winner != null) seats[r.winner]++;
    rounds += r.round;
    total++;
  }
  const pct = k => +(100 * (by[k] || 0) / total).toFixed(1);
  return {
    n, games: total, by, pct: { fame: pct('fame'), eras: pct('eras'), schools: pct('schools'), themes: pct('themes'), timeout: pct('timeout') },
    seats: seats.map(x => +(100 * x / total).toFixed(1)),
    rounds: +(rounds / total).toFixed(2)
  };
}

/* ---------------- 词路（无界面复刻） ---------------- */
const B = {
  size: 49, perEra: 8, fameTarget: 120, startInk: 2, income: 1, passGain: 3,
  gatherInk: 4, groupSize: 3, groupBonus: 3, maxToll: 3, debtPenalty: 5,
  startBonus: 2, handLimit: 0, tollLapCap: 2, maxTurns: 400,
  hardWinNow: true, hardBlock: true, hardBehind: true
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
  CARDS.forEach(c => { (byEra[c.era] = byEra[c.era] || []).push(c); });
  Object.keys(byEra).forEach(k => E.shuffle(byEra[k], rnd));
  const cells = [{ i: 0, era: -1, kind: 'start', card: null, owner: null, isStart: false, revealed: true, tollBonus: 0, claimedLap: 0 }];
  let idx = 1;
  ERAS.forEach((e, ei) => {
    const pool = byEra[ei] || [];
    for (let j = 0; j < B.perEra; j++) {
      let kind, card = null;
      if (j === B.perEra - 1) kind = (ei % 2 === 0) ? 'chance' : 'fate';
      else { kind = 'song'; card = pool.length ? pool.pop() : null; }
      cells.push({ i: idx++, era: ei, kind, card, owner: null, isStart: j === 0, revealed: false, tollBonus: 0, claimedLap: 0 });
    }
  });
  return cells;
}

function boardComp(n, inkStep, fameTable, income) {
  return {
    inkStep: inkStep == null ? 1 : inkStep,
    fameTable: fameTable || Array.from({ length: n }, (_, i) => i * 2),
    income: income || 1
  };
}

function staffOf(card) {
  const set = {}, out = [];
  ['lyricist', 'composer'].forEach(k => (card[k] || []).forEach(v => { if (v && !set[v]) { set[v] = 1; out.push(v); } }));
  return out;
}

function countDim(cells, idx, dim, val) {
  let n = 0;
  cells.forEach(c => {
    if (c.owner !== idx || !c.card) return;
    if (dim === 'era' && c.era === val) n++;
    else if (dim === 'type' && c.card.typeGroup === val) n++;
    else if (dim === 'staff') {
      const set = {};
      ['lyricist', 'composer'].forEach(k => (c.card[k] || []).forEach(v => { if (v) set[v] = 1; }));
      if (set[val]) n++;
    }
  });
  return n;
}

function tollOf(cells, cell, owner) {
  const counts = [countDim(cells, owner, 'era', cell.era)];
  if (cell.card) {
    counts.push(countDim(cells, owner, 'type', cell.card.typeGroup));
    staffOf(cell.card).forEach(v => counts.push(countDim(cells, owner, 'staff', v)));
  }
  const base = Math.max(1, Math.min(B.maxToll, Math.max.apply(null, counts)));
  return base + (cell.tollBonus || 0);
}

function checkGroups(cells, p) {
  const tally = {};
  cells.forEach(c => {
    if (c.owner !== p.idx || !c.card) return;
    tally['era:' + c.era] = (tally['era:' + c.era] || 0) + 1;
    tally['type:' + c.card.typeGroup] = (tally['type:' + c.card.typeGroup] || 0) + 1;
    staffOf(c.card).forEach(v => { tally['staff:' + v] = (tally['staff:' + v] || 0) + 1; });
  });
  let bonus = 0;
  Object.keys(tally).forEach(k => {
    if (tally[k] < B.groupSize || p.rewarded[k]) return;
    p.rewarded[k] = true;
    bonus += B.groupBonus;
  });
  p.fame += bonus;
}

function groupScore(cells, p, card, cell) {
  const vals = [{ dim: 'era', v: cell.era }, { dim: 'type', v: card.typeGroup }];
  staffOf(card).forEach(v => vals.push({ dim: 'staff', v }));
  let s = 0;
  vals.forEach(x => {
    const c = countDim(cells, p.idx, x.dim, x.v);
    if (c + 1 >= B.groupSize) s += 5.5;
    else if (c + 1 === B.groupSize - 1) s += 2.2;
    else s += c * 0.35;
  });
  return s;
}

function runBoard(seed, n, comp, diffs) {
  const rnd = E.mulberry32(seed);
  const cells = buildBoard(rnd);
  const players = Array.from({ length: n }, (_, i) => ({
    idx: i, pos: -1,
    ink: B.startInk + i * comp.inkStep,
    fame: comp.fameTable[i] || 0,
    hand: [], lap: 0, rewarded: {}, freeNext: false, skipTurn: false
  }));
  let turn = 0, chanceIdx = 0, fateIdx = 0, turns = 0;
  let winner = null;

  while (turns++ < B.maxTurns) {
    const p = players[turn];
    if (turns > 1) p.ink += (comp.income || B.income);
    if (p.skipTurn) { p.skipTurn = false; turn = (turn + 1) % n; continue; }

    const d = 1 + Math.floor(rnd() * 6);
    if (p.pos < 0) p.pos = d - 1;
    else {
      const np = p.pos + d;
      if (np >= B.size) {
        p.lap++;
        p.fame += B.passGain;
        if (p.fame >= B.fameTarget) { winner = p.idx; break; }
      }
      p.pos = np % B.size;
    }

    const c = cells[p.pos];
    c.revealed = true;
    let won = false;

    if (c.kind === 'start') {
      p.fame += B.startBonus;
      if (p.fame >= B.fameTarget) won = true;
    } else if (c.kind === 'chance' || c.kind === 'fate') {
      const deck = c.kind === 'chance' ? CHANCE : FATE;
      const ci = c.kind === 'chance' ? chanceIdx : fateIdx;
      const card = deck[ci % deck.length];
      if (c.kind === 'chance') chanceIdx = (ci + 1) % deck.length;
      else fateIdx = (ci + 1) % deck.length;
      p.ink = Math.max(0, p.ink + (card.ink || 0));
      p.fame = Math.max(0, p.fame + (card.fame || 0));
      if (p.fame >= B.fameTarget) won = true;
      if (card.free) p.freeNext = true;
      if (card.skip) p.skipTurn = true;
      if (card.move) p.pos = (p.pos + card.move + B.size) % B.size;
    } else if (c.card) {
      if (c.isStart) { p.fame += 1; if (p.fame >= B.fameTarget) won = true; }
      if (!won) {
        if (c.owner === p.idx) {
          if (p.lap > (c.claimedLap || 0) && (c.tollBonus || 0) < B.tollLapCap) c.tollBonus++;
        } else if (c.owner != null) {
          const fee = tollOf(cells, c, c.owner);
          if (p.ink >= fee) {
            p.ink -= fee;
            players[c.owner].fame += fee;
            if (players[c.owner].fame >= B.fameTarget) { winner = c.owner; break; }
          } else {
            p.fame = Math.max(0, p.fame - B.debtPenalty);
            if (p.fame <= 0) {
              p.hand = []; p.rewarded = {}; p.fame = 0; p.pos = 0; p.lap = 0;
              cells.forEach(x => { if (x.owner === p.idx) { x.owner = null; x.tollBonus = 0; x.claimedLap = 0; } });
            }
          }
        } else {
          const ev = E.evaluate(c.card, p.hand, false);
          const cost = p.freeNext ? 0 : ev.cost;
          const gs = groupScore(cells, p, c.card, c);
          const worth = ev.fame / Math.max(1, cost);
          const diff = diffs[p.idx % diffs.length];
          const cheap = worth >= 1.0 || ev.fame >= 4;
          const good = gs >= 2.0 || ev.fame >= 5 || worth >= 2.2;
          let buyIt;
          if (diff === 'hard' && B.hardWinNow && p.fame + ev.fame >= B.fameTarget) buyIt = true;
          else if (diff === 'easy') buyIt = gs < 1.0;
          else if (diff === 'normal') buyIt = rnd() < 0.5;
          else {
            buyIt = cheap || good || gs >= 2.5;
            if (!buyIt && B.hardBlock) {
              players.forEach(foe => {
                if (foe.idx === p.idx || foe.fame < p.fame - 8) return;
                const vals = [{ dim: 'era', v: c.era }, { dim: 'type', v: c.card.typeGroup }];
                staffOf(c.card).forEach(v => vals.push({ dim: 'staff', v }));
                vals.forEach(x => { if (countDim(cells, foe.idx, x.dim, x.v) + 1 >= B.groupSize) buyIt = true; });
              });
            }
          }

          if (diff === 'hard' && B.hardBehind) {
            let lead = 0;
            players.forEach(f => { if (f.idx !== p.idx && f.fame > lead) lead = f.fame; });
            if (lead - p.fame >= 5 && ev.fame >= 3) buyIt = true;
          }

          if (!buyIt && diff === 'hard') {
            p.ink += B.gatherInk;
            turn = (turn + 1) % n;
            continue;
          }

          if (!buyIt && p.ink >= 8) buyIt = true;
          if (buyIt && p.ink >= cost) {
            p.ink -= cost;
            if (p.freeNext) p.freeNext = false;
            p.hand.push(c.card);
            c.owner = p.idx;
            c.claimedLap = p.lap;
            c.tollBonus = 0;
            p.fame += ev.fame;
            checkGroups(cells, p);
            if (p.fame >= B.fameTarget) won = true;
          }
        }
      }
    }
    if (won) { winner = p.idx; break; }
    turn = (turn + 1) % n;
  }

  if (winner == null) {
    const best = players.slice().sort((a, b) => b.fame - a.fame)[0];
    winner = best.idx;
  }
  return { winner, turns: turns, fame: players.map(x => x.fame), lap: players.map(x => x.lap), hand: players.map(x => x.hand.length) };
}

function boardStats(n, comp, diffs, games, seedBase) {
  const seats = new Array(n).fill(0);
  let turns = 0, fame = 0, lap = 0;
  for (let i = 0; i < games; i++) {
    const r = runBoard((seedBase || 7000) + i * 53, n, comp, diffs);
    seats[r.winner]++;
    turns += r.turns;
    fame += Math.max.apply(null, r.fame);
    lap += Math.max.apply(null, r.lap);
  }
  return {
    n, games,
    seats: seats.map(x => +(100 * x / games).toFixed(1)),
    turns: +(turns / games).toFixed(1),
    fame: +(fame / games).toFixed(1),
    lap: +(lap / games).toFixed(2)
  };
}

/* ---------------- 目标函数 ---------------- */
function lineScore(p) {
  const keys = ['fame', 'eras', 'schools', 'themes'];
  let s = 0;
  keys.forEach(k => { s += Math.pow(p[k] - 25, 2); });
  s += Math.pow((p.timeout || 0) * 1.6, 2);
  return s;
}

function baseParams(n) {
  const b = E.BALANCE[n];
  return {
    fame: b.fame, eras: b.eras, schools: b.schools,
    themeSize: b.themeSize, themeEras: b.themeEras,
    groups: b.groups, doubles: b.doubles, minCards: b.minCards,
    income: b.income, inkStep: b.inkStep, fameTable: b.fameTable.slice(),
    schoolMinCards: b.schoolMinCards || 0, schoolDeep: !!b.schoolDeep,
    aiBias: b.aiBias || null
  };
}

/* ---------------- 调参：词宗六个数 ---------------- */
function tuneDeck(n, games) {
  const cur = baseParams(n);
  const diffs = ['normal'];
  let best = deckStats(n, deckConfig(n, cur), diffs, games, 12000);
  let bestScore = lineScore(best.pct);
  console.log(`[${n} 人] 起点：`, best.pct, 'score', bestScore.toFixed(1));

  const steps = [
    ['fame', 2], ['schools', 1], ['themeSize', 1], ['themeEras', 1], ['doubles', 1], ['groups', 1]
  ];
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (const [key, step] of steps) {
      for (const dir of [-1, 1]) {
        const trial = Object.assign({}, best === null ? cur : cur);
        // 以当前最优为基准继续走
        trial[key] = (cur[key] == null ? 0 : cur[key]) + dir * step;
        if (key === 'fame' && (trial.fame < 32 || trial.fame > 60)) continue;
        if (key === 'schools' && (trial.schools < 3 || trial.schools > 8)) continue;
        if (key === 'themeSize' && (trial.themeSize < 5 || trial.themeSize > 10)) continue;
        if (key === 'themeEras' && (trial.themeEras < 2 || trial.themeEras > 6)) continue;
        if (key === 'themeEras' && trial.themeEras > trial.themeSize) continue;
        if (key === 'doubles' && (trial.doubles < 1 || trial.doubles > 6)) continue;
        if (key === 'groups' && (trial.groups < 1 || trial.groups > 4)) continue;
        const st = deckStats(n, deckConfig(n, trial), diffs, games, 12000);
        const sc = lineScore(st.pct);
        console.log(`   ${key} ${dir > 0 ? '+' : ''}${dir * step} → `, st.pct, 'score', sc.toFixed(1));
        if (sc < bestScore - 0.05) {
          bestScore = sc; best = st; Object.assign(cur, trial); improved = true;
        }
      }
    }
    console.log(`  pass ${pass + 1}:`, cur, '→', best.pct, 'score', bestScore.toFixed(2));
    if (!improved) break;
  }
  return { params: cur, stats: best, score: bestScore };
}

/* ---------------- 调参：座位补偿 ---------------- */
function seatScore(seats, n) {
  const t = 100 / n;
  return seats.reduce((s, x) => s + Math.pow(x - t, 2), 0);
}

function tuneSeatDeck(n, games) {
  const p = baseParams(n);
  let best = null;
  const maxFame = 5;
  function rec(arr, idx) {
    if (idx === n) {
      const comp = arr.slice();
      const cfg = deckConfig(n, Object.assign({}, p, { fameTable: comp, inkStep: 1 }));
      const st = deckStats(n, cfg, ['normal'], games, 22000);
      const sc = seatScore(st.seats, n) + Math.abs(lineScore(st.pct)) * 0.02;
      if (!best || sc < best.sc) { best = { comp, seats: st.seats, sc, pct: st.pct }; }
      return;
    }
    if (idx === 0) { rec([0], 1); return; }
    for (let v = 0; v <= maxFame; v++) {
      if (v < arr[arr.length - 1]) continue;
      rec(arr.concat([v]), idx + 1);
    }
  }
  rec([], 0);
  return best;
}

function tuneSeatBoard(n, games) {
  let best = null;
  const maxFame = 5;
  function rec(arr, idx) {
    if (idx === n) {
      const comp = boardComp(n, 1, arr);
      const st = boardStats(n, comp, ['normal'], games, 33000);
      const sc = seatScore(st.seats, n);
      if (!best || sc < best.sc) best = { comp: arr, seats: st.seats, sc, turns: st.turns };
      return;
    }
    if (idx === 0) { rec([0], 1); return; }
    for (let v = 0; v <= maxFame; v++) {
      if (v < arr[arr.length - 1]) continue;
      rec(arr.concat([v]), idx + 1);
    }
  }
  rec([], 0);
  return best;
}

/* ---------------- 策略矩阵 ---------------- */
function strategyMatrixDeck(games) {
  const out = [];
  const pairs = [['easy', 'normal'], ['easy', 'hard'], ['normal', 'hard']];
  pairs.forEach(([a, b]) => {
    const n = 2;
    const cfg = deckConfig(n, baseParams(n));
    const st = deckStats(n, cfg, [a, b], games, 44000);
    out.push({ label: `${DIFF_CN[a]} vs ${DIFF_CN[b]}`, a: st.seats[0], b: st.seats[1], detail: st });
  });
  const n3 = 3;
  const st3 = deckStats(n3, deckConfig(n3, baseParams(n3)), ['easy', 'normal', 'hard'], games, 55000);
  out.push({ label: '初涉 / 熟手 / 老吏 三人同局', a: st3.seats[0], b: st3.seats[1], c: st3.seats[2], detail: st3 });
  return out;
}

function strategyMatrixBoard(games) {
  const out = [];
  const pairs = [['easy', 'normal'], ['easy', 'hard'], ['normal', 'hard']];
  pairs.forEach(([a, b]) => {
    const n = 2;
    const bb = BOARD_BALANCE[n];
    const st = boardStats(n, boardComp(n, bb.inkStep, bb.fameTable, bb.income), [a, b], games, 66000);
    out.push({ label: `${DIFF_CN[a]} vs ${DIFF_CN[b]}`, a: st.seats[0], b: st.seats[1], detail: st });
  });
  const n3 = 3;
  const st3 = boardStats(n3, boardComp(n3, 0, [0, 0, 0]), ['easy', 'normal', 'hard'], games, 77000);
  out.push({ label: '初涉 / 熟手 / 老吏 三人同局', a: st3.seats[0], b: st3.seats[1], c: st3.seats[2], detail: st3 });
  return out;
}

/* ---------------- CLI ---------------- */
function printDeck(n, st) {
  console.log(`[${n} 人 · 词宗] ${st.games} 局`);
  console.log('  四线：' + ['fame', 'eras', 'schools', 'themes'].map(k => LINE_CN[k] + ' ' + st.pct[k] + '%').join(' / ') +
    (st.pct.timeout ? ' / 超时 ' + st.pct.timeout + '%' : ''));
  console.log('  座位胜率：' + st.seats.join(' / ') + '　平均轮次 ' + st.rounds);
}
function printBoard(n, st) {
  console.log(`[${n} 人 · 词路] ${st.games} 局`);
  console.log('  座位胜率：' + st.seats.join(' / ') + '　平均手数 ' + st.turns + '　胜者声名 ' + st.fame + '　圈数 ' + st.lap);
}

function main() {
  const cmd = process.argv[2] || 'all';
  if (cmd === 'deck') {
    const n = +(process.argv[3] || 2);
    const games = +(process.argv[4] || 400);
    const diff = process.argv[5] || 'normal';
    printDeck(n, deckStats(n, deckConfig(n, baseParams(n)), [diff], games));
  } else if (cmd === 'board') {
    const n = +(process.argv[3] || 2);
    const games = +(process.argv[4] || 400);
    const diff = process.argv[5] || 'normal';
    const bb = BOARD_BALANCE[n];
    printBoard(n, boardStats(n, boardComp(n, bb.inkStep, bb.fameTable, bb.income), [diff], games));
  } else if (cmd === 'tune-deck') {
    const n = +(process.argv[3] || 2);
    const games = +(process.argv[4] || 300);
    const r = tuneDeck(n, games);
    console.log('\n最优：', JSON.stringify(r.params), r.stats.pct, 'score', r.score.toFixed(2));
  } else if (cmd === 'tune-seat') {
    const which = process.argv[3] || 'deck';
    const n = +(process.argv[4] || 2);
    const games = +(process.argv[5] || 300);
    const r = which === 'board' ? tuneSeatBoard(n, games) : tuneSeatDeck(n, games);
    console.log('最优补偿：', JSON.stringify(r));
  } else if (cmd === 'strategies') {
    const games = +(process.argv[3] || 400);
    console.log('=== 词宗 · 三种策略 ===');
    strategyMatrixDeck(games).forEach(x => {
      console.log(`  ${x.label}：${x.a}%${x.c != null ? ' / ' + x.b + '% / ' + x.c + '%' : ' / ' + x.b + '%'}`);
    });
    console.log('=== 词路 · 三种策略 ===');
    strategyMatrixBoard(games).forEach(x => {
      console.log(`  ${x.label}：${x.a}%${x.c != null ? ' / ' + x.b + '% / ' + x.c + '%' : ' / ' + x.b + '%'}`);
    });
  } else {
    for (const n of [2, 3, 4]) {
      printDeck(n, deckStats(n, deckConfig(n, baseParams(n)), ['normal'], 400));
      const bb = BOARD_BALANCE[n];
      printBoard(n, boardStats(n, boardComp(n, bb.inkStep, bb.fameTable, bb.income), ['normal'], 400));
    }
  }
}

if (require.main === module) main();

module.exports = {
  CARDS, B, deckConfig, runDeck, deckStats, boardStats, boardComp,
  BOARD_BALANCE: BOARD_BALANCE,
  tuneDeck, tuneSeatDeck, tuneSeatBoard, strategyMatrixDeck, strategyMatrixBoard
};
