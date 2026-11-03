/* ===========================================================
   三百首·词宗 — 墨客（AI）
   三步：定主线 → 逐牌评分 → 出手或采风
   =========================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.SBAI = factory(root.SBEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

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

  function scoreCard(game, playerIdx, card, planInfo, difficulty) {
    var cfg = game.config;
    var p = game.player(playerIdx);
    var foes = game.state.players.filter(function (x) { return x.idx !== playerIdx; });
    var pv = game.preview(card.id, playerIdx);
    if (!pv) return -1e9;
    if (p.ink < pv.cost) return -1e9;
    if (cfg.handLimit && p.hand.length >= cfg.handLimit) return -1e9;

    var s = 0;
    s += pv.fame * 1.0;
    s -= pv.cost * 0.55;

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
      var near = E.creatorsOf(card).filter(function (v) { return (tally[v] || 0) >= cfg.schoolSize - 1; });
      var seeded = E.creatorsOf(card).filter(function (v) { return (tally[v] || 0) === 1; });
      if (near.length) s += 3.2 * near.length;
      s += Math.min(seeded.length, 2) * 0.55;
      if (near.length && pg.schools.now + 1 >= cfg.schoolTarget) s += 5;
    } else {
      s += pv.fame * 0.55;
      if (pg.fame.now + pv.fame >= cfg.fameTarget) s += 6;
    }

    // 知音连锁：这张能带出下一次减费
    if (pv.shared.length >= 2) s += 0.8;

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
      if (topShared >= 2) s += 1.6;
      else if (topShared === 1) s += 0.7;
      if (eraWanted) s += 0.9;
    }

    // 难度噪声
    var noise = difficulty === 'easy' ? 3.5 : difficulty === 'hard' ? 0.25 : 0.9;
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
      if (r < 0.3) return cands[0];
      if (r < 0.55) {
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
    // forcePlan：配平工具用，强制只走某一条线（用于测「达成轮次期望」）
    if (forcePlan) planInfo = Object.assign({}, planInfo, { plan: forcePlan });

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

    // 低于门槛就不买（低档 AI 门槛更低，会拿一些废牌；高档只拿有价值的）
    var floor = difficulty === 'easy' ? -0.3 : difficulty === 'hard' ? 0.3 : 0.12;
    var pick = pickByRank(cands, difficulty, game.rnd);
    if (!pick || pick.score < floor) {
      // 手上有钱却没牌可买：高档 AI 宁可采风换牌，低档 AI 会硬拿一张
      if (difficulty === 'easy' && cands.length && game.rnd() < 0.5) pick = cands[0];
      else return { type: 'gather', plan: planInfo.plan };
    }

    var chk2 = game.canPlace(pick.id, playerIdx);
    if (!chk2.ok) return { type: 'gather', plan: planInfo.plan };
    return { type: 'place', cardId: pick.id, plan: planInfo.plan, rank: cands.indexOf(pick) };
  }

  return { decide: decide, pickPlan: pickPlan, scoreCard: scoreCard, pickByRank: pickByRank };
});
