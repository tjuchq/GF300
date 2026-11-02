/* ===========================================================
   三百首·词宗 — 界面与交互
   支持 2–4 人：人机混编 / 同屏热座
   =========================================================== */
(function () {
  'use strict';

  var E = window.SBEngine;
  var AI = window.SBAI;

  var AI_NAMES = ['墨客', '书客', '评话人', '抄书吏'];
  var HUMAN_NAMES = ['你', '玩家二', '玩家三', '玩家四'];
  var CN = ['一', '二', '三', '四'];

  var App = {
    data: null,
    game: null,
    difficulty: 'easy',
    count: 2,
    mode: 'deck',
    humanFirst: true,
    seats: [],
    busy: false,
    usingOverride: false,
    lib: null
  };
  window.SBApp = App;

  /* ---------------- 工具 ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(t, c, h) { var d = document.createElement(t); if (c) d.className = c; if (h != null) d.innerHTML = h; return d; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function join(a, s) { return (a && a.length) ? a.join(s || '、') : ''; }

  function toast(msg, ms) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('show'); }, ms || 2100);
  }
  function floatFame(text, x, y) {
    var d = el('div', 'float-fame', text);
    d.style.left = x + 'px'; d.style.top = y + 'px';
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 1000);
  }

  /* ---------------- 数据 ---------------- */
  function loadData() {
    var base = window.GAME_DATA;
    try {
      var raw = localStorage.getItem('sb_cards_override');
      if (raw) {
        var o = JSON.parse(raw);
        if (o && o.cards && o.cards.length) { base = o; App.usingOverride = true; }
      }
    } catch (e) { /* ignore */ }
    App.data = base;
    return base;
  }

  /* ---------------- 开场 ---------------- */
  function renderIntro() {
    var meta = App.data.meta || {};
    var cards = App.data.cards;
    var years = cards.map(function (c) { return c.year; }).filter(Boolean);
    var noted = cards.filter(function (c) { return c.noteCount > 0; }).length;
    var creators = {};
    cards.forEach(function (c) {
      ['lyricist', 'composer', 'singer'].forEach(function (k) {
        (c[k] || []).forEach(function (v) { creators[v] = 1; });
      });
    });
    $('#intro-stats').innerHTML = [
      [cards.length, '首歌曲'],
      [Math.min.apply(null, years) + '–' + Math.max.apply(null, years), '年代'],
      [noted, '首有笺注'],
      [Object.keys(creators).length, '位创作者']
    ].map(function (x) { return '<div class="st"><b>' + x[0] + '</b><span>' + x[1] + '</span></div>'; }).join('');

    $('#src-meta').textContent = '· 数据版本 ' + (meta.generatedAt || '未知') + (App.usingOverride ? '（本地导入版）' : '');
    buildSeats();
  }

  function buildSeats() {
    if (!App.seats.length) {
      App.seats = [];
      for (var i = 0; i < 4; i++) {
        App.seats.push({ name: i === 0 ? HUMAN_NAMES[0] : AI_NAMES[i - 1], isAI: i !== 0, manual: false });
      }
    }
    var wrap = $('#seats');
    wrap.innerHTML = '';
    for (var i = 0; i < App.count; i++) {
      (function (idx) {
        var st = App.seats[idx];
        var row = el('div', 'seat');
        row.innerHTML =
          '<span class="idx">' + CN[idx] + '</span>' +
          '<input value="' + esc(st.name) + '" maxlength="8" ' + (idx === 0 ? '' : '') + '>' +
          '<button class="kind" data-k="' + (st.isAI ? 'ai' : 'human') + '">' + (st.isAI ? '机' : '人') + '</button>';
        var inp = row.querySelector('input');
        inp.addEventListener('input', function () {
          st.name = inp.value.trim() || (st.isAI ? AI_NAMES[idx - 1] || '墨客' : HUMAN_NAMES[idx]);
          st.manual = true;
        });
        var kb = row.querySelector('.kind');
        kb.addEventListener('click', function () {
          if (idx === 0) { toast('首位固定为「人」，其余座位可切换'); return; }
          st.isAI = !st.isAI;
          if (!st.manual) {
            st.name = st.isAI ? (AI_NAMES[idx - 1] || '墨客') : (HUMAN_NAMES[idx] || ('玩家' + (idx + 1)));
            inp.value = st.name;
          }
          kb.dataset.k = st.isAI ? 'ai' : 'human';
          kb.textContent = st.isAI ? '机' : '人';
        });
        wrap.appendChild(row);
      })(i);
    }
  }

  /* ---------------- 渲染 ---------------- */
  function curPlayer() { return App.game.state.players[App.game.state.current]; }
  function isHumanTurn() {
    var g = App.game;
    return g && !g.state.over && !App.busy && !curPlayer().isAI;
  }

  function renderAll() {
    var g = App.game;
    if (!g) return;
    var cur = g.state.current, over = g.state.over;

    $('#round-label').textContent = '第 ' + g.state.round + ' 轮';
    var eraNote = $('#era-note');
    if (eraNote) eraNote.textContent = g.config.eraTarget + ' 段 · ' +
      g.config.eraDoubleSegs + ' 段双收 · 跨 ' + g.config.eraMinGroups + ' 题';
    $('#turn-label').textContent = over ? '终局' : (curPlayer().isAI ? curPlayer().name + ' 正在思量' : '轮到 ' + curPlayer().name);

    // 记分
    $('#scorebar').innerHTML = g.state.players.map(function (p, i) {
      return '<div class="sc' + (i === cur && !over ? ' now' : '') + '">' + esc(p.name) + '<b>' + p.fame + '</b></div>';
    }).join('');

    // 对手
    var foes = g.state.players.filter(function (p) { return p.idx !== 0; });
    var wrap = $('#foes');
    wrap.dataset.n = String(foes.length);
    wrap.innerHTML = '';
    foes.forEach(function (p) { wrap.appendChild(buildZone(p, true)); });

    // 自己
    var me = g.state.players[0];
    var z = $('#zone-me');
    z.className = 'zone me' + (cur === 0 && !over ? ' now' : '');
    z.innerHTML = '';
    z.appendChild(buildZoneInner(me, false));

    renderMarket();
    renderTimeline();
    renderSide();
    renderLog();

    $('#btn-gather').disabled = !isHumanTurn();
  }

  function buildZone(p, compact) {
    var d = el('section', 'zone' + (p.idx === App.game.state.current && !App.game.state.over ? ' now' : ''));
    d.appendChild(buildZoneInner(p, compact));
    return d;
  }

  function buildZoneInner(p, compact) {
    var g = App.game;
    var frag = document.createDocumentFragment();

    var head = el('div', 'zone-head');
    head.innerHTML =
      '<span class="who">' + esc(p.name) +
        (p.idx === g.state.current && !g.state.over ? '<span class="now-tag">此刻</span>' : '') +
        (p.isAI ? '<span class="now-tag" style="color:var(--ink-4);border-color:var(--line)">机</span>' : '') +
      '</span>' +
      '<span class="chip ink">墨 <b>' + p.ink + '</b></span>' +
      '<span class="chip">声名 <b>' + p.fame + '</b></span>' +
      '<span class="chip">谱 <b>' + p.hand.length + '</b></span>';
    frag.appendChild(head);

    var hand = el('div', 'hand-row');
    p.hand.forEach(function (c) {
      var d = el('div', 'mini' + (c.isSpecial ? ' sp' : ''));
      d.innerHTML = '<b>' + esc(c.name) + '</b><span class="y">' + (c.year || '') + ' · ' + esc((c.type || '').split('-')[0]) + '</span>';
      d.title = '《' + c.name + '》' + c.year + '　' + (c.type || '');
      d.addEventListener('click', function () { openCard(c, g.preview(c.id, p.idx)); });
      hand.appendChild(d);
    });
    frag.appendChild(hand);

    var pg = E.progress(p, g.config);
    var cfg2 = g.config;
    var goals = el('div', 'goals');

    /* 通史不是「六段满了」就算：还要三段双收、跨三题。
       所以进度条取三者中最短的一截，避免出现 6/6 却判负的假完成。 */
    var eraN = pg.eras.now, dbl = pg.eras.doubles || 0, grp = pg.eras.groups || 0;
    var needDbl = cfg2.eraDoubleSegs || 0, needGrp = cfg2.eraMinGroups || 0;
    var eraBar = Math.min(1,
      eraN / cfg2.eraTarget,
      needDbl ? dbl / needDbl : 1,
      needGrp ? grp / needGrp : 1);

    // 成题：取最接近的那个主题，同时看首数与跨代
    var tTally2 = E.countThemes(p.hand, cfg2).tally || {};
    var tKeys = Object.keys(tTally2).sort(function (a, b) { return tTally2[b] - tTally2[a]; });
    var tTop = tKeys[0], tTopN = tTop ? tTally2[tTop] : 0;
    var tEras = 0;
    if (tTop) {
      var eset = {};
      p.hand.forEach(function (c) { if (c.typeGroup === tTop) eset[c.era] = 1; });
      tEras = Object.keys(eset).length;
    }
    var themeBar = Math.min(1, tTopN / cfg2.themeSize, cfg2.themeEras ? tEras / cfg2.themeEras : 1);

    [
      { n: '声名', v: pg.fame.now, t: pg.fame.target, bar: pg.fame.now / pg.fame.target },
      {
        n: '通史', v: eraN, t: cfg2.eraTarget, bar: eraBar, done: pg.eras.ok,
        sub: '双' + dbl + '/' + needDbl + '·跨' + grp + '/' + needGrp
      },
      { n: '立派', v: pg.schools.now, t: cfg2.schoolTarget, bar: pg.schools.now / cfg2.schoolTarget },
      {
        n: '成题', v: tTopN, t: cfg2.themeSize, bar: themeBar,
        done: pg.themes.now >= pg.themes.target, sub: '跨' + tEras + '/' + cfg2.themeEras + '代', tip: tTop
      }
    ].forEach(function (x) {
      var done = x.done != null ? x.done : x.v >= x.t;
      var bar = Math.max(0, Math.min(100, 100 * (x.bar == null ? x.v / x.t : x.bar)));
      var cell = el('div', 'goal' + (done ? ' done' : ''),
        '<span>' + x.n + '</span><span class="bar"><i style="width:' + bar + '%"></i></span>' +
        '<span class="num">' + x.v + '/' + x.t + '</span>' +
        (x.sub ? '<span class="sub">' + x.sub + '</span>' : ''));
      if (x.tip) cell.title = '最接近的主题：' + x.tip + '（' + x.v + '/' + x.t + ' 首，跨 ' + tEras + ' 代）';
      goals.appendChild(cell);
    });
    var tips = [];
    if (pg.schools.detail.length) tips.push('已立：' + pg.schools.detail.map(function (d) { return d.name + '（' + d.count + ' 首）'; }).join('、'));
    if (tips.length) goals.title = tips.join('　');
    frag.appendChild(goals);
    return frag;
  }

  /** 班底固定三行，行内超长省略，避免把「唱」挤掉 */
  function staffLine(label, arr) {
    if (!arr || !arr.length) return '';
    return '<div><span>' + label + '</span>' + esc(arr.join('、')) + '</div>';
  }
  function cardStaffLine(c) {
    var lines = [
      staffLine('词', c.lyricist),
      staffLine('曲', c.composer),
      staffLine('唱', c.singer.length ? c.singer : c.voicebank)
    ].filter(Boolean);
    if (!lines.length && c.arranger.length) lines.push(staffLine('编', c.arranger));
    return lines.join('');
  }
  /** 歌名过长自动降一档字号 */
  function nameClass(name) {
    var n = (name || '').length;
    if (n >= 9) return ' len3';
    if (n >= 6) return ' len2';
    return '';
  }

  function renderMarket() {
    var g = App.game;
    var wrap = $('#market');
    var cur = g.state.current;
    var canAct = isHumanTurn();
    wrap.innerHTML = '';

    g.state.market.forEach(function (id) {
      var c = g.card(id);
      var pv = g.preview(id, cur);
      var chk = g.canPlace(id, cur);
      var can = canAct && chk.ok;

      var d = el('div', 'card' + (c.isSpecial ? ' sp' : '') + (c.isVirtual ? ' virtual' : '') + (can ? '' : ' dead'));
      d.dataset.id = id;
      d.innerHTML =
        '<div class="c-top">' +
          '<span class="c-year">' + (c.year || '—') + '</span>' +
          (c.isSpecial ? '<span class="c-tag">特别篇</span>' : '') +
          (c.isVirtual ? '<span class="c-tag v">中V</span>' : '') +
          (c.hasNote ? '<span class="c-note">注' + (c.noteCount > 1 ? c.noteCount : '') + '</span>' : '') +
        '</div>' +
        '<div class="c-name' + nameClass(c.name) + '">' + esc(c.name) + '</div>' +
        '<div class="c-type">' + esc(c.type || c.typeGroup) + '</div>' +
        '<div class="c-staff">' + cardStaffLine(c) + '</div>' +
        '<div class="c-foot">' +
          '<span class="c-cost">' + pv.cost + (pv.discount ? '<s>' + (pv.cost + pv.discount) + '</s>' : '') + '</span>' +
          '<span class="c-fame">+' + pv.fame + '<em>声名</em></span>' +
        '</div>';

      d.addEventListener('mouseenter', function () { showHint(c, pv); });
      d.addEventListener('click', function () {
        if (!can) {
          toast(g.state.over ? '对局已结束'
            : (App.busy ? '稍候'
              : (curPlayer().isAI ? '等 ' + curPlayer().name + ' 走完这一手'
                : (chk.why || '现在不能辑录'))));
          return;
        }
        doPlace(id, d);
      });
      d.addEventListener('contextmenu', function (e) { e.preventDefault(); openCard(c, pv); });
      wrap.appendChild(d);
    });
  }

  function showHint(c, pv) {
    var g = App.game;
    var parts = ['《' + c.name + '》' + (c.year ? ' ' + c.year : '')];
    if (pv.discount) {
      parts.push('费 ' + pv.cost + '（' + pv.reasons.map(function (r) { return r.text + '−' + r.value; }).join('，') + '）');
    } else parts.push('费 ' + pv.cost);
    parts.push('声名 +' + pv.fame + '（' + pv.parts.map(function (p) { return p.text + '+' + p.value; }).join('，') + '）');
    $('#hint-text').textContent = parts.join('　·　');

    var side = [];
    if (pv.shared.length) side.push('知音 ' + pv.shared.slice(0, 3).join('、'));
    if (!g.eraTakenBy(g.state.players[g.state.current], c.era)) side.push('开段 +1');
    $('#hint-side').textContent = side.join('　');
  }

  function renderTimeline() {
    var g = App.game, wrap = $('#timeline');
    var eras = App.data.meta.eras || [];
    wrap.innerHTML = '';
    eras.forEach(function (e, i) {
      var mine = [], rivals = [];
      g.state.players.forEach(function (p) {
        var list = p.hand.filter(function (c) { return c.era === i; });
        if (p.idx === 0) mine = list; else rivals = rivals.concat(list);
      });
      var cls = 'era';
      if (mine.length) cls += ' has-me';
      else if (rivals.length) cls += ' has-ai';

      var slots = '';
      mine.slice(0, 1).forEach(function (c) { slots += '<span class="slot me">' + esc(c.name) + '</span>'; });
      if (mine.length > 1) slots += '<span class="era-more">你 +' + (mine.length - 1) + '</span>';
      rivals.slice(0, 1).forEach(function (c) { slots += '<span class="slot ai">' + esc(c.name) + '</span>'; });
      if (rivals.length > 1) slots += '<span class="era-more">他 +' + (rivals.length - 1) + '</span>';
      if (!slots) slots = '<span class="era-more">—</span>';

      wrap.appendChild(el('div', cls,
        '<div class="era-name">' + e.label + '</div>' +
        '<div class="era-years">' + e.from + '–' + e.to + '</div>' +
        '<div class="era-slots">' + slots + '</div>'));
    });
  }

  /** 侧栏：自己谱中的班底（词/曲）与主题分布——用来记住「还差谁」 */
  function renderSide() {
    var g = App.game, wrap = $('#side-me');
    if (!wrap) return;
    var p = g.state.players[0];
    var cfg = g.config;

    // --- 班底：与立派同口径，只算作词 / 作曲
    var cnt = {};
    p.hand.forEach(function (c) {
      ['lyricist', 'composer'].forEach(function (k) {
        (c[k] || []).forEach(function (v) { if (v) cnt[v] = (cnt[v] || 0) + 1; });
      });
    });
    var names = Object.keys(cnt).sort(function (a, b) {
      return cnt[b] - cnt[a] || String(a).localeCompare(String(b), 'zh');
    });
    var sch = E.countSchools(p.hand, cfg);
    var schoolHit = sch.total >= cfg.schoolTarget;
    var staffPills = names.slice(0, 18).map(function (n) {
      var k = cnt[n];
      return '<span class="pill ' + (k >= 2 ? 'n2' : 'n1') + '" title="' + esc(n) + '：' + k + ' 首' +
        (k >= 2 ? '，已成一派' : '，再来一首成一派') + '">' + esc(n) + '<b>' + k + '</b></span>';
    }).join('');

    // --- 主题：四类各几首、跨几代
    var tTally = E.countThemes(p.hand, cfg).tally || {};
    var themePills = ['史同', '架空', '人生', '文化'].map(function (gn) {
      var n = tTally[gn] || 0;
      var es = {};
      p.hand.forEach(function (c) { if (c.typeGroup === gn) es[c.era] = 1; });
      var e = Object.keys(es).length;
      var hit = n >= cfg.themeSize && e >= cfg.themeEras;
      return '<span class="pill' + (hit ? ' n2' : (n ? '' : ' dim')) + '" title="' + gn + '：' + n + '/' +
        cfg.themeSize + ' 首，跨 ' + e + '/' + cfg.themeEras + ' 代">' + gn +
        '<b>' + n + '</b><i>跨' + e + '</i></span>';
    }).join('');

    wrap.innerHTML =
      '<div class="side-t">班 底 <em class="' + (schoolHit ? 'hit' : '') + '">已立 ' + sch.total + '/' +
        cfg.schoolTarget + ' 派 · ' + names.length + ' 位</em></div>' +
      '<div class="side-list">' + (staffPills || '<span class="side-empty">谱中尚无牌</span>') + '</div>' +
      '<div class="side-t">主 题 <em>成题 ' + cfg.themeSize + ' 首 · 跨 ' + cfg.themeEras + ' 代</em></div>' +
      '<div class="side-list">' + themePills + '</div>';
  }

  function renderLog() {
    var box = $('#log');
    var items = App.game.state.log.slice(-60);
    box.innerHTML = items.map(function (l) {
      return '<div class="l ' + l.kind + '"><span class="r">' + l.t + '</span><span class="t">' + esc(l.text) + '</span></div>';
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  /* ---------------- 行动 ---------------- */
  function doPlace(cardId, dom) {
    var g = App.game;
    if (!isHumanTurn()) return;
    var who = g.state.current;
    var before = g.state.players[who].fame;
    var r = g.place(cardId, who);
    if (!r.ok) { toast(r.why); return; }

    if (dom) {
      var rect = dom.getBoundingClientRect();
      floatFame('+' + (g.state.players[who].fame - before), rect.left + rect.width / 2 - 10, rect.top + 8);
    }
    renderAll();
    if (g.state.over) { finish(); return; }
    g.endTurn();
    renderAll();
    pumpAI();
  }

  function doGather() {
    var g = App.game;
    if (!isHumanTurn()) return;
    g.gather(g.state.current);
    renderAll();
    if (g.state.over) { finish(); return; }
    g.endTurn();
    renderAll();
    pumpAI();
  }

  /** 连续推进所有 AI 玩家，直到轮到人类或对局结束 */
  function pumpAI() {
    var g = App.game;
    if (g.state.over) { finish(); return; }
    if (g.state.current === 0 || !g.state.players[g.state.current].isAI) { renderAll(); return; }

    App.busy = true;
    renderAll();
    setTimeout(function () {
      var who = g.state.current;
      var step = AI.decide(g, who, App.difficulty);
      if (step.type === 'place') {
        var r = g.place(step.cardId, who);
        if (!r.ok) g.gather(who);
      } else {
        g.gather(who);
      }
      App.busy = false;
      renderAll();
      if (g.state.over) { finish(); return; }
      g.endTurn();
      renderAll();
      pumpAI();
    }, 520);
  }

  /* ---------------- 结算 ---------------- */
  function finish() {
    var g = App.game;
    var winner = g.state.winner;
    var winP = g.state.players[winner];
    var me = g.state.players[0];
    var iWin = winner === 0;
    var byLabel = { fame: '声名', schools: '立派', eras: '通史', themes: '成题', timeout: '总进度' }[g.state.winBy] || '';

    $('#end-title').textContent = iWin ? '谱 成' : '谱 未 成';
    $('#end-sub').innerHTML = iWin
      ? '你以<b>' + byLabel + '</b>先成一家。第 ' + g.state.round + ' 轮，声名 ' + me.fame + '，谱中 ' + me.hand.length + ' 首。'
      : '<b>' + esc(winP.name) + '</b> 以<b>' + byLabel + '</b>先成一家。第 ' + g.state.round + ' 轮，你声名 ' + me.fame + '，谱中 ' + me.hand.length + ' 首。';

    var hw = $('#end-hand'); hw.innerHTML = '';
    me.hand.forEach(function (c) {
      var d = el('div', 'mini' + (c.isSpecial ? ' sp' : ''));
      d.innerHTML = '<b>' + esc(c.name) + '</b><span class="y">' + c.year + ' · ' + esc((c.type || '').split('-')[0]) + '</span>';
      d.addEventListener('click', function () { openCard(c, g.preview(c.id, 0)); });
      hw.appendChild(d);
    });

    function bar(name, key, target) {
      var cfg = g.config;
      var rows = g.state.players.map(function (p) {
        var pg = E.progress(p, cfg);
        var out = { name: p.name, me: p.idx === 0, v: 0, bar: 0, done: false, sub: '' };
        if (key === 'fame') {
          out.v = pg.fame.now; out.bar = pg.fame.now / target; out.done = out.v >= target;
        } else if (key === 'eras') {
          // 通史是「段数 + 双收段数 + 跨题数」三件事同时满足，不能只看 6/6
          var nd = cfg.eraDoubleSegs || 0, ng = cfg.eraMinGroups || 0;
          var d = pg.eras.doubles || 0, gr = pg.eras.groups || 0;
          out.v = pg.eras.now;
          out.bar = Math.min(pg.eras.now / target, nd ? d / nd : 1, ng ? gr / ng : 1);
          out.done = !!pg.eras.ok;
          out.sub = '双' + d + '/' + nd + ' 跨' + gr + '/' + ng;
        } else if (key === 'themes') {
          var list = pg.themes.detail || [];
          out.v = list.length; out.bar = out.v / target; out.done = out.v >= target;
        } else {
          out.v = pg.schools.now; out.bar = out.v / target; out.done = out.v >= target;
        }
        return out;
      });
      var html = '<div class="eg' + (rows[0].done ? ' done' : '') + '">' +
        '<div class="eg-top"><b>' + name + '</b><span>目标 ' + target + '</span></div>';
      rows.forEach(function (r) {
        html += '<div class="eg-line">' +
          '<i class="sw' + (r.me ? ' me' : '') + '"></i>' +
          '<span class="nm">' + esc(r.name) + '</span>' +
          '<span class="bar"><i class="' + (r.me ? 'me' : '') + '" style="width:' +
            Math.max(0, Math.min(100, 100 * r.bar)) + '%"></i></span>' +
          '<span class="val' + (r.done ? ' ok' : '') + '">' + r.v +
            (r.sub ? '<span class="sub">' + r.sub + '</span>' : '') + '</span>' +
          '</div>';
      });
      var detail = '';
      if (key === 'schools' || key === 'themes') {
        detail = g.state.players.map(function (p) {
          var pg = E.progress(p, g.config);
          var arr = key === 'schools' ? pg.schools.detail : pg.themes.detail;
          return esc(p.name) + '：' + (arr.map(function (x) {
            return x.name + '(' + x.count + (x.eras ? '首跨' + x.eras + '代' : '') + ')';
          }).join('、') || (key === 'schools' ? '未立' : '未成题'));
        }).join('　');
      }
      if (detail) html += '<div class="eg-detail">' + detail + '</div>';
      return html + '</div>';
    }
    $('#end-goals').innerHTML =
      bar('声名', 'fame', g.config.fameTarget) +
      bar('通史', 'eras', g.config.eraTarget) +
      bar('立派', 'schools', g.config.schoolTarget) +
      bar('成题', 'themes', g.config.themeTarget);

    $('#end-log').innerHTML = g.state.log.slice(-30).map(function (l) {
      return '<div><span class="t">' + l.t + '</span>' + esc(l.text) + '</div>';
    }).join('');

    showView('end');
  }

  function exportList() {
    var g = App.game, me = g.state.players[0];
    var L = [];
    L.push('《三百首·词宗》辑录');
    L.push('生成：' + new Date().toLocaleString('zh-CN'));
    L.push('结果：' + (g.state.winner === 0 ? '胜' : '负（' + g.state.players[g.state.winner].name + ' 胜）') +
      '　声名 ' + me.fame + '　第 ' + g.state.round + ' 轮');
    L.push('');
    me.hand.forEach(function (c, i) {
      L.push((i + 1) + '. 《' + c.name + '》' + c.year + '　' + (c.type || ''));
      var m = [];
      if (c.lyricist.length) m.push('词 ' + join(c.lyricist));
      if (c.composer.length) m.push('曲 ' + join(c.composer));
      if (c.arranger.length) m.push('编 ' + join(c.arranger));
      if (c.singer.length) m.push('唱 ' + join(c.singer));
      if (c.voicebank.length) m.push('声库 ' + join(c.voicebank));
      L.push('   ' + m.join('　'));
      (c.notes || []).forEach(function (n) {
        L.push('   笺注：' + join(n.by) + '（' + n.platform + ' ' + n.date + '）' + (n.url ? ' ' + n.url : ''));
      });
      L.push('');
    });
    L.push('—— 由「三百首·词宗」生成');

    var blob = new Blob([L.join('\n')], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '词宗谱_' + new Date().toISOString().slice(0, 10) + '.txt';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    toast('歌单已导出');
  }

  /* ---------------- 卡牌详情 ---------------- */
  function openCard(c, pv) {
    var g = App.game;
    var tags = [];
    if (c.isSpecial) tags.push('<span class="tag" style="color:var(--seal);border-color:rgba(158,61,50,.35)">特别篇</span>');
    if (c.isVirtual) tags.push('<span class="tag">中V</span>');
    (c.voicebank || []).forEach(function (v) { tags.push('<span class="tag">声库 ' + esc(v) + '</span>'); });
    (c.subjects || []).forEach(function (v) { tags.push('<span class="tag">题材 ' + esc(v) + '</span>'); });
    if (c.batch) tags.push('<span class="tag">批次 ' + esc(c.batch) + '</span>');
    if (c.dateSource) tags.push('<span class="tag">日期考证 ' + esc(c.dateSource) + '</span>');
    if (c.available && c.available.length) tags.push('<span class="tag">' + esc(c.available.join('/')) + '</span>');

    function row(k, v) { return v ? '<div class="cd-row"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>' : ''; }

    var notes = c.notes && c.notes.length
      ? '<div class="cd-notes"><h4>笺 注 ' + c.notes.length + ' 条</h4>' + c.notes.map(function (n) {
        var inner = '<b>' + esc(join(n.by) || '佚名') + '</b>　<span class="meta">' + esc(n.platform || '') + '　' + esc(n.date || '') + '</span>';
        if (n.url) inner = '<a href="' + esc(n.url) + '" target="_blank" rel="noopener">' + inner + '</a>';
        return '<div class="cd-note">' + inner + (n.addr && !n.url ? '<div class="meta" style="margin-top:2px">' + esc(n.addr) + '</div>' : '') + '</div>';
      }).join('') + '</div>'
      : '<div class="cd-notes"><h4>笺 注</h4><div class="cd-note" style="color:var(--ink-4)">尚无解读。这张牌只给基础声名。</div></div>';

    var evalHtml = '';
    if (pv && g) {
      evalHtml = '<div class="cd-eval">' +
        '此刻辑录：费墨 <b>' + pv.cost + '</b>（' + (pv.reasons.length ? pv.reasons.map(function (r) { return r.text + '（' + r.detail + '）−' + r.value; }).join('　') : '无减免') + '）<br>' +
        '可得声名 <b>+' + pv.fame + '</b>（' + pv.parts.map(function (p) { return p.text + '+' + p.value; }).join('　') + '）' +
        '</div>';
    }

    $('#card-detail').innerHTML =
      '<div class="cd-name">' + esc(c.name) + '</div>' +
      '<div class="cd-sub">' + (c.date || c.year) + '　' + esc(c.type || '') + '</div>' +
      '<div class="cd-rows">' +
        row('作词', esc(join(c.lyricist))) +
        row('作曲', esc(join(c.composer))) +
        row('编曲', esc(join(c.arranger))) +
        row('演唱', esc(join(c.singer))) +
        row('调校', esc(join(c.tuner))) +
        row('班底', c.staff && c.staff.length ? esc(join(c.staff)) : '') +
        row('标签', tags.join('') || '—') +
      '</div>' + evalHtml + notes;
    openModal('modal-card');
  }

  /* ---------------- 牌库 ---------------- */
  function openLibrary() {
    var types = {};
    App.data.cards.forEach(function (c) { if (c.type) types[c.type] = (types[c.type] || 0) + 1; });
    $('#lib-filter').innerHTML = '<option value="">全部类型（' + App.data.cards.length + '）</option>' +
      Object.keys(types).sort().map(function (t) {
        return '<option value="' + esc(t) + '">' + esc(t) + '（' + types[t] + '）</option>';
      }).join('');
    renderLib();
    openModal('modal-cards');
  }
  function renderLib() {
    var q = ($('#lib-search').value || '').trim().toLowerCase();
    var tf = $('#lib-filter').value;
    var list = App.data.cards.filter(function (c) {
      if (tf && c.type !== tf) return false;
      if (!q) return true;
      return [c.name, c.type, join(c.lyricist), join(c.composer), join(c.singer), join(c.subjects), join(c.voicebank)]
        .join(' ').toLowerCase().indexOf(q) >= 0;
    });
    $('#lib-count').textContent = list.length + ' 首';
    var grid = $('#lib-grid');
    grid.innerHTML = list.slice(0, 400).map(function (c) {
      return '<div class="lib-item" data-id="' + esc(c.id) + '"><b>' + esc(c.name) + '</b><span>' +
        c.year + ' · ' + esc((c.type || '').split('-')[0]) + (c.isSpecial ? ' · 特别' : '') + (c.noteCount ? ' · 注' : '') + '</span></div>';
    }).join('') + (list.length > 400 ? '<div style="grid-column:1/-1;font-size:11px;color:var(--ink-4)">仅显示前 400 条，请用搜索缩小范围</div>' : '');
    $$('.lib-item', grid).forEach(function (d) {
      d.addEventListener('click', function () {
        var c = App.data.cards.filter(function (x) { return x.id === d.dataset.id; })[0];
        if (c) openCard(c, App.game ? App.game.preview(c.id, App.game.state.current) : null);
      });
    });
  }

  /* ---------------- 模态 ---------------- */
  function openModal(id) { $('#' + id).classList.add('open'); }
  function closeModal(n) { n.classList.remove('open'); }
  function bindModals() {
    $$('.modal').forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) closeModal(m); });
    });
    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { closeModal(b.closest('.modal')); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') $$('.modal.open').forEach(closeModal);
    });
  }

  /* ---------------- 规则 ---------------- */
  function renderRules() {
    var c = E.CONFIG;
    var b2 = E.BALANCE[2], b3 = E.BALANCE[3], b4 = E.BALANCE[4];

    $('#rule-body').innerHTML = [
      '<div class="rule-lead">',
        '<b>一句话：</b>从歌肆里收歌，编成自己的《词宗谱》。谁先走通四条终点线中的任意一条，谁就赢。',
      '</div>',

      '<h3>① 一回合，只做一件事</h3>',
      '<table>',
        '<tr><th>动作</th><th>做什么</th><th>代价</th></tr>',
        '<tr><td><b>辑录</b></td><td>从歌肆挑一张歌，放进自己的谱</td><td>付墨；谱不限张数</td></tr>',
        '<tr><td><b>采风</b></td><td>直接得墨，并换掉歌肆最左一张</td><td>这一轮不收歌</td></tr>',
      '</table>',
      '<p>每轮开始自动得 ' + c.income + ' 墨（三人、四人局为 3），上限 ' + c.inkCap + '。墨不够就只能采风。</p>',

      '<h3>② 四条终点线（达成任意一条即胜）</h3>',
      '<table>',
        '<tr><th>线</th><th>条件（以二人局为例）</th><th>怎么打</th></tr>',
        '<tr><td><b>声名</b></td><td>累计声名 ≥ ' + b2.fame + '</td><td>挑高价值的牌，稳扎稳打</td></tr>',
        '<tr><td><b>通史</b></td><td>六个年代各至少 1 张，其中 ' + b2.doubles + ' 段各有 2 张，且跨 ' + b2.groups + ' 个主题</td><td>铺开，抢年代空位</td></tr>',
        '<tr><td><b>立派</b></td><td>立 ' + b2.schools + ' 派：同一位词人或曲人每 2 首算 1 派</td><td>死磕同一位创作者</td></tr>',
        '<tr><td><b>成题</b></td><td>同一主题 ' + b2.themeSize + ' 首，且跨 ' + b2.themeEras + ' 个年代</td><td>横向收束，一类到底</td></tr>',
      '</table>',
      '<p>人多时门槛会变：三人 → 声名 ' + b3.fame + '、成题跨 ' + b3.themeEras + ' 代；四人 → 声名 ' + b4.fame + '、通史只跨 ' + b4.groups + ' 个主题、成题跨 ' + b4.themeEras + ' 代。</p>',

      '<h3>③ 一张牌要多少墨</h3>',
      '<table>',
        '<tr><td>基础价</td><td>' + c.costBase + ' 墨；特别篇 +' + c.costSpecial + '、中V +' + c.costVirtual + '</td></tr>',
        '<tr><td><b>知音</b>减价</td><td>与谱中某张共享词／曲／编／唱／调校，每位 −' + c.discountStaff + '，最多 −' + (c.discountStaff * c.discountStaffMax) + '</td></tr>',
        '<tr><td><b>同流</b>减价</td><td>与谱中最多的主题相同，−' + c.discountSameGroup + '</td></tr>',
        '<tr><td>最低</td><td>' + c.minCost + ' 墨</td></tr>',
      '</table>',
      '<p>所以「顺着自己的班底往下收」比乱抓便宜得多——这是整套牌的核心。</p>',

      '<h3>④ 一张牌给多少声名</h3>',
      '<table>',
        '<tr><td>入谱</td><td>+' + c.fameBase + '（特别篇 / 中V 各再 +1）</td></tr>',
        '<tr><td>已注</td><td>+' + c.fameNote + '（这首歌在「解析」表里有解读）</td></tr>',
        '<tr><td>知音</td><td>+' + c.fameStaff + '；共享 ≥2 位再 +' + c.fameStaff2 + '</td></tr>',
        '<tr><td>开段</td><td>+' + c.fameEraFirst + '（该年代你第一次落子）</td></tr>',
        '<tr><td>同流成对</td><td>+' + c.famePair + '（该主题在谱中凑满 2、4、6 张时）</td></tr>',
      '</table>',

      '<h3>⑤ 立派与成题，两点容易搞错</h3>',
      '<p><b>立派按「每两首」算。</b>同一位创作者在你谱里有 2 首＝1 派，有 4 首＝2 派。只算作词、作曲两类角色；同一张牌可以同时算进两派。</p>',
      '<div class="note">例：河图 2 首（1 派）、Finale 4 首（2 派）、银临 2 首（1 派）——合计 4 派。</div>',
      '<p><b>成题要跨年代。</b>同一主题收满 ' + b2.themeSize + ' 首还不够，这些歌必须来自 ' + b2.themeEras + ' 个不同年代。它和「通史」正好相反：通史要四类都有、年代不重；成题要一类到底、年代不重。</p>',

      '<h3>⑥ 开局怎么设</h3>',
      '<table>',
        '<tr><th>设置</th><th>说明</th></tr>',
        '<tr><td><b>玩法</b></td><td>两枚圆钮：詞宗（本局）／詞路（棋盘局）</td></tr>',
        '<tr><td><b>人数</b></td><td>2–4 人；座位右侧可切「人／机」</td></tr>',
        '<tr><td><b>先后</b></td><td>我先手 / 我后手。补偿按出手位次发：先手 ' + c.startInk + ' 墨 0 声名，每往后一位多 ' + c.secondBonus + ' 墨、' + c.seatFameTable[1] + ' 声名</td></tr>',
        '<tr><td><b>难度</b></td><td>只影响墨客：初涉＝一半最优、一半明显犯蠢；熟手＝一半最优一半次优；老吏＝每手最优</td></tr>',
      '</table>',
      '<p>留两个以上「人」即同屏轮流（热座）：上方是你以外的座位，下方固定第一位玩家，轮到谁谁的名字旁出现「此刻」。</p>',

      '<h3>⑦ 界面上看什么</h3>',
      '<ul>',
        '<li><b>歌肆</b>：公共牌列，你拿走别人就没有。悬停看这张牌此刻的费用与声名。</li>',
        '<li><b>编年轴</b>：六个年代各收了几张，一眼看出通史还缺哪段。</li>',
        '<li><b>右侧栏</b>：班底（词／曲各几首，够 2 首标朱）与主题（四类各几首、跨几代）——不用自己记「还差谁」。</li>',
        '<li><b>四条进度条</b>：通史写成「双 2/4·跨 3/3」，是为了提醒它不只看段数。</li>',
        '<li><b>右键卡牌</b>：看完整档案，包括每条笺注的出处链接。</li>',
      '</ul>'
    ].join('');
  }

  /* ---------------- 棋盘局规则 ---------------- */
  function renderBoardRules() {
    var B = window.SBBoard.BOARD;
    var BAL = window.SBBoard.BALANCE;

    $('#rule-body').innerHTML = [
      '<div class="rule-lead">',
        '<b>一句话：</b>掷骰走 49 格，落地翻牌、收歌占地；声名先到 ' + B.fameTarget + '，或走满卷数后声名最高者胜。',
      '</div>',

      '<h3>① 一回合，掷骰或采风</h3>',
      '<table>',
        '<tr><th>动作</th><th>结果</th></tr>',
        '<tr><td><b>掷骰</b></td><td>前进 1–6 格，触发落点</td></tr>',
        '<tr><td><b>采风</b></td><td>直接得 ' + B.gatherInk + ' 墨，<b>这一轮不行棋</b>——手上缺墨时用它换钱</td></tr>',
      '</table>',
      '<p>起手 ' + B.startInk + ' 墨，之后每回合只进 ' + B.income + ' 墨。一首歌通常 2–3 墨，所以「买不买、要不要采风」是真的取舍。</p>',

      '<h3>② 会落在哪些格</h3>',
      '<table>',
        '<tr><th>格</th><th>效果</th></tr>',
        '<tr><td><b>歌格</b>（每段前 7 格）</td><td>翻开后若无人占，可付墨收下；费用与声名算法和第一局相同</td></tr>',
        '<tr><td><b>开卷格 / 段首</b></td><td>落地 +' + B.startBonus + ' ／ +1 声名</td></tr>',
        '<tr><td><b>机会格</b>（第 1、3、5 段末）</td><td>抽一张：得墨、加声名、前进 2–3 格、下一张免墨</td></tr>',
        '<tr><td><b>命运格</b>（第 2、4、6 段末）</td><td>抽一张：失墨、减声名、后退、停一手，也夹着几张吉牌</td></tr>',
      '</table>',
      '<p>开局全部扣着（问号 + 斜纹），走到才翻开。格子右上角是整条路径的编号 1–49，跟着编号走就是一条龙。</p>',

      '<h3>③ 占地与过路费</h3>',
      '<p>你收下的格子会留朱框和名字，别人再踩到就要付墨给你：</p>',
      '<table>',
        '<tr><td>基本</td><td>按这首歌在你手上所属的<b>最大一组</b>收：组里 1 格 1 墨、2 格 2 墨、3 格 3 墨</td></tr>',
        '<tr><td>按圈递增</td><td><b>第二圈起每多一圈 +1 墨</b>（最多 +2）。所以晚圈踩别人地盘更贵</td></tr>',
        '<tr><td>付不起</td><td>空手而过，<b>声名 −2</b>；若声名因此归零，<b>谱全失、占地释放、退回开卷格重来</b></td></tr>',
      '</table>',
      '<div class="note">格子右下「N 墨」就是这一脚要付的钱，会随圈数自动变大。</div>',

      '<h3>④ 成组：三个维度各自算</h3>',
      '<table>',
        '<tr><th>维度</th><th>怎么算</th></tr>',
        '<tr><td>年代</td><td>同一段里占了几格</td></tr>',
        '<tr><td>主题</td><td>史同／架空／人生／文化，同一类占了几格</td></tr>',
        '<tr><td>班底</td><td>同一位词人或曲人，占了几格</td></tr>',
      '</table>',
      '<p>任一维度占满 ' + B.groupSize + ' 格即成一组：立刻 <b>+' + B.groupBonus + ' 声名</b>，且该组的过路费按满额收。右侧<b>成组看板</b>会把三个维度各占几格摊开，成组的标朱。</p>',

      '<h3>⑤ 输赢</h3>',
      '<p>声名先到 <b>' + B.fameTarget + '</b>，或走满卷数后声名最高。卷数按人数：' +
        [2, 3, 4].map(function (n) { return n + ' 人 ' + BAL[n].laps + ' 卷'; }).join('；') +
        '。<br>目标定在「走完这些圈大概能攒到的声名」，所以多数对局都能走满两圈，只有跑得特别快的一家会提前收局。</p>',

      '<h3>⑥ 与第一局的差别</h3>',
      '<table>',
        '<tr><th></th><th>詞宗（第一局）</th><th>詞路（第二局）</th></tr>',
        '<tr><td>选牌</td><td>从 5–7 张歌肆里挑</td><td>只能拿脚下翻到的那一张</td></tr>',
        '<tr><td>互动</td><td>抢同一张牌</td><td>踩别人的地盘要付墨</td></tr>',
        '<tr><td>节奏</td><td>约 11 轮</td><td>两圈上下</td></tr>',
        '<tr><td>策略</td><td>规划四条线</td><td>随遇而安，把手上这副牌用好</td></tr>',
      '</table>',
      '<p>界面：顶部是各家的声名／墨／谱／卷；棋盘右侧是成组看板；底部掷骰与采风并排，下面一行是记录。<b>每行默认 7 格</b>，手机／平板可在图例右侧切成 4–6 格，选择会记住。</p>'
    ].join('');
  }

  /* ---------------- 数据面板 ---------------- */
  function renderDataPanel() {
    var meta = App.data.meta || {}, cards = App.data.cards;
    var noted = cards.filter(function (c) { return c.noteCount > 0; }).length;
    $('#data-body').innerHTML = [
      '<h3>当前牌库</h3>',
      '<div class="data-grid">',
      '<div class="d"><b>' + cards.length + '</b><span>首歌曲</span></div>',
      '<div class="d"><b>' + (meta.annotationsCount || 0) + '</b><span>条解析</span></div>',
      '<div class="d"><b>' + noted + '</b><span>首有笺注</span></div>',
      '<div class="d"><b>' + cards.filter(function (c) { return c.isSpecial; }).length + '</b><span>首特别篇</span></div>',
      '<div class="d"><b>' + cards.filter(function (c) { return c.isVirtual; }).length + '</b><span>首中V</span></div>',
      '<div class="d"><b>' + cards.filter(function (c) { return c.subjects && c.subjects.length; }).length + '</b><span>首有题材</span></div>',
      '</div>',
      '<p style="font-size:11.5px;color:var(--ink-3)">数据版本：' + (meta.generatedAt || '未知') +
      '　来源：' + (meta.source || '飞书多维表格') + (App.usingOverride ? '　<b style="color:var(--seal)">（当前使用本地导入版）</b>' : '') + '</p>',

      '<h3>飞书表更新之后怎么办</h3>',
      '<p>牌库由飞书两张表生成，表 ID 配在项目根的 <code>feishu.json</code>（已在 .gitignore 里，不进仓库）。表里加歌、补解析、改字段之后，按下面任一种方式刷新牌库，<b>不需要改任何游戏代码</b>。</p>',
      '<p><b>方式一（推荐）</b>：双击 <code>更新数据.bat</code>。脚本现拉飞书两张表，重建 <code>data/cards.json</code> 与 <code>data/cards.js</code>，并打印统计报告。</p>',
      '<p><b>方式二</b>：手动导出两张表为 NDJSON，然后运行：</p>',
      '<pre>python tools\\update.py --songs 三百首.ndjson --parses 解析.ndjson</pre>',
      '<p><b>方式三</b>：只拿到一份 <code>cards.json</code> 时，直接在这里导入，浏览器会记在本地（不改动磁盘文件）。</p>',
      '<div class="imp"><input type="file" id="imp-file" accept=".json,application/json"><button class="nav sm" id="imp-clear">清除导入</button></div>',
      '<p style="font-size:11.5px;color:var(--ink-3)">字段容错：构建脚本对列名做了别名映射，飞书里把「解析（请到解析模块查看）」改成「解析／解析数／解析有无」这类改动不会让脚本失效；新增的未识别列会原样保留在每张牌的 <code>extra</code> 字段里，供以后扩展玩法。</p>'
    ].join('');

    var fi = $('#imp-file');
    if (fi) fi.addEventListener('change', function () {
      var f = fi.files && fi.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var j = JSON.parse(fr.result);
          if (!j.cards || !Array.isArray(j.cards) || !j.cards.length) throw new Error('缺少 cards 数组');
          localStorage.setItem('sb_cards_override', JSON.stringify(j));
          toast('已导入 ' + j.cards.length + ' 首，正在重载…');
          setTimeout(function () { location.reload(); }, 700);
        } catch (e) { toast('导入失败：' + e.message, 3000); }
      };
      fr.readAsText(f, 'utf-8');
    });
    var cl = $('#imp-clear');
    if (cl) cl.addEventListener('click', function () {
      localStorage.removeItem('sb_cards_override');
      toast('已清除，正在重载…'); setTimeout(function () { location.reload(); }, 600);
    });
  }

  /* ---------------- 视图 ---------------- */
  function showView(name) {
    $$('.view').forEach(function (v) { v.classList.remove('is-active'); });
    $('#view-' + name).classList.add('is-active');
    window.scrollTo(0, 0);
  }

  function startGame() {
    var roster = App.seats.slice(0, App.count).map(function (s, i) {
      return { name: s.name || (i === 0 ? '你' : '墨客'), isAI: i === 0 ? false : !!s.isAI };
    });

    // 后手：让下一个座位先动，补偿按出手位次自动发给后手
    var firstSeat = App.humanFirst ? 0 : 1;

    if (App.mode === 'board') {
      showView('board');
      window.SBBoard.cfg.difficulty = App.difficulty;
      // 默认 7 列；只认用户手选过的值（窄屏可自己在图例右侧切 4–6）
      var savedCols = null;
      try { savedCols = localStorage.getItem('sb_board_cols'); } catch (e) {}
      window.SBBoard.BOARD.cols = savedCols ? Math.max(4, Math.min(7, +savedCols)) : 7;
      window.SBBoard.start(roster, { firstSeat: firstSeat });
      toast('掷骰前进，落地翻牌；走满 ' + window.SBBoard.BOARD.laps + ' 卷，或以声名先达 ' + window.SBBoard.BOARD.fameTarget + ' 者胜。缺墨可采风。', 3600);
      return;
    }

    var cards = App.data.cards;
    App.game = new E.Game(cards, {
      eraCount: (App.data.meta.eras || []).length || 6,
      players: roster,
      firstSeat: firstSeat
    });
    App.busy = false;
    showView('game');
    renderAll();
    if (roster.filter(function (r) { return r.isAI; }).length) {
      toast('点歌肆里的一张牌辑录；付不起就点「采风」。', 3200);
    } else {
      toast('热座局：轮到谁，谁的名字旁会出现「此刻」。', 3200);
    }
    pumpAI();
  }

  /* ---------------- 绑定 ---------------- */
  function bind() {
    bindModals();

    $$('#seg-count button').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('#seg-count button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        App.count = parseInt(b.dataset.n, 10);
        buildSeats();
      });
    });
    $$('#mode-pick .orb').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('#mode-pick .orb').forEach(function (x) {
          x.classList.remove('on'); x.setAttribute('aria-pressed', 'false');
        });
        b.classList.add('on'); b.setAttribute('aria-pressed', 'true');
        App.mode = b.dataset.mode;
        var hint = $('.setup-hint');
        if (hint) hint.textContent = App.mode === 'board'
          ? '棋盘局：掷骰前行，落在格子翻开，落在歌格可辑录占地；声名先达 48 或走满两卷者胜。'
          : '点座位右侧的「人 / 机」切换。留两个以上「人」即同屏轮流（热座）。';
      });
    });

    // 先后手
    $$('#seg-first button').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('#seg-first button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        App.humanFirst = b.dataset.first === '1';
      });
    });

    $$('#seg-difficulty button').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('#seg-difficulty button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        App.difficulty = b.dataset.diff;
      });
    });

    $('#btn-start').addEventListener('click', startGame);
    $('#btn-again').addEventListener('click', function () { showView('intro'); renderIntro(); });
    $('#btn-export').addEventListener('click', exportList);
    $('#btn-gather').addEventListener('click', doGather);

    ['btn-rules', 'btn-rules-intro'].forEach(function (id) {
      var b = $('#' + id); if (b) b.addEventListener('click', function () { renderRules(); openModal('modal-rules'); });
    });
    ['btn-data', 'btn-data-intro'].forEach(function (id) {
      var b = $('#' + id); if (b) b.addEventListener('click', function () { renderDataPanel(); openModal('modal-data'); });
    });
    var bc = $('#btn-cards-intro'); if (bc) bc.addEventListener('click', openLibrary);

    $('#btn-restart').addEventListener('click', function () {
      if (App.game && !App.game.state.over && !confirm('放弃当前这局，重开？')) return;
      showView('intro'); renderIntro();
    });

    var ls = $('#lib-search'); if (ls) ls.addEventListener('input', renderLib);
    var lf = $('#lib-filter'); if (lf) lf.addEventListener('change', renderLib);

    // ---- 棋盘局按钮 ----
    var rl = $('#bp-roll');
    if (rl) rl.addEventListener('click', function () { window.SBBoard.roll(); });
    var gg = $('#bp-gather');
    if (gg) gg.addEventListener('click', function () { window.SBBoard.gather(); });

    // 每行几格：默认 7，可选 4–7，选了就记住
    $$('#bp-cols button').forEach(function (b) {
      b.addEventListener('click', function () {
        window.SBBoard.BOARD.cols = +b.dataset.c;
        try { localStorage.setItem('sb_board_cols', b.dataset.c); } catch (e) {}
        window.SBBoard.render();
      });
    });
    var bk = $('#bp-back');
    if (bk) bk.addEventListener('click', function () {
      if (!window.SBBoard.S.over && window.SBBoard.S.players.length && !confirm('离开当前棋局？')) return;
      showView('intro'); renderIntro();
    });
    var br = $('#bp-rules');
    if (br) br.addEventListener('click', function () { renderBoardRules(); openModal('modal-rules'); });
    var ba = $('#bp-again');
    if (ba) ba.addEventListener('click', function () {
      closeModal($('#modal-bp-result'));
      var roster = App.seats.slice(0, App.count).map(function (s, i) {
        return { name: s.name || (i === 0 ? '你' : '墨客'), isAI: i === 0 ? false : !!s.isAI };
      });
      window.SBBoard.start(roster, { firstSeat: App.humanFirst ? 0 : 1 });
    });
    var bh = $('#bp-home');
    if (bh) bh.addEventListener('click', function () {
      closeModal($('#modal-bp-result')); showView('intro'); renderIntro();
    });
  }

  function boot() {
    loadData();
    App.openCard = openCard;
    App.showView = showView;
    if (!App.data || !App.data.cards) {
      document.body.innerHTML = '<div style="padding:60px">数据未加载：请确认 data/cards.js 存在。</div>';
      return;
    }
    renderIntro();
    bind();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
