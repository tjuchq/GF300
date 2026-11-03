/* ===========================================================
   三百首 · 词路（棋盘）
   6 段 × 4 格 = 24 格，掷骰前进，落地辑录。
   与《词宗》共用同一套「卡牌价值」体系（知音/同流/已注/开段）。
   =========================================================== */
(function () {
  'use strict';

  var E = window.SBEngine;
  var App = window.SBApp;

  var BOARD = {
    size: 49,
    perEra: 8,          // 每段 8 格（6 段 ×8 + 起点 = 49）
    fameTarget: 120,    // 声名先到 120 即胜（取消「走满几卷」的结束条件）
    startInk: 2,
    income: 1,
    passGain: 3,        // 过起点（成卷）得声名
    gatherInk: 4,
    eventPenalty: 1,
    visitFee: 1,        // 踩到别人已辑录的格子，付墨，转成对方声名
    groupSize: 3,       // 同一维度占满几格算「成组」
    groupBonus: 3,      // 每成一组的声名奖励
    maxToll: 3,         // 基础过路费上限（墨）
    debtPenalty: 5,     // 墨不足付过路费时，改扣声名
    startBonus: 2,      // 踩到起点（开卷格）的声名
    handLimit: 0,       // 棋局中最多能辑录几首；0 = 不限
    cols: 7,            // 每行几格（默认 7，可选 4–7）
    tollLapCap: 2,      // 同一格被主人重修的上限（每重修一次 +1 墨）
    maxTurns: 400       // 只作死循环兜底，正常对局远到不了
  };

  /* 声名目标固定 120；后手补偿按人数分档，用 tools/balance.js 调过，
     目标是同策略下各座位胜率尽量相等。 */
  var BALANCE = {
    2: { fame: 120, inkStep: 0, fameTable: [0, 0], income: 1 },
    3: { fame: 120, inkStep: 0, fameTable: [3, 2, 8], income: 1 },
    4: { fame: 120, inkStep: 1, fameTable: [6, 0, 2, 6], income: 2 }
  };

  /* 教程局用：热度表在 js/hot.js，score 越小越热 */
  /* 机会：多为顺境 */
  var CHANCE = [
    { t: '遇知音', d: '得墨 3', ink: 3 },
    { t: '雅集相邀', d: '得墨 4', ink: 4 },
    { t: '一纸风行', d: '声名 +2', fame: 2 },
    { t: '前辈提携', d: '声名 +3', fame: 3 },
    { t: '抄谱得赠', d: '得墨 2，声名 +1', ink: 2, fame: 1 },
    { t: '顺风顺水', d: '前进 3 格', move: 3 },
    { t: '快马加鞭', d: '前进 2 格，得墨 2', move: 2, ink: 2 },
    { t: '良师指点', d: '下一张辑录免墨', free: true },
    { t: '同好相赠', d: '得墨 5', ink: 5 },
    { t: '声名鹊起', d: '声名 +4', fame: 4 }
  ];
  /* 命运：吉凶参半 */
  var FATE = [
    { t: '曲高和寡', d: '声名 −2', fame: -2 },
    { t: '抄袭之嫌', d: '声名 −3', fame: -3 },
    { t: '谱牒散佚', d: '失墨 3', ink: -3 },
    { t: '误入歧途', d: '后退 3 格', move: -3 },
    { t: '人事纷争', d: '失墨 2，声名 −1', ink: -2, fame: -1 },
    { t: '闭门思过', d: '停一回合', skip: true },
    { t: '旧调重弹', d: '声名 +1', fame: 1 },
    { t: '贵人相助', d: '得墨 3', ink: 3 },
    { t: '柳暗花明', d: '声名 +2', fame: 2 },
    { t: '得失相抵', d: '得墨 2，声名 −1', ink: 2, fame: -1 }
  ];

  var S = {
    cells: [],
    players: [],
    turn: 0,
    order: [],
    seat: 0,
    lap: [0, 0],
    phase: 'idle',      // idle | moving | decide | over
    log: [],
    over: false,
    winner: null,
    lastRoll: 0,
    chanceIdx: 0,
    fateIdx: 0,
    lastCard: null,
    gen: 0,
    myIdx: 0,
    paused: false,
    tutorial: false,
    scripted: [],
    turns: 0
  };
  var cfg = { difficulty: 'normal' };

  function $(s, r) { return (r || document).querySelector(s); }
  function el(t, c, h) { var d = document.createElement(t); if (c) d.className = c; if (h != null) d.innerHTML = h; return d; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function join(a, s) { return (a && a.length) ? a.join(s || '、') : ''; }
  function toast(msg, ms) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('show'); }, ms || 2000);
  }

  /* ---------------- 建盘 ---------------- */
  function buildBoard() {
    var data = window.GAME_DATA;
    var eras = data.meta.eras || [];
    var cards = data.cards;
    var byEra = {};
    cards.forEach(function (c) { (byEra[c.era] = byEra[c.era] || []).push(c); });
    Object.keys(byEra).forEach(function (k) { E.shuffle(byEra[k], Math.random); });
    if (S.tutorial) {
      // 越热的排在数组末尾，pop() 先取到——每段从最热开始铺
      Object.keys(byEra).forEach(function (k) {
        byEra[k].sort(function (a, b) {
          var sa = window.SBHOT ? SBHOT.score(a) : 9999;
          var sb = window.SBHOT ? SBHOT.score(b) : 9999;
          return sb - sa;
        });
      });
    }

    var cells = [];
    cells.push({ i: 0, era: -1, eraLabel: '开卷', from: 2008, to: 2026,
      kind: 'start', card: null, owner: null, isStart: false, revealed: true, spent: false });
    var idx = 1;
    eras.forEach(function (e, ei) {
      var pool = byEra[ei] || [];
      for (var j = 0; j < BOARD.perEra; j++) {
        var kind, card = null;
        if (j === BOARD.perEra - 1) {
          kind = (ei % 2 === 0) ? 'chance' : 'fate';
        } else {
          kind = 'song';
          card = pool.length ? pool.pop() : null;
        }
        cells.push({
          i: idx++, era: ei, eraLabel: e.label, from: e.from, to: e.to,
          kind: kind, card: card, owner: null, isStart: j === 0,
          revealed: false, spent: false
        });
      }
    });
    S.cells = cells;
  }

  /* ---------------- 开局 ---------------- */
  function startGame(roster, opts) {
    opts = opts || {};
    S.gen = (S.gen || 0) + 1;
    var bal = BALANCE[roster.length];
    if (bal) {
      BOARD.fameTarget = bal.fame;
      BOARD.income = bal.income || 1;
    }
    S.tutorial = !!opts.tutorial;
    S.scripted = S.tutorial ? [2, 3, 1, 4, 2, 3] : [];
    S.paused = false;
    S.turns = 0;
    buildBoard();
    var n = roster.length;
    var first = ((opts.firstSeat | 0) % n + n) % n;
    S.order = [];
    for (var k = 0; k < n; k++) S.order.push((first + k) % n);
    S.seat = 0;

    S.players = roster.map(function (r, i) {
      var pos = S.order.indexOf(i);
      return {
        idx: i, seat: pos, name: r.name, isAI: !!r.isAI,
        pos: -1,
        ink: BOARD.startInk + pos * (bal ? bal.inkStep : 1) + (S.tutorial ? 3 : 0),
        fame: (bal && bal.fameTable ? bal.fameTable[pos] : pos * 2) || 0,
        hand: [], lap: 0, ai: !!r.isAI, rewarded: {}, freeNext: false, skipTurn: false
      };
    });
    S.myIdx = Math.max(0, roster.map(function (r) { return !!r.isMe; }).indexOf(true));
    S.turn = S.order[0]; S.over = false; S.winner = null; S.phase = 'idle';
    S.log = [];
    log('开局：' + S.players.map(function (p) { return p.name; }).join(' · ') + '。' +
      S.players[S.turn].name + ' 执先行棋。');
    render();
    // 若先手是 AI，自动起骰
    if (S.players[S.turn].isAI) later(function () { doRoll(); }, 700);
  }

  function log(t, kind) {
    S.log.push({ text: t, kind: kind || '' });
    if (S.log.length > 60) S.log.shift();
  }

  function cur() { return S.players[S.turn] || S.players[0]; }

  /* 重开一局后，上一局排好的定时器必须作废，否则会在新局上乱动 */
  function later(fn, ms) {
    var g = S.gen;
    setTimeout(function () { if (S.gen === g && !S.over && !S.paused) fn(); }, ms);
  }

  /** 该玩家在某个维度上占了几格（只看已辑录的歌格） */
  /** 班底口径与词宗立派一致：只算词人与曲师（同一张里词曲同人只算一次） */
  function staffOf(card) {
    var set = {}, out = [];
    ['lyricist', 'composer'].forEach(function (k) {
      (card[k] || []).forEach(function (v) {
        if (v && !set[v]) { set[v] = 1; out.push(v); }
      });
    });
    return out;
  }

  function countDim(playerIdx, dim, val) {
    var n = 0;
    S.cells.forEach(function (c) {
      if (c.owner !== playerIdx || !c.card) return;
      if (dim === 'era' && c.era === val) n++;
      else if (dim === 'type' && c.card.typeGroup === val) n++;
      else if (dim === 'staff' && staffOf(c.card).indexOf(val) >= 0) n++;
    });
    return n;
  }

  /** 这首歌落在你手上的「最大组」——年代 / 主题 / 同一位词人或曲师，取最大，封顶 3 */
  function tollOf(cell, ownerIdx) {
    var counts = [countDim(ownerIdx, 'era', cell.era)];
    if (cell.card) {
      counts.push(countDim(ownerIdx, 'type', cell.card.typeGroup));
      staffOf(cell.card).forEach(function (v) {
        counts.push(countDim(ownerIdx, 'staff', v));
      });
    }
    var base = Math.max(1, Math.min(BOARD.maxToll, Math.max.apply(null, counts)));
    return base + (cell.tollBonus || 0);
  }

  /** 辑录后检查三个维度是否成组，每组只奖励一次 */
  function checkGroups(p) {
    var tally = {};
    S.cells.forEach(function (c) {
      if (c.owner !== p.idx || !c.card) return;
      tally['era:' + c.era] = (tally['era:' + c.era] || 0) + 1;
      tally['type:' + c.card.typeGroup] = (tally['type:' + c.card.typeGroup] || 0) + 1;
      staffOf(c.card).forEach(function (v) {
        tally['staff:' + v] = (tally['staff:' + v] || 0) + 1;
      });
    });
    p.rewarded = p.rewarded || {};
    var names = {};
    Object.keys(tally).forEach(function (k) {
      if (tally[k] < BOARD.groupSize || p.rewarded[k]) return;
      p.rewarded[k] = true;
      var parts = k.split(':');
      var label = parts[0] === 'era' ? (S.cells.filter(function (c) { return c.era === +parts[1]; })[0] || {}).eraLabel || '年代'
        : parts[1];
      var kind = parts[0] === 'era' ? '年代' : parts[0] === 'type' ? '主题' : '班底';
      p.fame += BOARD.groupBonus;
      log(p.name + ' 以「' + label + '」成组（' + kind + '），声名 +' + BOARD.groupBonus + '，此组过路费加倍。', 'good');
    });
  }

  /* ---------------- 行动 ---------------- */
  function roll() {
    // 只允许在「空闲」时掷骰：连点会在移动中再排一次落地，跳过一个玩家
    if (S.over || S.phase !== 'idle' || S.paused) return;
    if (cur().isAI) return;
    doRoll();
  }

  function doRoll() {
    if (S.over || S.phase !== 'idle') return;
    var n = (S.tutorial && S.scripted.length)
      ? S.scripted.shift()
      : 1 + Math.floor(Math.random() * 6);
    S.lastRoll = n;
    S.phase = 'moving';
    log(cur().name + ' 掷得 ' + n + ' 点。');
    if (!cur().isAI && window.SBApp && SBApp.tutNotify) SBApp.tutNotify('roll');
    render();
    later(function () { move(n); }, 280);
  }

  /** 加声名并立刻判胜：任何一次加声名都可能刚好到 120，不能再等走完一圈 */
  function addFame(p, delta) {
    if (!delta || S.over) return S.over;
    p.fame = Math.max(0, p.fame + delta);
    return checkWin(p);
  }

  function checkWin(p) {
    if (S.over) return true;
    p = p || cur();
    if (p.fame >= BOARD.fameTarget) {
      S.over = true; S.winner = p.idx; S.phase = 'over';
      log(p.name + ' 声名先到 ' + BOARD.fameTarget + '，立谱成家。', 'good');
      render();
      showResult();
      return true;
    }
    return false;
  }

  function move(n) {
    var p = cur();
    if (p.pos < 0) {
      p.pos = n - 1;                     // 第一手从起点外侧进入
    } else {
      var np = p.pos + n;
      if (np >= BOARD.size) {            // 过卷：只加分，不再以「走满几卷」结束
        p.lap++;
        log(p.name + ' 走完第 ' + p.lap + ' 卷，声名 +' + BOARD.passGain + '。', 'good');
        if (addFame(p, BOARD.passGain)) return;
      }
      p.pos = np % BOARD.size;
    }
    render();
    later(function () { land(); }, 260);
  }

  function land() {
    var p = cur();
    var c = S.cells[p.pos];
    if (!c) { nextTurn(); return; }
    var firstTime = !c.revealed;
    c.revealed = true;
    if (firstTime) log('翻开第 ' + (p.pos + 1) + ' 格。');

    if (c.kind === 'start') {
      log(p.name + ' 回到开卷处，声名 +' + BOARD.startBonus + '。', 'good');
      if (addFame(p, BOARD.startBonus)) return;
      render(); later(nextTurn, 400); return;
    }
    if (c.isStart) {
      log(p.name + ' 踏入「' + c.eraLabel + '」段首，声名 +1。');
      if (addFame(p, 1)) return;
    }

    if (c.kind === 'chance' || c.kind === 'fate') {
      drawCard(p, c.kind);
      return;
    }

    // 歌格
    if (!c.card) { nextTurn(); return; }
    if (c.owner === p.idx) {
      // 重修：只有「跨过一圈又回到这一格」才加价，且只加这一格
      if (p.lap > (c.claimedLap || 0) && (c.tollBonus || 0) < BOARD.tollLapCap) {
        c.tollBonus = (c.tollBonus || 0) + 1;
        var now = tollOf(c, p.idx);
        log(p.name + ' 重修《' + c.card.name + '》，这一格过路费 +1（现 ' + now + ' 墨）。', 'good');
        if (p.idx === S.myIdx) {
          toast('重修《' + c.card.name + '》：这一格过路费升到 ' + now + ' 墨。', 2600);
        }
      } else if ((c.tollBonus || 0) >= BOARD.tollLapCap) {
        log(p.name + ' 回到《' + c.card.name + '》；这一格已重修到顶（' + tollOf(c, p.idx) + ' 墨）。');
        if (p.idx === S.myIdx) {
          toast('《' + c.card.name + '》已重修到顶：' + tollOf(c, p.idx) + ' 墨。', 2200);
        }
      } else {
        log('回到自己题过的《' + c.card.name + '》。');
        if (p.idx === S.myIdx) {
          toast('回到自己的《' + c.card.name + '》；走完一圈后再踩到，过路费才会涨。', 2400);
        }
      }
      render(); later(nextTurn, 380); return;
    }
    if (c.owner != null) {
      var owner = S.players[c.owner];
      var fee = tollOf(c, c.owner);
      if (p.ink >= fee) {
        p.ink -= fee;
        log(p.name + ' 参看 ' + owner.name + ' 题过的《' + c.card.name + '》，付润笔 ' + fee +
          ' 墨，' + owner.name + ' 声名 +' + fee + '。', 'bad');
        if (p.idx === S.myIdx) {
          toast('翻阅 ' + owner.name + ' 辑录的《' + c.card.name + '》：付 ' + fee + ' 墨，他 +' + fee + ' 声名。', 2800);
        } else if (owner.idx === S.myIdx) {
          toast(esc(p.name) + ' 翻阅了你辑录的《' + c.card.name + '》：你 +' + fee + ' 声名。', 2800);
        }
      } else {
        p.fame = Math.max(0, p.fame - BOARD.debtPenalty);
        log(p.name + ' 想参看《' + c.card.name + '》却墨不足（需 ' + fee + '），空手而过，声名 −' +
          BOARD.debtPenalty + '。', 'bad');
        if (p.idx === S.myIdx) {
          toast('墨不够（需 ' + fee + '），空手而过：声名 −' + BOARD.debtPenalty + '。', 2800);
        } else if (owner.idx === S.myIdx) {
          toast(p.name + ' 付不起 ' + fee + ' 墨，空手而过：他 −' + BOARD.debtPenalty + ' 声名。', 2600);
        }
        if (p.fame <= 0) bankrupt(p);
      }
      render(); later(nextTurn, 480); return;
    }

    // 空歌格：可辑录
    S.phase = 'decide';
    render();
    if (p.isAI) later(function () { aiDecide(); }, 420);
  }

  /** 抽一张机会 / 命运牌并立即结算 */
  function drawCard(p, kind) {
    var deck = kind === 'chance' ? CHANCE : FATE;
    var i = kind === 'chance' ? S.chanceIdx : S.fateIdx;
    var card = deck[i % deck.length];
    if (kind === 'chance') S.chanceIdx = (i + 1) % deck.length;
    else S.fateIdx = (i + 1) % deck.length;

    S.lastCard = card;
    var label = kind === 'chance' ? '机会' : '命运';
    log(p.name + ' 抽到「' + label + '·' + card.t + '」：' + card.d + '。', kind === 'chance' ? 'good' : 'bad');

    p.ink = Math.max(0, p.ink + (card.ink || 0));
    if (card.free) p.freeNext = true;
    if (card.skip) p.skipTurn = true;
    if (card.move) {
      p.pos = (p.pos + card.move + BOARD.size) % BOARD.size;
      log(p.name + (card.move > 0 ? ' 前进 ' : ' 后退 ') + Math.abs(card.move) + ' 格。');
    }

    render();
    if (card.fame && addFame(p, card.fame)) return;
    later(function () {
      if (checkWin(p)) return;
      nextTurn();
    }, 900);
  }

  function canBuy(p, card) {
    if (!card) return null;
    if (BOARD.handLimit && p.hand.length >= BOARD.handLimit) return null;
    var ev = E.evaluate(card, p.hand, false);
    if (p.freeNext) { ev.cost = 0; ev.free = true; return ev; }
    if (p.ink < ev.cost) return null;
    return ev;
  }

  function buy() {
    var p = cur(), c = S.cells[p.pos];
    var ev = canBuy(p, c.card);
    if (!ev) { toast('墨不足或谱已满'); return; }
    p.ink -= ev.cost;
    if (ev.free) { p.freeNext = false; log(p.name + ' 免墨辑录。'); }
    p.fame += ev.fame;
    p.hand.push(c.card);
    c.owner = p.idx;
    c.claimedLap = p.lap;
    c.tollBonus = 0;
    log(p.name + ' 辑录《' + c.card.name + '》，付墨 ' + ev.cost + '，声名 +' + ev.fame + '。', 'good');

    checkGroups(p);
    if (window.SBApp && SBApp.tutNotify) SBApp.tutNotify('buy');
    if (checkWin(p)) return;
    nextTurn();
  }

  /** 采风：得墨，代价是这一轮不行棋 */
  function gather() {
    if (S.over || S.phase !== 'idle' || cur().isAI) return;
    var p = cur();
    p.ink += BOARD.gatherInk;
    log(p.name + ' 采风，得墨 ' + BOARD.gatherInk + '，本轮不行棋。');
    render();
    later(nextTurn, 320);
  }

  /** 破产：声名跌到 0，谱全失、所占格子释放，退回开卷格重来 */
  function bankrupt(p) {
    var lost = p.hand.length, cells = 0;
    S.cells.forEach(function (c) {
      if (c.owner === p.idx) { c.owner = null; c.tollBonus = 0; c.claimedLap = 0; cells++; }
    });
    p.hand = [];
    p.rewarded = {};
    p.fame = 0;
    p.pos = 0;
    p.lap = 0;          // 卷数一并归零：既是「重开」，也避免他虚高的卷数提前终局
    p.freeNext = false;
    log(p.name + ' 声名尽失，' + lost + ' 首谱与 ' + cells + ' 处占地一并散佚，退回开卷处重来。', 'bad');
  }

  function skip() {
    var p = cur(), c = S.cells[p.pos];
    if (!c || !c.card) { nextTurn(); return; }
    log(p.name + ' 略过《' + c.card.name + '》。');
    if (window.SBApp && SBApp.tutNotify) SBApp.tutNotify('decide');
    nextTurn();
  }

  function nextTurn() {
    if (S.over) return;
    S.lastCard = null;
    S.phase = 'idle';
    S.turns++;
    if (S.turns > BOARD.maxTurns) { endByFame(); return; }
    S.seat = (S.seat + 1) % S.order.length;
    S.turn = S.order[S.seat];
    var p = cur();
    p.ink += BOARD.income;
    render();
    if (p.skipTurn) {
      p.skipTurn = false;
      log(p.name + ' 闭门思过，跳过这一手。', 'bad');
      render();
      later(nextTurn, 700);
      return;
    }
    if (p.isAI) later(function () { doRoll(); }, 500);
  }

  /** 兜底：只在极端长局触发，正常对局到不了 */
  function endByFame() {
    var best = S.players.slice().sort(function (a, b) { return b.fame - a.fame; })[0];
    S.over = true; S.winner = best.idx; S.phase = 'over';
    log('久战不决，以声名定胜负：' + best.name + ' 胜。', 'good');
    render(); showResult();
  }

  /* ---------------- AI ---------------- */
  /** 买下这张能推进多少「组」：差一张就成组时最值钱 */
  function groupScore(p, card) {
    var cell = S.cells[p.pos];
    var vals = [{ dim: 'era', v: cell.era }, { dim: 'type', v: card.typeGroup }];
    staffOf(card).forEach(function (v) { vals.push({ dim: 'staff', v: v }); });

    var score = 0;
    vals.forEach(function (x) {
      var c = countDim(p.idx, x.dim, x.v);
      if (c + 1 >= BOARD.groupSize) score += 5.5;        // 这一张落下即成组
      else if (c + 1 === BOARD.groupSize - 1) score += 2.2; // 再一张成组
      else score += c * 0.35;                             // 已在这一组里
    });
    return score;
  }

  function aiDecide() {
    var p = cur(), c = S.cells[p.pos];
    var ev = canBuy(p, c.card);
    if (!ev) { skip(); return; }

    var diff = cfg.difficulty || 'normal';
    var gs = groupScore(p, c.card);
    var worth = ev.fame / Math.max(1, ev.cost);

    // 一档：只看值不值，不看组，还常犯懒
    var cheap = worth >= 1.0 || ev.fame >= 4;
    // 三档：只买能推进组的，或明显高值的；其余留墨
    var good = gs >= 2.0 || ev.fame >= 5 || worth >= 2.2;

    var buyIt;
    // 初涉：只买「不易成组」的牌（专挑没用的）
    if (diff === 'easy') buyIt = gs < 1.0;
    // 熟手：买不买随机
    else if (diff === 'normal') buyIt = Math.random() < 0.5;
    // 老吏：只买能推进组的，或明显高值的
    else buyIt = cheap || good;

    // 老吏懂得「不买就采风」：同样停一手，白拿 4 墨
    if (!buyIt && diff === 'hard') {
      p.ink += BOARD.gatherInk;
      log(p.name + ' 采风，得墨 ' + BOARD.gatherInk + '，这一轮不行棋。');
      render();
      nextTurn();
      return;
    }

    // 墨囤到用不完就别再省了
    if (!buyIt && p.ink >= 8) buyIt = true;
    if (buyIt) buy(); else skip();
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    renderPlayers();
    renderGrid();
    renderSide();
    renderPanel();
  }

  function renderPlayers() {
    var wrap = $('#bp-players');
    if (!wrap) return;
    wrap.innerHTML = S.players.map(function (p) {
      return '<div class="bp-p' + (p.idx === S.turn && !S.over ? ' now' : '') + '">' +
        '<span class="nm">' + esc(p.name) + (p.isAI ? '<i>机</i>' : '') + '</span>' +
        '<span class="st">声名 <b>' + p.fame + '</b></span>' +
        '<span class="st">墨 <b>' + p.ink + '</b></span>' +
        '<span class="st">谱 <b>' + p.hand.length + '</b></span>' +
        '<span class="st">卷 <b>' + p.lap + '</b></span>' +
        '</div>';
    }).join('');
  }

  function renderGrid() {
    var grid = $('#bp-grid');
    if (!grid) return;
    // 一条龙：每行 cols 格，奇数行反向，形成首尾相接的 S 形路径
    var order = [];
    var cols = BOARD.cols || 7;
    grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    for (var r = 0; r < BOARD.size / cols; r++) {
      var row = [];
      for (var c = 0; c < cols; c++) row.push(r * cols + c);
      if (r % 2 === 1) row.reverse();
      order = order.concat(row);
    }
    grid.innerHTML = '';
    order.forEach(function (i) {
      var cell = S.cells[i];
      if (!cell) return;
      var known = cell.revealed;
      var d = el('div', 'bp-cell k-' + cell.kind + (cell.isStart ? ' start' : '') +
        (cell.owner != null ? ' owned' : '') + (known ? '' : ' hidden') +
        (cell.era >= 0 ? ' e' + (cell.era % 6) : ''));
      var who = cell.owner != null ? S.players[cell.owner] : null;
      var pieces = S.players.filter(function (p) { return p.pos === i; })
        .map(function (p) { return '<i class="piece p' + p.idx + '"></i>'; }).join('');
      d.innerHTML =
        '<div class="c-era">' + esc(cell.eraLabel) + '<span>' + (cell.i + 1) + '</span></div>' +
        '<div class="c-body">' +
          (!known ? '<b class="q">？</b><span></span>'
            : cell.kind === 'start' ? '<b class="ico">开卷</b><span>声名 +' + BOARD.startBonus + '</span>'
            : cell.kind === 'song' && cell.card
              ? '<b>' + esc(cell.card.name) + '</b><span>' + (cell.card.year || '') + '</span>'
              : cell.kind === 'chance' ? '<b class="ico ch">机会</b><span>抽一张</span>'
                : '<b class="ico fa">命运</b><span>抽一张</span>') +
        '</div>' +
        (who ? '<div class="c-owner" style="color:' + playerColor(who.idx) + '">' + esc(who.name) +
          (function () {
            var fee = tollOf(cell, who.idx);
            return '<i class="c-toll" title="翻阅这一格要付 ' + fee + ' 墨，并让 ' + esc(who.name) + ' +' + fee + ' 声名' +
              ((cell.tollBonus || 0) ? '（主人重修过 ' + cell.tollBonus + ' 次）' : '') + '">' + fee + '墨</i>';
          })() + '</div>' : '') +
        '<div class="c-pieces">' + pieces + '</div>';
      if (known && cell.kind === 'song' && cell.card) {
        d.title = '《' + cell.card.name + '》　点开档案 · 右键 / 长按看解析';
        d.addEventListener('click', function () { App.openCard(cell.card, null); });
        if (App.bindArchive) App.bindArchive(d, cell.card, null);
      }
      grid.appendChild(d);
    });
  }

  /** 成组看板：当前玩家在「年代 / 主题 / 班底」三维度各占了几格、成了几组 */
  function renderSide() {
    var wrap = $('#bp-side');
    if (!wrap || !S.players.length) return;
    // 固定显示「你」的成组进度；热座局也以你那一席为准
    var p = S.players[S.myIdx] || cur();
    var need = BOARD.groupSize;

    var eraCnt = {}, typeCnt = {}, staffCnt = {};
    S.cells.forEach(function (c) {
      if (c.owner !== p.idx || !c.card) return;
      if (c.era >= 0) eraCnt[c.era] = (eraCnt[c.era] || 0) + 1;
      typeCnt[c.card.typeGroup] = (typeCnt[c.card.typeGroup] || 0) + 1;
      staffOf(c.card).forEach(function (v) { staffCnt[v] = (staffCnt[v] || 0) + 1; });
    });

    function pill(name, n) {
      var done = n >= need;
      var cls = done ? 'pill n2' : (n ? 'pill n1' : 'pill dim');
      return '<span class="' + cls + '" title="' + esc(name) + '：' + n + '/' + need +
        (done ? '，已成组' : '，还差 ' + (need - n) + ' 格') + '">' +
        esc(name) + '<b>' + n + '</b></span>';
    }

    var eras = (window.GAME_DATA.meta.eras || []);
    var eraPills = eras.map(function (e, i) { return pill(e.label, eraCnt[i] || 0); }).join('');
    var themePills = ['史同', '架空', '人生', '文化']
      .map(function (g) { return pill(g, typeCnt[g] || 0); }).join('');

    var staffNames = Object.keys(staffCnt).sort(function (a, b) { return staffCnt[b] - staffCnt[a]; });
    var staffPills = staffNames.slice(0, 12).map(function (n) { return pill(n, staffCnt[n]); }).join('');

    var eraDone = eras.filter(function (e, i) { return (eraCnt[i] || 0) >= need; }).length;
    var themeDone = ['史同', '架空', '人生', '文化']
      .filter(function (g) { return (typeCnt[g] || 0) >= need; }).length;
    var staffDone = staffNames.filter(function (n) { return staffCnt[n] >= need; }).length;
    var total = eraDone + themeDone + staffDone;

    wrap.innerHTML =
      '<div class="side-t">成 组 <em class="' + (total ? 'hit' : '') + '">' + esc(p.name) +
        ' · 已立 ' + total + ' 组</em></div>' +
      '<div class="side-t sub-t">年 代 段 <em>' + eraDone + '/' + eras.length + '</em></div>' +
      '<div class="side-list">' + eraPills + '</div>' +
      '<div class="side-t sub-t">主 题 <em>' + themeDone + '/4</em></div>' +
      '<div class="side-list">' + themePills + '</div>' +
      '<div class="side-t sub-t">班 底 <em>' + staffDone + ' 组 · ' + staffNames.length + ' 位</em></div>' +
      '<div class="side-list">' + (staffPills || '<span class="side-empty">还没有占地</span>') + '</div>' +
      '<div class="side-note">同一维度占满 ' + need + ' 格即成组：立刻 +' + BOARD.groupBonus +
        ' 声名，过路费也按最大的组成倍收。<br>年代段＝同一段占几格；主题＝同类占几格；' +
        '班底＝同一位词人或曲师占几格（跨歌的词曲互通也算，同一首歌词曲同人只算一格）。</div>';
  }

  function playerColor(i) {
    return ['#9e3d32', '#47685a', '#7a5c8f', '#a8762b'][i % 4];
  }

  function renderPanel() {
    var btn = $('#bp-roll');
    var info = $('#bp-info');
    if (!btn) return;
    var p = cur();
    var mine = !S.over && !p.isAI && S.phase === 'idle' && !S.paused;
    btn.disabled = S.over || p.isAI || S.phase !== 'idle';
    btn.classList.toggle('hot', mine);
    btn.querySelector('.t').textContent = S.over ? '终 局' : (p.isAI ? p.name + ' 行棋' : '掷 骰');
    var sub = btn.querySelector('.d');
    if (sub) sub.textContent = mine ? '轮到你 · 点此行棋' : ('声名先到 ' + BOARD.fameTarget);

    var gb = $('#bp-gather');
    if (gb) gb.disabled = S.over || p.isAI || S.phase !== 'idle';

    // 引导只在自己该动的时候出现；棋盘全暗时它就是「该点这里」的指路牌
    var coach = $('#bp-coach');
    if (coach) coach.hidden = !mine || !!document.querySelector('.tut-layer');

    // 列数按钮的选中态
    Array.prototype.forEach.call(document.querySelectorAll('#bp-cols button'), function (b) {
      b.classList.toggle('on', +b.dataset.c === (BOARD.cols || 7));
    });

    if (S.phase === 'decide' && !S.over) {
      var c = S.cells[p.pos];
      if (!c || !c.card) {
        info.innerHTML = '<div class="bp-hint">这一格没有可辑录的歌。</div>';
        return;
      }
      var ev = canBuy(p, c.card);
      info.innerHTML =
        '<div class="bp-card">' +
          '<div class="bc-name">' + esc(c.card.name) + '</div>' +
          '<div class="bc-meta">' + c.card.year + ' · ' + esc(c.card.type) + ' · 词 ' + esc(join(c.card.lyricist)) + ' · 曲 ' + esc(join(c.card.composer)) + '</div>' +
          '<div class="bc-parse" id="bp-parse">点这里 / 右键 / 长按 → 看这首歌的解析</div>' +
          '<div class="bc-ev">' + (ev
            ? '费墨 <b>' + ev.cost + '</b>　声名 <b>+' + ev.fame + '</b>（' + ev.parts.map(function (x) { return x.text + '+' + x.value; }).join('，') + '）'
            : '墨不足或谱已满，无法辑录') + '</div>' +
          '<div class="bc-acts">' +
            '<button class="nav primary" id="bp-buy"' + (ev ? '' : ' disabled') + '>辑 录</button>' +
            '<button class="nav" id="bp-skip">略 过</button>' +
          '</div>' +
        '</div>';
      var b1 = $('#bp-buy'), b2 = $('#bp-skip');
      if (b1) b1.addEventListener('click', buy);
      if (b2) b2.addEventListener('click', skip);
      var bp = $('#bp-parse');
      if (bp) bp.addEventListener('click', function () { App.openCard(c.card, null); });
      var bpc = $('.bp-card', info);
      if (bpc && App.bindArchive) App.bindArchive(bpc, c.card, null);
    } else {
      var last = S.lastCard;
      info.innerHTML = (last
        ? '<div class="bp-card drawn"><div class="bc-name">' + esc(last.t) + '</div>' +
          '<div class="bc-meta">机会 / 命运</div>' +
          '<div class="bc-ev">' + esc(last.d) + '</div></div>'
        : '<div class="bp-hint">' + (S.over ? '' :
          (p.isAI
            ? '等 <b>' + esc(p.name) + '</b> 行棋……'
            : '<b>轮到你</b> —— 点下方朱色「掷骰」行棋；缺墨可点「采风」得 ' +
              BOARD.gatherInk + ' 墨。<br><span style="color:var(--seal)">已翻开的歌格：点开档案，右键 / 长按看解析。</span>')) + '</div>');
    }

    var logBox = $('#bp-log');
    if (logBox) {
      logBox.innerHTML = S.log.slice(-24).map(function (l) {
        return '<div class="' + l.kind + '">' + esc(l.text) + '</div>';
      }).join('');
      logBox.scrollTop = logBox.scrollHeight;
    }
    var dice = $('#bp-dice');
    if (dice) dice.textContent = S.lastRoll || '·';
  }

  function showResult() {
    var w = S.players[S.winner];
    var me = S.players[S.myIdx];
    var iWin = S.winner === S.myIdx;
    $('#bp-result-title').textContent = iWin ? '路 成' : '路 未 成';
    var diffCn = { easy: '初涉', normal: '熟手', hard: '老吏' }[cfg.difficulty || 'normal'] || '熟手';
    var mb = $('#bp-result-meta');
    if (mb) {
      mb.innerHTML = '<span>玩法 <b>词路</b></span><span><b>' + S.players.length + '</b> 人</span>' +
        '<span>难度 <b>' + diffCn + '</b></span><span><b>' + S.turns + '</b> 手</span>' +
        '<span>终局 <b>声名 ' + w.fame + '</b></span>';
    }
    $('#bp-result-sub').innerHTML = iWin
      ? '你以声名 <b>' + w.fame + '</b> 先成一家，行 ' + (w.lap) + ' 卷。'
      : '<b>' + esc(w.name) + '</b> 以声名 <b>' + w.fame + '</b> 先成一家；你 ' + me.fame + ' 声名，行 ' + me.lap + ' 卷。';
    $('#modal-bp-result').classList.add('open');
  }

  function pause() { S.paused = true; }
  function resume() {
    S.paused = false;
    render();
    if (S.over) return;
    var p = cur();
    if (p.isAI && S.phase === 'idle') later(function () { doRoll(); }, 500);
    else if (p.isAI && S.phase === 'decide') later(function () { aiDecide(); }, 400);
  }

  window.SBBoard = {
    S: S, BOARD: BOARD, BALANCE: BALANCE, cfg: cfg,
    start: startGame, roll: roll, gather: gather, render: render,
    pause: pause, resume: resume,
    land: land,          // 调试用：手动触发一次落点结算
    reset: function () {
      S.cells = []; S.players = []; S.over = false; S.phase = 'idle';
      S.paused = false; S.turns = 0; S.scripted = []; S.tutorial = false;
    }
  };
})();
