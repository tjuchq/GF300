/* ===========================================================
   三百首·词宗 — 规则引擎
   纯逻辑，不碰 DOM，可被 Node 直接 require 做平衡性模拟。
   =========================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SBEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 可调参数：平衡全在这里 ---------------- */
  var CONFIG = {
    marketSize: 5,        // 歌肆常驻张数
    handLimit: 0,         // 词宗谱容量；0 = 不限
    startInk: 3,          // 起手墨
    secondBonus: 2,       // 后手补偿墨（按出手位次递增）
    seatFameTable: [0, 2, 3, 4], // 各座位的起始声名补偿（先手 0，越后越多）
    income: 2,            // 每回合开头得墨
    inkCap: Infinity,     // 墨不设上限（2026-11 去掉 12 的封顶）
    gatherInk: 4,         // 采风得墨
    gatherRefresh: 1,     // 采风附带刷新几张歌肆

    costBase: 3,          // 基础费用
    costSpecial: 1,       // 特别篇加价
    costVirtual: 1,       // 中V加价
    discountStaff: 1,     // 每共享一位创作者减价
    discountStaffMax: 2,  // 知音减价上限
    discountSameGroup: 1, // 同流派减价
    minCost: 1,

    fameBase: 1,          // 正篇基础声名
    fameSpecial: 1,       // 特别篇加成
    fameVirtual: 1,       // 中V加成
    fameNote: 1,          // 有解析（已注）加成
    fameEraFirst: 1,      // 该段自方首张
    fameStaff: 1,         // 知音（≥1 位）
    fameStaff2: 1,        // 强知音额外（≥2 位）
    famePair: 2,          // 同流派成对

    fameTarget: 44,       // 终点线一：声名
    schoolTarget: 5,      // 终点线二：立派数（每位创作者需 schoolSize 首）
    themeSize: 7,         // 终点线四：同一类型大类几张算「成题」
    themeTarget: 1,       // 需要成几题
    themeEras: 3,         // 成题的几张须跨几个不同年代
    schoolSize: 2,        // 立一派需要同一创作者几首
    schoolExclusive: false,// 一张牌只能计入一派
    schoolPerTwo: true,   // 同一创作者每 schoolSize 首算一派（四首=两派）
    schoolDims: ['lyricist', 'composer'], // 立派只看这几个创作角色
    schoolMinCards: 0,    // 立派还要求谱中至少几张（0 = 不额外要求，用来微调立派难度）
    schoolDeep: false,    // 有一派用满 3 首时，可免去 schoolMinCards 的张数要求
    eraTarget: 6,         // 终点线三：通史段数
    eraMinPerEra: 1,      // 每个年代至少几张
    eraDoubleSegs: 4,     // 至少几个年代各有 2 张
    eraMinGroups: 3,      // 通史还须跨几个主题
    eraMinCards: 8,       // 通史额外张数要求
    balancedDraw: false,  // 补牌时优先补最缺的年代；关掉则纯随机（会让通史变难）
    aiBias: null,         // 只影响墨客选主线：{ fame, eras, schools, themes } 的权重
    maxRounds: 40
  };

  /* 按人数分档的目标表：人数越多，每人能拿到的牌越少。
     inkStep / fameTable 是「后手补偿」：按出手位次发，先手 0。
     这两组数与 a–f 六个目标值一起用 AI 互搏调过（见 tools/balance.js）。 */
  var BALANCE = {
    2: { fame: 44, eras: 6, schools: 5, themeSize: 7, themeEras: 4, groups: 3, minCards: 8, doubles: 4, income: 3, inkStep: 1, fameTable: [0, 0], schoolMinCards: 10, schoolDeep: true, aiBias: { themes: 1.2, schools: 0.85, fame: 1.08 } },
    3: { fame: 44, eras: 6, schools: 5, themeSize: 7, themeEras: 5, groups: 3, minCards: 8, doubles: 4, income: 3, inkStep: 1, fameTable: [1, 0, 3], schoolMinCards: 10, schoolDeep: true, aiBias: { themes: 1.12, eras: 0.92, schools: 1.1, fame: 1.06 } },
    4: { fame: 44, eras: 6, schools: 5, themeSize: 8, themeEras: 4, groups: 2, minCards: 8, doubles: 4, income: 4, inkStep: 1, fameTable: [0, 0, 2, 5], schoolMinCards: 11, schoolDeep: true, aiBias: { themes: 0.8, fame: 1.0, eras: 0.9 } }
  };


  /* ---------------- 维度定义 ----------------
     只算「人」的维度：词人 / 曲师 / 编曲 / 演唱。
     类型、题材、声库、批次这类标签太容易偶然撞对，
     会让双璧线变成抽卡运气，而不是班底经营。 */
  var PAIR_DIMS = [
    { key: 'lyricist', label: '词人' },
    { key: 'composer', label: '曲师' }
  ];

  /* ---------------- 随机数（可复现） ---------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rnd) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---------------- 卡牌派生 ---------------- */
  function creatorsOf(card) {
    var set = {}, out = [];
    ['lyricist', 'composer', 'arranger', 'singer', 'tuner'].forEach(function (k) {
      (card[k] || []).forEach(function (v) {
        if (v && !set[v]) { set[v] = 1; out.push(v); }
      });
    });
    return out;
  }

  function sharedCreators(card, hand) {
    var mine = creatorsOf(card);
    if (!mine.length || !hand.length) return [];
    var pool = {};
    hand.forEach(function (c) {
      creatorsOf(c).forEach(function (v) { pool[v] = (pool[v] || 0) + 1; });
    });
    return mine.filter(function (v) { return pool[v]; });
  }

  function topGroup(hand) {
    var cnt = {};
    hand.forEach(function (c) { cnt[c.typeGroup] = (cnt[c.typeGroup] || 0) + 1; });
    var best = null, n = 0;
    Object.keys(cnt).forEach(function (k) {
      if (cnt[k] > n) { n = cnt[k]; best = k; }
    });
    return { group: best, count: n };
  }

  /** 评估一张牌对某玩家要多少钱、给多少声名 */
  function evaluate(card, hand, eraTaken, cfg) {
    cfg = cfg || CONFIG;
    var shared = sharedCreators(card, hand);
    var cost = cfg.costBase
      + (card.isSpecial ? cfg.costSpecial : 0)
      + (card.isVirtual ? cfg.costVirtual : 0);
    var disc = 0;
    var reasons = [];

    if (shared.length) {
      var d = Math.min(shared.length, cfg.discountStaffMax) * cfg.discountStaff;
      disc += d;
      reasons.push({ type: 'staff', text: '知音', detail: shared.join('、'), value: d });
    }
    var tg = topGroup(hand);
    if (tg.group && card.typeGroup === tg.group) {
      disc += cfg.discountSameGroup;
      reasons.push({ type: 'group', text: '同流', detail: tg.group, value: cfg.discountSameGroup });
    }
    cost = Math.max(cfg.minCost, cost - disc);

    // ---- 声名
    var fame = cfg.fameBase;
    var parts = [{ text: '入谱', value: cfg.fameBase }];
    if (card.isSpecial) { fame += cfg.fameSpecial; parts.push({ text: '特别篇', value: cfg.fameSpecial }); }
    if (card.isVirtual) { fame += cfg.fameVirtual; parts.push({ text: '中V', value: cfg.fameVirtual }); }
    if (card.hasNote) { fame += cfg.fameNote; parts.push({ text: '已注', value: cfg.fameNote }); }
    if (shared.length) {
      fame += cfg.fameStaff; parts.push({ text: '知音', value: cfg.fameStaff });
      if (shared.length >= 2) { fame += cfg.fameStaff2; parts.push({ text: '强知音', value: cfg.fameStaff2 }); }
    }
    if (!eraTaken) { fame += cfg.fameEraFirst; parts.push({ text: '开段', value: cfg.fameEraFirst }); }

    var sameGroupCount = hand.filter(function (c) { return c.typeGroup === card.typeGroup; }).length;
    var pairBonus = 0;
    if ((sameGroupCount + 1) % 2 === 0 && sameGroupCount >= 1) {
      pairBonus = cfg.famePair;
      fame += pairBonus;
      parts.push({ text: '同流成对', value: pairBonus });
    }

    return {
      cost: cost, fame: fame, discount: disc, shared: shared,
      reasons: reasons, parts: parts, pairBonus: pairBonus,
      sameGroupCount: sameGroupCount
    };
  }

  /** 统计「立派」：同一创作者在本谱 >= schoolSize 首，且一张牌只能计入一派 */
  function countSchools(hand, cfg) {
    cfg = cfg || CONFIG;
    var dims = cfg.schoolDims || ['lyricist', 'composer'];
    var mine = {};
    hand.forEach(function (c, i) {
      var set = {};
      dims.forEach(function (k) {
        (c[k] || []).forEach(function (v) { if (v) set[v] = 1; });
      });
      Object.keys(set).forEach(function (v) { (mine[v] = mine[v] || []).push(i); });
    });
    var cands = Object.keys(mine)
      .filter(function (v) { return mine[v].length >= cfg.schoolSize; })
      .sort(function (a, b) { return mine[b].length - mine[a].length; });
    var used = {}, detail = [];
    cands.forEach(function (name) {
      var free = cfg.schoolExclusive === false ? mine[name].slice() : mine[name].filter(function (i) { return !used[i]; });
      if (free.length >= cfg.schoolSize) {
        // schoolPerTwo：同一创作者每 schoolSize 首算一派（四首即两派），让高产创作者能撑起多派
        var made = cfg.schoolPerTwo ? Math.floor(free.length / cfg.schoolSize) : 1;
        if (cfg.schoolExclusive !== false) free.slice(0, cfg.schoolSize * made).forEach(function (i) { used[i] = 1; });
        detail.push({ name: name, count: free.length, used: cfg.schoolSize * made, made: made });
      }
    });
    var tally = {};
    Object.keys(mine).forEach(function (v) { tally[v] = mine[v].length; });
    var total = 0;
    detail.forEach(function (d) { total += d.made || 1; });
    return { total: total, detail: detail, tally: tally };
  }

  /** 统计「成题」：同一类型大类（史同/架空/人生/文化）累计 >= themeSize 首，且须跨不同年代 */
  function countThemes(hand, cfg) {
    cfg = cfg || CONFIG;
    var byType = {}, tally = {};
    hand.forEach(function (c) {
      var k = c.typeGroup || (c.type || '').split('-')[0] || '未分类';
      (byType[k] = byType[k] || []).push(c);
      tally[k] = (tally[k] || 0) + 1;
    });
    var detail = [];
    Object.keys(byType).forEach(function (k) {
      var list = byType[k];
      var eras = {};
      list.forEach(function (c) { eras[c.era] = 1; });
      var distinct = Object.keys(eras).length;
      if (list.length >= cfg.themeSize && distinct >= Math.min(cfg.themeEras || 99, cfg.themeSize)) {
        detail.push({ name: k, count: list.length, eras: distinct });
      }
    });
    detail.sort(function (a, b) { return b.count - a.count; });
    return { total: detail.length, detail: detail, tally: tally };
  }

  /** 四条终点线的进度 */
  function progress(player, config) {
    var cfg = config || CONFIG;
    var eraTally = {}, eraGroups = {};
    player.hand.forEach(function (c) {
      eraTally[c.era] = (eraTally[c.era] || 0) + 1;
      eraGroups[c.typeGroup] = 1;
    });
    var eraCount = Object.keys(eraTally).length;
    var eraGroupCount = Object.keys(eraGroups).length;
    var eraMin = Math.min.apply(null, Object.keys(eraTally).map(function (k) { return eraTally[k]; }).concat([0]));
    var doubleSegs = Object.keys(eraTally).filter(function (k) { return eraTally[k] >= 2; }).length;
    var perEraOK = eraCount >= cfg.eraTarget &&
      Object.keys(eraTally).every(function (k) { return eraTally[k] >= (cfg.eraMinPerEra || 1); }) &&
      doubleSegs >= (cfg.eraDoubleSegs || 0);
    var schools = countSchools(player.hand, cfg);
    var themes = countThemes(player.hand, cfg);
    return {
      fame: { now: player.fame, target: cfg.fameTarget, ratio: Math.min(1, player.fame / cfg.fameTarget) },
      schools: {
        now: schools.total, target: cfg.schoolTarget,
        ratio: Math.min(1, schools.total / cfg.schoolTarget),
        detail: schools.detail,
        minCards: cfg.schoolMinCards || 0,
        ok: schools.total >= cfg.schoolTarget && (
          player.hand.length >= (cfg.schoolMinCards || 0) ||
          (cfg.schoolDeep && schools.detail.some(function (d) { return (d.count || 0) >= 3; }))
        )
      },
      eras: {
        now: eraCount, target: cfg.eraTarget,
        ratio: Math.min(1, eraCount / cfg.eraTarget),
        mask: eraTally, groups: eraGroupCount, minGroups: cfg.eraMinGroups || 3,
        tally: eraTally, min: eraMin, perEra: cfg.eraMinPerEra || 1, doubles: doubleSegs, needDouble: cfg.eraDoubleSegs || 0,
        ok: perEraOK && eraGroupCount >= (cfg.eraMinGroups || 3)
          && player.hand.length >= (cfg.eraMinCards || 0)
      },
      themes: { now: themes.total, target: cfg.themeTarget, ratio: Math.min(1, themes.total / cfg.themeTarget), detail: themes.detail }
    };
  }

  /* ---------------- 游戏主体 ---------------- */
  function Game(cards, opts) {
    opts = opts || {};
    this.config = Object.assign({}, CONFIG);
    this.overrides = opts.config || {};
    this.cards = {};
    cards.forEach(function (c) { this.cards[c.id || c.name] = c; }, this);
    this.allCards = cards;
    this.rnd = mulberry32(opts.seed == null ? (Date.now() & 0xffffffff) : opts.seed);
    this.eraCount = (opts.eraCount || 6);
    this.setup(opts);
  }

  Game.prototype.setup = function (opts) {
    var self = this;
    var eraCount = this.eraCount;

    // 座位表：默认「你 vs 墨客」，可由 opts.players 覆盖（多人 / 热座 / 人机混合）
    var roster = opts.players && opts.players.length >= 2 ? opts.players : [
      { name: opts.playerName || '你', isAI: false },
      { name: opts.aiName || '墨客', isAI: true }
    ];
    var n = roster.length;

    // 分层牌堆：每段一堆，各自洗牌，保证歌肆年代分布均衡
    var piles = [];
    for (var i = 0; i < eraCount; i++) piles.push([]);
    this.allCards.forEach(function (c) {
      var e = Math.max(0, Math.min(eraCount - 1, c.era | 0));
      piles[e].push(c.id || c.name);
    });
    piles.forEach(function (p) { shuffle(p, self.rnd); });

    // 人多则歌肆更大，否则 4 个人抢 5 张会饿死
    this.marketSize = Math.max(this.config.marketSize, n + 3);

    // 人多时同题更容易凑齐，门槛相应上调（否则成题线会一家独大）
    // 人数越多，每人分到的牌越少，四条线的目标要整体下调（见 BALANCE 表）
    var BAL = BALANCE[n];
    if (BAL) {
      this.config.fameTarget = BAL.fame;
      this.config.eraTarget = BAL.eras;
      this.config.schoolTarget = BAL.schools;
      this.config.themeSize = BAL.themeSize;
      this.config.themeEras = BAL.themeEras;
      if (BAL.groups) this.config.eraMinGroups = BAL.groups;
      if (BAL.minCards) this.config.eraMinCards = BAL.minCards;
      if (BAL.doubles) this.config.eraDoubleSegs = BAL.doubles;
      if (BAL.income) this.config.income = BAL.income;
      if (BAL.inkStep != null) this.config.secondBonus = BAL.inkStep;
      if (BAL.fameTable) this.config.seatFameTable = BAL.fameTable;
    }

    // 显式覆盖放在人数表之后，调试/模拟时才能压过 BALANCE
    Object.assign(this.config, this.overrides);

    /* 出手顺序：order 是「座位下标」的排列。
       默认按座位；opts.firstSeat 指定谁先手（人机局换先后手）。
       补偿一律按「出手位次」发，而不是按座位号——否则换了先后手补偿就发错人。 */
    var n0 = roster.length;
    var first = ((opts.firstSeat | 0) % n0 + n0) % n0;
    var order = [];
    for (var k = 0; k < n0; k++) order.push((first + k) % n0);
    var posOf = {};
    order.forEach(function (idx, p) { posOf[idx] = p; });

    var players = roster.map(function (p, i) {
      var pos = posOf[i] == null ? i : posOf[i];
      return {
        idx: i,
        seat: pos,
        name: p.name,
        isAI: !!p.isAI,
        ink: self.config.startInk + pos * (self.config.secondBonus || 0),
        fame: (self.config.seatFameTable || [0, 0, 0, 0])[pos] || 0,
        hand: [],
        done: []
      };
    });

    this.state = {
      piles: piles,
      market: [],
      players: players,
      order: order,
      seat: 0,
      turn: 0,
      round: 1,
      current: order[0],
      log: [],
      over: false,
      winner: null,
      winBy: null,
      lastAction: null
    };
    this.refill();
    this.log('开卷：' + players[order[0]].name + ' 执先，共 ' + n0 + ' 家。');
  };

  Game.prototype.card = function (id) { return this.cards[id]; };

  Game.prototype.drawOne = function () {
    // 从「歌肆里出现最少」的年代堆抽，保证年代均衡
    var cnt = {};
    var self = this;
    this.state.market.forEach(function (id) {
      var e = self.cards[id].era; cnt[e] = (cnt[e] || 0) + 1;
    });
    var balanced = this.config.balancedDraw !== false;
    var best = null, bestScore = -1e9;
    for (var e = 0; e < this.state.piles.length; e++) {
      var p = this.state.piles[e];
      if (!p.length) continue;
      var score = balanced
        ? (10 - (cnt[e] || 0)) * 10 + p.length * 0.01 + this.rnd() * 0.5
        : this.rnd() * 100;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best && best.length ? best.pop() : null;
  };

  Game.prototype.refill = function () {
    while (this.state.market.length < (this.marketSize || this.config.marketSize)) {
      var id = this.drawOne();
      if (!id) break;
      this.state.market.push(id);
    }
  };

  Game.prototype.log = function (text, kind) {
    this.state.log.push({ t: this.state.round, text: text, kind: kind || 'info' });
    if (this.state.log.length > 200) this.state.log.shift();
  };

  Game.prototype.player = function (i) { return this.state.players[i == null ? this.state.current : i]; };

  Game.prototype.eraTakenBy = function (player, era) {
    return player.hand.some(function (c) { return c.era === era; });
  };

  Game.prototype.preview = function (cardId, playerIdx) {
    var p = this.player(playerIdx);
    var c = this.card(cardId);
    if (!c) return null;
    var taken = this.eraTakenBy(p, c.era);
    var ev = evaluate(c, p.hand, taken, this.config);
    return Object.assign({ card: c, affordable: p.ink >= ev.cost, handFull: !!this.config.handLimit && p.hand.length >= this.config.handLimit }, ev);
  };

  Game.prototype.canPlace = function (cardId, playerIdx) {
    var p = this.player(playerIdx);
    if (this.state.over) return { ok: false, why: '对局已结束' };
    if (this.config.handLimit && p.hand.length >= this.config.handLimit) {
      return { ok: false, why: '词宗谱已满' };
    }
    var idx = this.state.market.indexOf(cardId);
    if (idx < 0) return { ok: false, why: '这张已不在歌肆' };
    var pv = this.preview(cardId, playerIdx);
    if (p.ink < pv.cost) return { ok: false, why: '墨不足' };
    return { ok: true, preview: pv };
  };

  /** 辑录：把歌肆一张牌收入自己谱中 */
  Game.prototype.place = function (cardId, playerIdx) {
    var check = this.canPlace(cardId, playerIdx);
    if (!check.ok) return { ok: false, why: check.why };
    var p = this.player(playerIdx);
    var pv = check.preview;
    var idx = this.state.market.indexOf(cardId);

    p.ink -= pv.cost;
    p.hand.push(pv.card);
    p.fame += pv.fame;
    p.done.push({ card: pv.card, cost: pv.cost, fame: pv.fame, round: this.state.round });

    this.state.market.splice(idx, 1);
    this.refill();

    var bits = ['辑录《' + pv.card.name + '》'];
    if (pv.cost > 0) bits.push('付墨 ' + pv.cost);
    bits.push('得声名 ' + pv.fame);
    if (pv.parts.length > 1) {
      bits.push('（' + pv.parts.slice(1).map(function (x) { return x.text + '+' + x.value; }).join('，') + '）');
    }
    this.log(p.name + ' ' + bits.join('，') + '。', playerIdx === 0 ? 'me' : 'ai');

    this.state.lastAction = { type: 'place', player: playerIdx, card: pv.card, preview: pv };
    this.checkWin(playerIdx);
    return { ok: true, preview: pv };
  };

  /** 采风：得墨，并刷新歌肆 */
  Game.prototype.gather = function (playerIdx) {
    if (this.state.over) return { ok: false, why: '对局已结束' };
    var p = this.player(playerIdx);
    var before = p.ink;
    p.ink = Math.min(this.config.inkCap, p.ink + this.config.gatherInk);
    var gained = p.ink - before;

    var refreshed = 0;
    for (var i = 0; i < this.config.gatherRefresh; i++) {
      if (!this.state.market.length) break;
      this.state.market.shift();          // 弃掉最左一张
      refreshed++;
    }
    this.refill();

    this.log(p.name + ' 采风，得墨 ' + gained + (refreshed ? '，换去歌肆 ' + refreshed + ' 张' : '') + '。',
      playerIdx === 0 ? 'me' : 'ai');
    this.state.lastAction = { type: 'gather', player: playerIdx, ink: gained };
    return { ok: true, gained: gained, refreshed: refreshed };
  };

  Game.prototype.checkWin = function (playerIdx) {
    var p = this.player(playerIdx);
    var pg = progress(p, this.config);
    var by = null;
    if (pg.fame.now >= this.config.fameTarget) by = 'fame';
    else if (pg.schools.ok) by = 'schools';
    else if (pg.eras.ok) by = 'eras';
    else if (pg.themes.now >= this.config.themeTarget) by = 'themes';
    if (by) {
      this.state.over = true;
      this.state.winner = playerIdx;
      this.state.winBy = by;
      var label = by === 'fame' ? '声名' : by === 'schools' ? '立派' : by === 'themes' ? '成题' : '通史';
      this.log(p.name + ' 以「' + label + '」立谱，对局终。', 'win');
      return true;
    }
    return false;
  };

  /** 结束当前回合，按出手顺序换手；若回到本轮的执先者则轮次 +1 */
  Game.prototype.endTurn = function () {
    if (this.state.over) return;
    var order = this.state.order;
    this.state.seat = (this.state.seat + 1) % order.length;
    this.state.current = order[this.state.seat];
    if (this.state.seat === 0) {
      this.state.round++;
      if (this.state.round > this.config.maxRounds) {
        this.forceEnd();
        return;
      }
    }
    var p = this.player(this.state.current);
    p.ink = Math.min(this.config.inkCap, p.ink + this.config.income);
  };

  Game.prototype.forceEnd = function () {
    var self = this;
    var best = -1, winner = 0, tie = false;
    this.state.players.forEach(function (p, i) {
      var pg = progress(p, self.config);
      var sc = pg.fame.ratio + pg.schools.ratio + pg.eras.ratio + pg.themes.ratio;
      if (sc > best + 1e-9) { best = sc; winner = i; tie = false; }
      else if (Math.abs(sc - best) <= 1e-9) { tie = true; }
    });
    if (tie) {
      var top = this.state.players.slice().sort(function (a, b) { return b.fame - a.fame; });
      winner = top[0].idx;
    }
    this.state.over = true;
    this.state.winner = winner;
    this.state.winBy = 'timeout';
    this.log('卷终，以三条线总进度定胜负。', 'win');
  };

  /* ---------------- 导出 ---------------- */
  var api = {
    CONFIG: CONFIG,
    BALANCE: BALANCE,
    PAIR_DIMS: PAIR_DIMS,
    Game: Game,
    evaluate: evaluate,
    countSchools: countSchools,
    countThemes: countThemes,
    progress: progress,
    creatorsOf: creatorsOf,
    sharedCreators: sharedCreators,
    shuffle: shuffle,
    mulberry32: mulberry32
  };
  return api;
});
