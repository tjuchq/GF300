/* ===========================================================
   三百首·词宗 — 墨客（AI）
   三步：定主线 → 逐牌评分 → 出手或采风
   =========================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.SBAI = factory(root.SBEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  /* 难度参数：配平工具可改；默认值即线上行为 */
  var TUNE = {
    noise: { easy: 9.0, normal: 0.7, hard: 0 },      // 评分噪声
    floor: { easy: -1.2, normal: 0.12, hard: 0.3 },  // 低于此分不买
    easyBest: 0.05,   // 初涉：前 5% 拿最优
    easyMid: 0.15,    // 初涉：再 10% 拿二三优
    easyJunk: 0.8,    // 初涉：没牌可买时硬拿废牌的概率
    easyPlan: 0.3,    // 初涉：三成回合看错主线（随机选一条）
    chain: { easy: 0.2, normal: 0.8, hard: 1.6 },    // 知音连锁的权重
    deny: { normal: 1, hard: 1.4 },                  // 阻断意识（老吏更会卡人）
    normalGather: 0.08,                              // 熟手偶尔「歇一手」去采风
    hardWinNow: true,                                // 老吏：先看「这一张能不能直接赢」
    hardBlock: true,                                 // 老吏：对手下一张就能赢时，抢掉那张
    hardSeatCatch: true,                             // 老吏后手：更积极（降门槛、加阻断）
    easyMistakeByN: { 2: [0.025, 0], 3: [0.025, 0, 0.01], 4: [0.02, 0, 0.008, 0.032] },  // 初涉：各手位「故意失误」率（该买却采风，不改策略）
    hardMistakeByN: { 2: [0, 0], 3: [0.03, 0.035, 0], 4: [0.035, 0.05, 0.01, 0] },  // 老吏：各手位「故意失误」率（同上，只削先手）
    hardNoiseByN: {                                  // 老吏：手位噪声（削先手，压平座位差）
      2: [1.2, 0],
      3: [1.4, 0, 0],
      4: [1.6, 0.9, 0, 0]
    },
  };

  function avgFamePerCard(game, p) {
    if (!p.hand.length) return 3.2;
    var sum = 0;
    p.hand.forEach(function (c) {
      var ev = E.evaluate(c, [], true, game.config);
      sum += ev.fame;
    });
    return Math.max(2, sum / p.hand.length);
  }

  /** 估一下三条线各还差几张牌，挑最省的那条当主线 */
  function pickPlan(game, playerIdx) {
    var cfg = game.config;
    var p = game.player(playerIdx);
    var pg = E.progress(p, cfg);
    var slots = cfg.handLimit ? cfg.handLimit - p.hand.length : 99;
    var avg = avgFamePerCard(game, p);

    // 每条线换算成「还差几张牌」，才好在同一尺度上比
    var tTally = E.countThemes(p.hand, cfg).tally || {};
    var tTopKey = null, tTopN = 0;
    Object.keys(tTally).forEach(function (k) {
      if (tTally[k] > tTopN) { tTopN = tTally[k]; tTopKey = k; }
    });
    var tEras = 0;
    if (tTopKey) {
      var eset = {};
      p.hand.forEach(function (c) { if (c.typeGroup === tTopKey) eset[c.era] = 1; });
      tEras = Object.keys(eset).length;
    }
    var eraMissing = Math.max(0, cfg.eraTarget - pg.eras.now);
    var doubleMissing = Math.max(0, (cfg.eraDoubleSegs || 0) - (pg.eras.doubles || 0));
    var groupMissing = Math.max(0, (cfg.eraMinGroups || 0) - (pg.eras.groups || 0));
    var bias = cfg.aiBias || {};
    var plans = [
      { key: 'fame',  need: Math.max(0, (cfg.fameTarget - pg.fame.now) / avg) },
      { key: 'schools', need: Math.max(0, (cfg.schoolTarget - pg.schools.now) * 2.0) },
      { key: 'eras',  need: eraMissing + doubleMissing * 0.7 + groupMissing * 0.6 },
      // 成题要同时满足「首数」与「跨代」，缺一不可：取两者中更缺的那个
      { key: 'themes', need: Math.max(0, cfg.themeSize - tTopN, (cfg.themeEras || 0) - tEras) }
    ];
    // 主线权重：规则不改，只让墨客别一窝蜂挤同一条线（配平工具用）
    plans.forEach(function (x) { x.need *= (bias[x.key] == null ? 1 : bias[x.key]); x.feasible = x.need <= slots + 0.01; });
    var ok = plans.filter(function (x) { return x.feasible; });
    if (!ok.length) ok = plans;
    ok.sort(function (a, b) { return a.need - b.need; });
    return { plan: ok[0].key, need: ok[0].need, slots: slots, progress: pg, themeTop: tTopKey };
  }

  /** 这一张买下去能否直接走通任意一条线（含本次买牌带来的声名） */
  function winsWith(game, playerIdx, card) {
    var cfg = game.config;
    var p = game.player(playerIdx);
    var pv = game.preview(card.id, playerIdx);
    if (!pv) return false;
    if (p.ink < pv.cost) return false;          // 买不起就谈不上威胁/制胜
    if (p.fame + pv.fame >= cfg.fameTarget) return true;
    p.hand.push(card);
    var pg = E.progress(p, cfg);
    p.hand.pop();
    return !!(pg.schools.ok || pg.eras.ok || pg.themes.now >= (cfg.themeTarget || 1));
  }

  function scoreCard(game, playerIdx, card, planInfo, difficulty) {
    var cfg = game.config;
    var p = game.player(playerIdx);
    var foes = game.state.players.filter(function (x) { return x.idx !== playerIdx; });
    var pv = game.preview(card.id, playerIdx);
    if (!pv) return -1e9;
    if (p.ink < pv.cost) return -1e9;
    if (cfg.handLimit && p.hand.length >= cfg.handLimit) return -1e9;

    var s = 0;
    if (difficulty === 'easy') {
      // 初涉的估值歪了：只看「便宜」，声名权重很低
      s += pv.fame * 0.5;
      s -= pv.cost * 1.1;
    } else {
      s += pv.fame * 1.0;
      s -= pv.cost * 0.55;
    }

    var plan = planInfo.plan;
    var pg = planInfo.progress;

    // 主线加成
    if (plan === 'eras') {
      if (!game.eraTakenBy(p, card.era)) s += 3.2;
      else s -= 0.8;
    } else if (plan === 'themes') {
      var tTally = E.countThemes(p.hand, cfg).tally || {};
      var cnt = tTally[card.typeGroup] || 0;
      var eset = {}, eras = 0;
      p.hand.forEach(function (c) { if (c.typeGroup === card.typeGroup) eset[c.era] = 1; });
      eras = Object.keys(eset).length;
      var newEra = !eset[card.era];
      var afterN = cnt + 1, afterE = eras + (newEra ? 1 : 0);
      if (afterN >= cfg.themeSize && afterE >= (cfg.themeEras || 0)) s += 7;      // 这一张就成题
      else if (afterN >= cfg.themeSize) s += 3;                                    // 首数够了，还差跨代
      else if (cnt >= cfg.themeSize - 2) s += 2.2;                                 // 只差一两张
      else if (cnt >= 1) s += 0.6;
      if (newEra && afterE >= (cfg.themeEras || 0)) s += 1.2;                      // 把跨代补齐
      if (card.typeGroup !== planInfo.themeTop && cnt === 0) s -= 0.8;             // 另起一题更慢
    } else if (plan === 'schools') {
      var tally = pg.schools ? (E.countSchools(p.hand).tally || {}) : {};
      var staff = E.staffOf(card);
      var near = staff.filter(function (v) { return (tally[v] || 0) >= cfg.schoolSize - 1; });
      var seeded = staff.filter(function (v) { return (tally[v] || 0) === 1; });
      if (near.length) s += 3.2 * near.length;
      s += Math.min(seeded.length, 2) * 0.55;
      if (near.length && pg.schools.now + 1 >= cfg.schoolTarget) s += 5;
    } else {
      s += pv.fame * 0.55;
      if (pg.fame.now + pv.fame >= cfg.fameTarget) s += 6;
    }

    // 知音连锁：这张能带出下一次减费（老吏更看重）
    if (pv.shared.length >= 2) s += (TUNE.chain[difficulty] != null ? TUNE.chain[difficulty] : 0.8);

    // 阻断：对手很想要的，抢过来
    if (difficulty !== 'easy') {
      // 多人局：按「最强的那个对手」算阻断价值
      var topShared = 0, eraWanted = false;
      foes.forEach(function (foe) {
        var n = E.sharedCreators(card, foe.hand).length;
        if (n > topShared) topShared = n;
        if (!game.eraTakenBy(foe, card.era)) {
          var fp = pickPlan(game, foe.idx);
          if (fp.plan === 'eras') eraWanted = true;
        }
      });
      var deny = TUNE.deny[difficulty] || 1;
      if (difficulty === 'hard' && TUNE.hardSeatCatch && p.seat > 0) deny *= (1 + 0.12 * p.seat);
      if (difficulty === 'hard' && TUNE.hardBlock) {
        foes.forEach(function (foe) {
          if (winsWith(game, foe.idx, card)) s += 8 * deny;   // 抢掉对手的制胜牌
        });
      }
      if (topShared >= 2) s += 1.6 * deny;
      else if (topShared === 1) s += 0.7 * deny;
      if (eraWanted) s += 0.9 * deny;
    }

    // 难度噪声
    var noise = TUNE.noise[difficulty] != null ? TUNE.noise[difficulty] : 0.9;
    if (difficulty === 'hard' && TUNE.hardNoiseByN) {
      var hnArr = TUNE.hardNoiseByN[game.state.players.length] || [];
      var hn = hnArr[p.seat || 0] || 0;
      if (hn) s += (game.rnd() - 0.5) * hn;   // 首位的额外噪声：偶尔选次优，专门削先手
    }
    s += (game.rnd() - 0.5) * noise;

    return s;
  }

  /** 按难度在「候选排名」里抽一张
   *  一档：50% 最优 / 25% 次优或三优 / 25% 前三名之外
   *  二档：50% 最优 / 50% 次优或三优
   *  三档：100% 最优
   */
  function pickByRank(cands, difficulty, rnd) {
    if (!cands.length) return null;
    if (difficulty === 'hard' || cands.length === 1) return cands[0];
    var r = rnd();
    if (difficulty === 'easy') {
      if (r < TUNE.easyBest) return cands[0];
      if (r < TUNE.easyMid) {
        var k = 1 + Math.floor(rnd() * Math.min(2, cands.length - 1));
        return cands[k] || cands[0];
      }
      // 只在前三名之外挑；候选不足四张时退化成最差的一张
      if (cands.length > 3) return cands[3 + Math.floor(rnd() * (cands.length - 3))];
      return cands[cands.length - 1];
    }
    if (r < 0.5 || cands.length === 2) return r < 0.5 ? cands[0] : cands[1];
    var j = 1 + Math.floor(rnd() * Math.min(2, cands.length - 1));
    return cands[j] || cands[0];
  }

  /** 返回一步：{type:'place', cardId} 或 {type:'gather'} */
  function decide(game, playerIdx, difficulty, forcePlan) {
    difficulty = difficulty || 'normal';
    var p = game.player(playerIdx);
    if (game.config.handLimit && p.hand.length >= game.config.handLimit) return { type: 'gather', reason: '谱满' };
    var planInfo = pickPlan(game, playerIdx);
    // 初涉的小毛病：三成回合看错主线，按别的主线买牌
    if (difficulty === 'easy' && TUNE.easyPlan && game.rnd() < TUNE.easyPlan) {
      var allPlans = ['fame', 'eras', 'schools', 'themes'];
      planInfo = Object.assign({}, planInfo, { plan: allPlans[Math.floor(game.rnd() * 4)] });
    }
    // 熟手的小毛病：偶尔该买也不买，去采风歇一手
    if (difficulty === 'normal' && TUNE.normalGather && game.rnd() < TUNE.normalGather) {
      return { type: 'gather', plan: planInfo.plan, reason: '歇一手' };
    }
    // forcePlan：配平工具用，强制只走某一条线（用于测「达成轮次期望」）
    if (forcePlan) planInfo = Object.assign({}, planInfo, { plan: forcePlan });

    // 初涉「故意失误」：按手位概率放弃这一手去买（改成采风），位置不限
    if (difficulty === 'easy' && TUNE.easyMistakeByN) {
      var emArr = TUNE.easyMistakeByN[game.state.players.length] || [];
      var em = emArr[p.seat || 0] || 0;
      if (em && game.rnd() < em) return { type: 'gather', plan: planInfo.plan, mistake: true };
    }

    // 老吏「故意失误」：按手位概率放弃这一手（该买却采风），只削先手
    if (difficulty === 'hard' && TUNE.hardMistakeByN) {
      var hmArr = TUNE.hardMistakeByN[game.state.players.length] || [];
      var hm = hmArr[p.seat || 0] || 0;
      if (hm && game.rnd() < hm) return { type: 'gather', plan: planInfo.plan, mistake: true };
    }

    // 只把「买得起且谱未满」的牌放进候选，再按分数排名
    var cands = [];
    game.state.market.forEach(function (id) {
      var chk = game.canPlace(id, playerIdx);
      if (!chk.ok) return;
      var c = game.card(id);
      cands.push({ id: id, score: scoreCard(game, playerIdx, c, planInfo, difficulty) });
    });
    if (!cands.length) return { type: 'gather', plan: planInfo.plan };
    cands.sort(function (a, b) { return b.score - a.score; });

    // 老吏算杀：有任何一张能直接走通一条线，立刻拿（同能赢时取声名高的）
    if (difficulty === 'hard' && TUNE.hardWinNow) {
      var killers = cands.filter(function (x) { return winsWith(game, playerIdx, game.card(x.id)); });
      if (killers.length) {
        killers.sort(function (a, b) {
          var fa = game.preview(a.id, playerIdx).fame, fb = game.preview(b.id, playerIdx).fame;
          return fb - fa;
        });
        return { type: 'place', cardId: killers[0].id, plan: planInfo.plan, winNow: true };
      }
    }

    // 低于门槛就不买（低档 AI 门槛更低，会拿一些废牌；高档只拿有价值的）
    var floor = TUNE.floor[difficulty] != null ? TUNE.floor[difficulty] : 0.12;
    // 老吏后手：门槛随位次下压，宁可多买一张也不空转
    if (difficulty === 'hard' && TUNE.hardSeatCatch && p.seat > 0) floor = Math.max(0.05, floor - 0.1 * p.seat);
    var pick = pickByRank(cands, difficulty, game.rnd);
    if (!pick || pick.score < floor) {
      // 手上有钱却没牌可买：高档 AI 宁可采风换牌，初涉会乱拿一张（最优除外）
      if (difficulty === 'easy' && cands.length && game.rnd() < TUNE.easyJunk) {
        pick = cands.length > 1
          ? cands[1 + Math.floor(game.rnd() * (cands.length - 1))]
          : cands[0];
      }
      else return { type: 'gather', plan: planInfo.plan };
    }

    var chk2 = game.canPlace(pick.id, playerIdx);
    if (!chk2.ok) return { type: 'gather', plan: planInfo.plan };
    return { type: 'place', cardId: pick.id, plan: planInfo.plan, rank: cands.indexOf(pick) };
  }

  return { decide: decide, pickPlan: pickPlan, scoreCard: scoreCard, pickByRank: pickByRank, TUNE: TUNE };
});
