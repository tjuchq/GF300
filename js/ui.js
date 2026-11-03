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
    lastMode: 'deck',
    seats: [],
    myIdx: 0,
    busy: false,
    paused: false,
    pendingEnd: false,
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

  /** 右键 / 手机长按 → 读解析（同一套入口，卡面与棋格都用它） */
  function bindArchive(dom, card, getPv) {
    dom.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      openCard(card, getPv ? getPv() : null);
    });
    var timer = null, sx = 0, sy = 0;
    dom.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      sx = t.clientX; sy = t.clientY;
      clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        dom._lp = Date.now();
        openCard(card, getPv ? getPv() : null);
      }, 520);
    }, { passive: true });
    dom.addEventListener('touchmove', function (e) {
      if (!timer) return;
      var t = e.touches[0];
      if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) {
        clearTimeout(timer); timer = null;
      }
    }, { passive: true });
    dom.addEventListener('touchend', function () { clearTimeout(timer); timer = null; });
    dom.addEventListener('touchcancel', function () { clearTimeout(timer); timer = null; });
  }
  function justLongPressed(dom) {
    return dom._lp && Date.now() - dom._lp < 900;
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
    updateResume();
    buildSeats();
  }

  function defaultSeats() {
    var arr = [];
    for (var i = 0; i < 4; i++) {
      arr.push({
        id: 's' + i,
        name: i === 0 ? HUMAN_NAMES[0] : AI_NAMES[i - 1],
        isAI: i !== 0,
        isMe: i === 0,
        manual: false
      });
    }
    return arr;
  }

  function orderSeats() {
    return App.seats.slice(0, App.count);
  }

  /** 把「我」留在可见席位里：人数调小时，若「我」被挤出前 N 位，就换到末位 */
  function keepMeVisible() {
    var i = App.seats.findIndex(function (s) { return s.isMe; });
    if (i < 0) { App.seats[0].isMe = true; i = 0; }
    if (i >= App.count) {
      var t = App.seats[App.count - 1];
      App.seats[App.count - 1] = App.seats[i];
      App.seats[i] = t;
    }
  }

  function buildSeats() {
    if (!App.seats.length) App.seats = defaultSeats();
    keepMeVisible();
    var wrap = $('#seats');
    wrap.innerHTML = '';
    orderSeats().forEach(function (st, pos) {
      var row = el('div', 'seat' + (st.isMe ? ' me' : ''));
      row.dataset.id = st.id;
      row.innerHTML =
        '<span class="grip" title="按住拖动，改出手顺序">⋮⋮</span>' +
        '<span class="idx">' + CN[pos] + '</span>' +
        '<input value="' + esc(st.name) + '" maxlength="8">' +
        '<button class="kind" data-k="' + (st.isAI ? 'ai' : 'human') + '">' + (st.isAI ? '机' : '人') + '</button>';

      var inp = row.querySelector('input');
      inp.addEventListener('input', function () {
        st.name = inp.value.trim() || (st.isAI ? AI_NAMES[pos - 1] || '墨客' : (st.isMe ? HUMAN_NAMES[0] : HUMAN_NAMES[pos] || ('玩家' + (pos + 1))));
        st.manual = true;
      });

      var kb = row.querySelector('.kind');
      kb.addEventListener('click', function () {
        if (st.isMe) { toast('这一席是你自己，不能改成「机」'); return; }
        st.isAI = !st.isAI;
        if (!st.manual) {
          st.name = st.isAI ? (AI_NAMES[pos - 1] || '墨客') : (HUMAN_NAMES[pos] || ('玩家' + (pos + 1)));
          inp.value = st.name;
        }
        kb.dataset.k = st.isAI ? 'ai' : 'human';
        kb.textContent = st.isAI ? '机' : '人';
      });

      bindSeatDrag(row, wrap);
      wrap.appendChild(row);
    });
  }

  /* 座位直接拖动：整行都能拖（输入框与按钮除外），松手后把顺序写回 App.seats */
  var seatDrag = null;

  function bindSeatDrag(row, wrap) {
    row.addEventListener('pointerdown', function (e) {
      if (e.target.closest('input, button')) return;
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      seatDrag = { row: row, wrap: wrap, id: e.pointerId };
      row.classList.add('dragging');
      try { row.setPointerCapture(e.pointerId); } catch (err) {}
      document.addEventListener('pointermove', onSeatMove);
      document.addEventListener('pointerup', onSeatUp);
      document.addEventListener('pointercancel', onSeatUp);
    });
  }

  function onSeatMove(e) {
    if (!seatDrag) return;
    var d = seatDrag, row = d.row, wrap = d.wrap;
    var y = e.clientY;
    var rows = Array.prototype.slice.call(wrap.querySelectorAll('.seat'));
    var target = null;
    rows.forEach(function (r) {
      if (r === row) return;
      var b = r.getBoundingClientRect();
      if (y >= b.top && y <= b.bottom) target = r;
    });
    if (!target) {
      if (y < rows[0].getBoundingClientRect().top) target = rows[0];
      else if (y > rows[rows.length - 1].getBoundingClientRect().bottom) target = rows[rows.length - 1];
    }
    if (!target) return;
    var tb = target.getBoundingClientRect();
    if (y < tb.top + tb.height / 2) wrap.insertBefore(row, target);
    else wrap.insertBefore(row, target.nextSibling);
  }

  function onSeatUp(e) {
    if (!seatDrag) return;
    var d = seatDrag, row = d.row, wrap = d.wrap;
    seatDrag = null;
    row.classList.remove('dragging');
    document.removeEventListener('pointermove', onSeatMove);
    document.removeEventListener('pointerup', onSeatUp);
    document.removeEventListener('pointercancel', onSeatUp);
    try { row.releasePointerCapture(e.pointerId); } catch (err) {}
    var ids = Array.prototype.slice.call(wrap.querySelectorAll('.seat')).map(function (r) { return r.dataset.id; });
    var ordered = ids.map(function (id) {
      return App.seats.filter(function (s) { return s.id === id; })[0];
    }).filter(Boolean);
    App.seats.forEach(function (s) { if (ordered.indexOf(s) < 0) ordered.push(s); });
    App.seats = ordered;
    buildSeats();
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
    var myIdx = App.myIdx;
    var foes = g.state.players.filter(function (p) { return p.idx !== myIdx; });
    var wrap = $('#foes');
    wrap.dataset.n = String(foes.length);
    wrap.innerHTML = '';
    foes.forEach(function (p) { wrap.appendChild(buildZone(p, true)); });

    // 自己
    var me = g.state.players[myIdx];
    var z = $('#zone-me');
    z.className = 'zone me' + (cur === myIdx && !over ? ' now' : '');
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
      d.title = '《' + c.name + '》' + c.year + '　' + (c.type || '') + '　（右键 / 长按看解析）';
      d.addEventListener('click', function () { openCard(c, g.preview(c.id, p.idx)); });
      bindArchive(d, c, function () { return g.preview(c.id, p.idx); });
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
      {
        n: '立派', v: pg.schools.now, t: cfg2.schoolTarget,
        bar: Math.min(1,
          pg.schools.now / cfg2.schoolTarget,
          cfg2.schoolMinCards ? p.hand.length / cfg2.schoolMinCards : 1),
        done: pg.schools.ok, sub: cfg2.schoolMinCards ? '谱≥' + cfg2.schoolMinCards : ''
      },
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
        if (justLongPressed(d)) return;
        if (!can) {
          toast(g.state.over ? '对局已结束'
            : (App.busy ? '稍候'
              : (curPlayer().isAI ? '等 ' + curPlayer().name + ' 走完这一手'
                : (chk.why || '现在不能辑录'))));
          return;
        }
        doPlace(id, d);
      });
      bindArchive(d, c, function () { return pv; });
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
    var p = g.state.players[App.myIdx];
    var cfg = g.config;
    var needDouble = cfg.eraDoubleSegs || 0;
    var needGroups = cfg.eraMinGroups || 3;
    var themeSet = {};
    var doubles = 0, eraCount = 0;

    wrap.innerHTML = '';
    eras.forEach(function (e, i) {
      var mine = p.hand.filter(function (c) { return c.era === i; });
      var themes = [];
      mine.forEach(function (c) {
        var t = c.typeGroup || '未分类';
        themeSet[t] = 1;
        if (themes.indexOf(t) < 0) themes.push(t);
      });
      if (mine.length) eraCount++;
      if (mine.length >= 2) doubles++;

      var cls = 'era' + (mine.length ? ' has-me' : '') + (mine.length >= 2 ? ' double' : '');
      var chips = themes.length
        ? themes.map(function (t) { return '<i>' + esc(t) + '</i>'; }).join('')
        : '<span class="era-empty">—</span>';

      var cell = el('div', cls,
        '<div class="era-name">' + e.label +
          '<b class="era-count" title="这一年代你收了几张">' + mine.length + '</b></div>' +
        '<div class="era-years">' + e.from + '–' + e.to + '</div>' +
        '<div class="era-themes">' + chips + '</div>');
      wrap.appendChild(cell);
    });

    var note = $('#era-note');
    if (note) {
      note.textContent = '已收 ' + eraCount + '/' + eras.length + ' 段 · 双收 ' +
        doubles + '/' + needDouble + ' · 主题 ' + Object.keys(themeSet).length + '/' + needGroups;
    }
  }

  /** 侧栏：自己谱中的班底（词/曲）与主题分布——用来记住「还差谁」 */
  function renderSide() {
    var g = App.game, wrap = $('#side-me');
    if (!wrap) return;
    var p = g.state.players[App.myIdx];
    var cfg = g.config;

    // --- 班底：与立派同口径，只算词人 / 曲师
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
    tutNotify('place');
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
    tutNotify('gather');
    if (g.state.over) { finish(); return; }
    g.endTurn();
    renderAll();
    pumpAI();
  }

  /** 连续推进所有 AI 玩家，直到轮到人类或对局结束 */
  function pumpAI() {
    var g = App.game;
    if (App.paused) return;
    if (g.state.over) { finish(); return; }
    if (!g.state.players[g.state.current].isAI) { renderAll(); return; }

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
    if (App.paused) { App.pendingEnd = true; return; }
    var winner = g.state.winner;
    var winP = g.state.players[winner];
    var my = App.myIdx;
    var me = g.state.players[my];
    var iWin = winner === my;
    var byLabel = { fame: '声名', schools: '立派', eras: '通史', themes: '成题', timeout: '总进度' }[g.state.winBy] || '';

    var diffCn = { easy: '初涉', normal: '熟手', hard: '老吏' }[App.lastDiff || App.difficulty] || '熟手';
    var metaBox = $('#end-meta');
    if (metaBox) {
      metaBox.innerHTML =
        '<span>玩法 <b>词宗</b></span>' +
        '<span><b>' + g.state.players.length + '</b> 人</span>' +
        '<span>难度 <b>' + diffCn + '</b></span>' +
        '<span>第 <b>' + g.state.round + '</b> 轮</span>' +
        '<span>终局 <b>' + byLabel + '</b></span>';
    }
    $('#end-title').textContent = iWin ? '谱 成' : '谱 未 成';
    $('#end-sub').innerHTML = iWin
      ? '你以<b>' + byLabel + '</b>先成一家。第 ' + g.state.round + ' 轮，声名 ' + me.fame + '，谱中 ' + me.hand.length + ' 首。'
      : '<b>' + esc(winP.name) + '</b> 以<b>' + byLabel + '</b>先成一家。第 ' + g.state.round + ' 轮，你声名 ' + me.fame + '，谱中 ' + me.hand.length + ' 首。';

    var hw = $('#end-hand'); hw.innerHTML = '';
    me.hand.forEach(function (c) {
      var d = el('div', 'mini' + (c.isSpecial ? ' sp' : ''));
      d.innerHTML = '<b>' + esc(c.name) + '</b><span class="y">' + c.year + ' · ' + esc((c.type || '').split('-')[0]) + '</span>';
      d.addEventListener('click', function () { openCard(c, g.preview(c.id, App.myIdx)); });
      bindArchive(d, c, function () { return g.preview(c.id, App.myIdx); });
      hw.appendChild(d);
    });

    function bar(name, key, target) {
      var cfg = g.config;
      var rows = g.state.players.map(function (p) {
        var pg = E.progress(p, cfg);
        var out = { name: p.name, me: p.idx === App.myIdx, v: 0, bar: 0, done: false, sub: '' };
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
          // 与对局面板同口径：显示「最接近成题」的那个主题（张数 + 跨代）
          var tTally = E.countThemes(p.hand, cfg).tally || {};
          var tk = Object.keys(tTally).sort(function (a, b) { return tTally[b] - tTally[a]; })[0];
          var tn = tk ? tTally[tk] : 0;
          var te = 0;
          if (tk) {
            var es = {};
            p.hand.forEach(function (c) { if (c.typeGroup === tk) es[c.era] = 1; });
            te = Object.keys(es).length;
          }
          out.v = tn;
          out.bar = Math.min(1, tn / cfg.themeSize, cfg.themeEras ? te / cfg.themeEras : 1);
          out.done = pg.themes.now >= 1;
          out.sub = '跨' + te + '/' + cfg.themeEras + '代' + (pg.themes.now ? ' · 已成题' : '');
        } else {
          out.v = pg.schools.now;
          out.bar = Math.min(1,
            pg.schools.now / target,
            cfg.schoolMinCards ? p.hand.length / cfg.schoolMinCards : 1);
          out.done = !!pg.schools.ok;
          out.sub = cfg.schoolMinCards ? '谱≥' + cfg.schoolMinCards : '';
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
      bar('成题', 'themes', g.config.themeSize);

    $('#end-log').innerHTML = g.state.log.slice(-30).map(function (l) {
      return '<div><span class="t">' + l.t + '</span>' + esc(l.text) + '</div>';
    }).join('');

    showView('end');
  }

  function exportList() {
    var g = App.game, me = g.state.players[App.myIdx];
    var L = [];
    L.push('《三百首·词宗》辑录');
    L.push('生成：' + new Date().toLocaleString('zh-CN'));
    L.push('结果：' + (g.state.winner === App.myIdx ? '胜' : '负（' + g.state.players[g.state.winner].name + ' 胜）') +
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
        row('词人', esc(join(c.lyricist))) +
        row('曲师', esc(join(c.composer))) +
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
      var lc = App.data.cards.filter(function (x) { return x.id === d.dataset.id; })[0];
      if (lc) bindArchive(d, lc, function () { return App.game ? App.game.preview(lc.id, App.game.state.current) : null; });
    });
  }

  /* ---------------- 模态 ---------------- */
  function openModal(id) {
    $('#' + id).classList.add('open');
    if (tut.on && tut.layer) tut.layer.style.display = 'none';
  }
  function closeModal(n) {
    n.classList.remove('open');
    if (tut.on && tut.layer) { tut.layer.style.display = ''; requestAnimationFrame(tutPos); }
  }
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
      '<p>每轮开始自动得墨：二人、三人 3 墨，四人 4 墨。<b>墨不设上限</b>，攒着等一张好牌是允许的。墨不够就只能采风。</p>',

      '<h3>② 四条终点线（达成任意一条即胜）</h3>',
      '<table>',
        '<tr><th>线</th><th>条件（二人 / 三人 / 四人）</th><th>怎么打</th></tr>',
        '<tr><td><b>声名</b></td><td>累计声名 ≥ <b>' + b2.fame + ' / ' + b3.fame + ' / ' + b4.fame + '</b></td><td>挑高声名的牌，稳扎稳打</td></tr>',
        '<tr><td><b>通史</b></td><td>六个年代各至少 1 张，其中 <b>' + b2.doubles + '</b> 段各有 2 张；' +
          '<b>全谱</b>共跨 <b>' + b2.groups + ' / ' + b3.groups + ' / ' + b4.groups +
          '</b> 个主题（不是只看那 4 段）</td><td>按年代铺开，抢年代空位</td></tr>',
        '<tr><td><b>立派</b></td><td>立 <b>' + b2.schools + ' / ' + b3.schools + ' / ' + b4.schools +
          '</b> 派：同一位词人或曲师每 2 首算 1 派</td><td>死磕同几位创作者</td></tr>',
        '<tr><td><b>成题</b></td><td>同一主题 <b>' + b2.themeSize + ' / ' + b3.themeSize + ' / ' + b4.themeSize +
          '</b> 首，且跨 <b>' + b2.themeEras + ' / ' + b3.themeEras + ' / ' + b4.themeEras + '</b> 个年代</td><td>按主题横向收束，一类到底</td></tr>',
      '</table>',
      '<p style="font-size:11.5px;color:var(--ink-3)">表里的三档依次对应二人、三人、四人局。</p>',

      '<p><b>立派按「每两首」算。</b>同一位创作者在你谱里有 2 首＝1 派，有 4 首＝2 派。只算词人、曲师两类角色，同一张牌可以同时算进两派。' +
        '<br>例：河图 2 首（1 派）、Finale 4 首（2 派）、银临 2 首（1 派）——合计 4 派。' +
        '<br><b>张数门槛</b>：二人、三人局谱里至少 <b>10</b> 首，四人局 <b>11</b> 首。' +
        '若其中某一位词人或曲师已经出现 <b>3</b> 首（也就是这一派已有 3 张），可免这条张数要求。</p>',
      '<div class="note">' +
        '<b>跨角色也算。</b>甲是 A 的歌的词人，又是 B 的歌的曲师——A 与 B 合起来可以算甲的一派。<br>' +
        '<b>但同一首歌里词、曲都是甲，只算一张</b>，不能自己跟自己成组。' +
      '</div>',
      '<p><b>成题要跨年代。</b>同一主题收满 ' + b2.themeSize + ' 首还不够，这些歌必须来自 ' + b2.themeEras +
        ' 个不同年代。它和「通史」正好相反：通史要铺满六个年代，成题要一类到底。</p>',

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
      '<p class="note">第一次玩，直接点首页的<b>新手教程</b>：从选人数、认牌、收第一张牌，到看四条进度条，一步步带你走完。</p>'
    ].join('');
  }

  /* ---------------- 棋盘局规则 ---------------- */
  function renderBoardRules() {
    var B = window.SBBoard.BOARD;

    $('#rule-body').innerHTML = [
      '<div class="rule-lead">',
        '<b>一句话：</b>掷骰走 49 格，落地翻牌、收歌占地；声名先到 <b>' + B.fameTarget + '</b> 者胜。',
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
        '<tr><td><b>歌格</b></td><td>翻开后若无人占，可付墨收下；费用与声名算法与《词宗》相同</td></tr>',
        '<tr><td><b>开卷格 / 段首</b></td><td>落地 +' + B.startBonus + ' ／ +1 声名</td></tr>',
        '<tr><td><b>机会格</b>（第 1、3、5 段末）</td><td>抽一张：得墨、加声名、前进 2–3 格、下一张免墨</td></tr>',
        '<tr><td><b>命运格</b>（第 2、4、6 段末）</td><td>抽一张：失墨、减声名、后退、停一手，也夹着几张吉牌</td></tr>',
      '</table>',
      '<p>开局全部扣着（问号 + 斜纹），走到才翻开。格子右上角是整条路径的编号 1–49，跟着编号走就是一条龙。</p>',

      '<h3>③ 成组：三个维度各自算</h3>',
      '<table>',
        '<tr><th>维度</th><th>怎么算</th></tr>',
        '<tr><td>年代段</td><td>同一「年代段」里占了几格</td></tr>',
        '<tr><td>主题</td><td>史同／架空／人生／文化，同一类占了几格</td></tr>',
        '<tr><td>班底</td><td>同一位词人或曲师，占了几格</td></tr>',
      '</table>',
      '<p>任一维度占满 ' + B.groupSize + ' 格即成一组：立刻 <b>+' + B.groupBonus + ' 声名</b>，且该组的过路费按满额收。右侧<b>成组看板</b>会把三个维度各占几格摊开，成组的标朱。</p>',
      '<div class="note"><b>班底怎么算：</b>只算词人、曲师两类角色。' +
        '甲是 A 的歌的词人、又是 B 的歌的曲师——A 与 B 合起来可以算甲的班底；' +
        '但如果同一首歌里词、曲都是甲，这一首只算一格，不能自己跟自己凑成组。</div>',

      '<h3>④ 占地与过路费</h3>',
      '<p>你收下的格子会留朱框和名字，别人再踩到就要付墨给你：</p>',
      '<table>',
        '<tr><td>基本</td><td>按这首歌在你手上所属的<b>最大一组</b>收：组里 1 格 1 墨、2 格 2 墨、3 格 3 墨</td></tr>',
        '<tr><td>归谁</td><td>踩的人<b>付墨</b>，这笔墨转成<b>你（格子主人）的声名</b>——被人参看就是被人引用</td></tr>',
        '<tr><td>重修</td><td>你<b>再走一圈又踩回自己已占的格子</b>，这一格的过路费永久 +1（最多 +2）。不是你走第几圈全局加价，而是哪一格被你重修过，哪一格才加</td></tr>',
        '<tr><td>付不起</td><td>空手而过，<b>声名 −' + B.debtPenalty + '</b>；若声名因此归零，<b>谱全失、占地释放、退回开卷格重来</b></td></tr>',
      '</table>',
      '<div class="note">格子右下的「N 墨」就是这一脚要付的钱。被主人重修过的格子，数字会自己变大。</div>'
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
      '<p class="note" style="font-size:12px">牌库更新：双击项目根目录的 <code>更新数据.bat</code> 即可重建。详细步骤见 <code>说明.md</code>。</p>'
    ].join('');
  }

  /* ---------------- 视图 ---------------- */
  function showView(name) {
    $$('.view').forEach(function (v) { v.classList.remove('is-active'); });
    $('#view-' + name).classList.add('is-active');
    window.scrollTo(0, 0);
  }

  function startGame() {
    App.lastDiff = App.difficulty;
    if (tut.on && tut.phase === 'intro') {
      if (tut.flow === 'board') tutStartBoardGame(); else tutStartGame();
      return;
    }
    var roster = App.seats.slice(0, App.count).map(function (s, i) {
      return { name: s.name || (i === 0 ? '你' : '墨客'), isAI: !!s.isAI, isMe: !!s.isMe };
    });

    if (App.mode === 'board') { launchBoard(roster, {}); return; }

    launchDeck(roster, {});
    if (roster.filter(function (r) { return r.isAI; }).length) {
      toast('点歌肆里的一张牌辑录；付不起就点「采风」。右键或长按卡牌可读解析。', 3400);
    } else {
      toast('热座局：轮到谁，谁的名字旁会出现「此刻」。', 3200);
    }
  }

  /** 开局（词路）。tutorial=true 时用固定骰序与熟歌，并弹出引导。 */
  function launchBoard(roster, opts) {
    opts = opts || {};
    App.lastMode = 'board';
    App.paused = false;
    showView('board');
    window.SBBoard.cfg.difficulty = App.difficulty;
    // 默认 7 列；只认用户手选过的值（窄屏可自己在图例右侧切 4–6）
    var savedCols = null;
    try { savedCols = localStorage.getItem('sb_board_cols'); } catch (e) {}
    window.SBBoard.BOARD.cols = savedCols ? Math.max(4, Math.min(7, +savedCols)) : 7;
    window.SBBoard.start(roster, { firstSeat: 0, tutorial: !!opts.tutorial });
    if (opts.tutorial && !opts.manual) setTimeout(function () { tutBoardFlow(); tutShow(3); }, 520);
    if (!opts.tutorial && !opts.manual) {
      toast('轮到你时点「掷骰」行棋；缺墨可「采风」换 4 墨。声名先到 ' +
        window.SBBoard.BOARD.fameTarget + ' 者胜。', 3600);
    }
  }

  /** 开局（词宗）。tutorial 传入固定种子与两人阵容，走教程流程。 */
  function launchDeck(roster, opts) {
    opts = opts || {};
    App.myIdx = Math.max(0, roster.map(function (r) { return !!r.isMe; }).indexOf(true));
    App.game = new E.Game(App.data.cards, {
      eraCount: (App.data.meta.eras || []).length || 6,
      players: roster,
      seed: opts.seed
    });
    App.busy = false;
    App.paused = false;
    App.pendingEnd = false;
    App.lastMode = 'deck';
    showView('game');
    renderAll();
    pumpAI();
  }

  /** 返回首页：只在对局稳定时允许（AI 思考 / 棋子在走时先拦一下） */
  function returnHome(which) {
    if (which === 'board') {
      var BS = window.SBBoard && window.SBBoard.S;
      if (BS && BS.players.length && !BS.over) {
        if (BS.phase !== 'idle') { toast('等这一手走完再返回'); return; }
        window.SBBoard.pause();
      }
    } else if (App.game && !App.game.state.over) {
      if (App.busy) { toast('等这一手走完再返回'); return; }
      App.paused = true;
    }
    App.paused = true;
    App.lastMode = which;
    showView('intro');
    renderIntro();
  }

  function continueGame() {
    if (App.lastMode === 'board' && window.SBBoard.S.players.length && !window.SBBoard.S.over) {
      showView('board');
      window.SBBoard.resume();
      return;
    }
    if (App.game && !App.game.state.over) {
      App.paused = false;
      showView('game');
      renderAll();
      if (App.pendingEnd) { App.pendingEnd = false; finish(); return; }
      pumpAI();
    }
  }

  function updateResume() {
    var bar = $('#resume-bar');
    if (!bar) return;
    var deckLive = App.game && !App.game.state.over;
    var boardLive = window.SBBoard && window.SBBoard.S.players.length && !window.SBBoard.S.over;
    if (!deckLive && !boardLive) { bar.hidden = true; return; }
    var mode = App.lastMode;
    if (mode === 'board' && !boardLive) mode = deckLive ? 'deck' : 'board';
    if (mode === 'deck' && !deckLive) mode = boardLive ? 'board' : 'deck';
    App.lastMode = mode;
    var name = mode === 'board'
      ? '词路 · 已行 ' + window.SBBoard.S.turns + ' 手'
      : '词宗 · 第 ' + App.game.state.round + ' 轮';
    bar.hidden = false;
    var n = $('#resume-name');
    if (n) n.textContent = name;
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
        var sub = $('#tut-sub');
        if (sub) sub.textContent = App.mode === 'board'
          ? '两分钟，带你看懂棋盘、掷骰与成组'
          : '三分钟，一步步带你走完一回合';
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
    var bt = $('#btn-tutorial');
    if (bt) bt.addEventListener('click', function () {
      if (App.game && !App.game.state.over) { App.paused = true; App.lastMode = 'deck'; }
      var BS = window.SBBoard && window.SBBoard.S;
      if (BS && BS.players.length && !BS.over) { window.SBBoard.pause(); }
      showView('intro');
      renderIntro();
      startTutorial();
    });
    $('#btn-again').addEventListener('click', function () { showView('intro'); renderIntro(); });
    $('#btn-export').addEventListener('click', exportList);
    var bs = $('#btn-share');
    if (bs) bs.addEventListener('click', function () { showShare(deckShareSpec()); });
    var bps = $('#bp-share');
    if (bps) bps.addEventListener('click', function () { showShare(boardShareSpec()); });
    $('#btn-gather').addEventListener('click', doGather);

    ['btn-rules', 'btn-rules-intro'].forEach(function (id) {
      var b = $('#' + id); if (b) b.addEventListener('click', function () { renderRules(); openModal('modal-rules'); });
    });
    ['btn-data', 'btn-data-intro'].forEach(function (id) {
      var b = $('#' + id); if (b) b.addEventListener('click', function () { renderDataPanel(); openModal('modal-data'); });
    });
    var bc = $('#btn-cards-intro'); if (bc) bc.addEventListener('click', openLibrary);

    $('#btn-home').addEventListener('click', function () { returnHome('deck'); });
    var brs = $('#btn-resume');
    if (brs) brs.addEventListener('click', continueGame);
    var brn = $('#btn-resume-new');
    if (brn) brn.addEventListener('click', function () {
      if (!confirm('重开一局？当前进度会丢失。')) return;
      App.game = null;
      if (window.SBBoard) window.SBBoard.reset();
      App.mode = App.lastMode;
      $$('#mode-pick .orb').forEach(function (x) {
        x.classList.toggle('on', x.dataset.mode === App.mode);
        x.setAttribute('aria-pressed', x.dataset.mode === App.mode ? 'true' : 'false');
      });
      App.paused = false; App.pendingEnd = false;
      startGame();
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
    if (bk) bk.addEventListener('click', function () { returnHome('board'); });
    var br = $('#bp-rules');
    if (br) br.addEventListener('click', function () { renderBoardRules(); openModal('modal-rules'); });
    var bd = $('#bp-data');
    if (bd) bd.addEventListener('click', function () { renderDataPanel(); openModal('modal-data'); });
    var ba = $('#bp-again');
    if (ba) ba.addEventListener('click', function () {
      closeModal($('#modal-bp-result'));
      var roster = App.seats.slice(0, App.count).map(function (s, i) {
        return { name: s.name || (i === 0 ? '你' : '墨客'), isAI: !!s.isAI, isMe: !!s.isMe };
      });
      window.SBBoard.start(roster, { firstSeat: 0 });
    });
    var bh = $('#bp-home');
    if (bh) bh.addEventListener('click', function () {
      closeModal($('#modal-bp-result')); showView('intro'); renderIntro();
    });
  }

  /* ---------------- 新手教程 ----------------
     一个轻量引导层：四块遮罩挖一个洞，洞套住目标元素，旁边浮一张说明卡。
     需要「跟着做」的步骤用 wait 挂起，等 doPlace / doGather / 开卷 发事件再前进。 */

  /* 教程局用的牌：按「解析数 + 三平台热度榜」挑的，都是三百首里最熟的几首 */
  var TUT_CARDS = ['牵丝戏', '赤伶', '悟空', '人间不值得', '不谓侠', '是风动'];
  var tut = { on: false, i: 0, offset: 0, steps: [], step: null, layer: null, tip: null, ring: null, masks: [], phase: 'idle', flow: null, snap: null, lastTarget: null };

  /* 教程局的「熟歌」排序：榜上排名 − 解析数 × 30（见 js/hot.js） */
  function tutHotScore(c) {
    return window.SBHOT ? SBHOT.score(c) : 9999;
  }

  function tutLayer() {
    if (tut.layer) return;
    var layer = el('div', 'tut-layer');
    ['t', 'b', 'l', 'r'].forEach(function () {
      layer.appendChild(el('div', 'tut-mask'));
    });
    tut.ring = el('div', 'tut-ring');
    tut.tip = el('div', 'tut-tip');
    tut.tip.style.left = '-9999px';
    tut.tip.style.top = '0px';
    layer.appendChild(tut.ring);
    layer.appendChild(tut.tip);
    layer.style.visibility = 'hidden';
    document.body.appendChild(layer);
    tut.layer = layer;
    tut.masks = $$('.tut-mask', layer);
    window.addEventListener('resize', tutPos);
    window.addEventListener('scroll', tutPos, true);
  }

  function tutRemove() {
    if (tut.layer) tut.layer.remove();
    if (tut.lastTarget) tut.lastTarget.classList.remove('tut-target');
    window.removeEventListener('resize', tutPos);
    window.removeEventListener('scroll', tutPos, true);
    tut.layer = null; tut.tip = null; tut.ring = null; tut.masks = []; tut.lastTarget = null;
  }

  function tutPos() {
    if (!tut.on || !tut.step || !tut.tip) return;
    var st = tut.step;
    var target = st.sel ? document.querySelector(st.sel) : null;
    var vw = window.innerWidth, vh = window.innerHeight;
    var tw = Math.min(336, vw - 28);
    var pad = st.pad || 7;
    var r = target ? target.getBoundingClientRect() : null;
    var tipH = tut.tip.offsetHeight;

    tut.tip.style.width = tw + 'px';
    var left, top;
    if (r) {
      left = Math.max(12, Math.min(vw - tw - 12, r.left + r.width / 2 - tw / 2));
      if (r.bottom + 14 + tipH < vh - 10) top = r.bottom + 14;
      else if (r.top - 14 - tipH > 10) top = r.top - 14 - tipH;
      else top = Math.max(10, vh - tipH - 10);
    } else {
      left = (vw - tw) / 2;
      top = Math.max(10, (vh - tipH) / 2);
    }
    tut.tip.style.left = left + 'px';
    tut.tip.style.top = top + 'px';

    if (!r) {
      tut.ring.style.display = 'none';
      setMask(tut.masks[0], 0, 0, vw, vh);
      setMask(tut.masks[1], 0, 0, 0, 0);
      setMask(tut.masks[2], 0, 0, 0, 0);
      setMask(tut.masks[3], 0, 0, 0, 0);
      return;
    }
    tut.ring.style.display = 'block';
    tut.ring.style.left = (r.left - pad) + 'px';
    tut.ring.style.top = (r.top - pad) + 'px';
    tut.ring.style.width = (r.width + pad * 2) + 'px';
    tut.ring.style.height = (r.height + pad * 2) + 'px';

    var x1 = Math.max(0, r.left - pad), x2 = Math.min(vw, r.right + pad);
    var y1 = Math.max(0, r.top - pad), y2 = Math.min(vh, r.bottom + pad);
    setMask(tut.masks[0], 0, 0, vw, y1);
    setMask(tut.masks[1], 0, y2, vw, Math.max(0, vh - y2));
    setMask(tut.masks[2], 0, y1, x1, Math.max(0, y2 - y1));
    setMask(tut.masks[3], x2, y1, Math.max(0, vw - x2), Math.max(0, y2 - y1));
  }

  function setMask(m, x, y, w, h) {
    m.style.left = x + 'px'; m.style.top = y + 'px';
    m.style.width = Math.max(0, w) + 'px'; m.style.height = Math.max(0, h) + 'px';
  }

  function tutShow(i) {
    if (!tut.on) return;
    if (i >= tut.steps.length) { tutEnd(); return; }
    tut.i = i;
    tut.step = tut.steps[i];
    var st = tut.step;
    if (st.before) st.before();

    var body = typeof st.text === 'function' ? st.text() : st.text;
    var acts = '';
    if (st.actions) {
      acts = st.actions.map(function (a, k) {
        return '<button class="nav' + (a.primary ? ' primary' : '') + '" data-act="' + k + '">' + a.label + '</button>';
      }).join('');
    } else if (st.wait) {
      acts = '<span class="tp-wait">请在高亮处操作</span>';
    } else {
      acts = '<button class="nav primary" id="tut-next">' + (i === tut.steps.length - 1 ? '完 成' : '下一步') + '</button>';
    }

    tut.tip.innerHTML =
      '<div class="tp-k">新 手 教 程 · ' + (tut.offset ? (i + tut.offset + 1) + ' / ' + (tut.steps.length + tut.offset) : '第 ' + (i + 1) + ' 步') + '</div>' +
      '<h4>' + st.title + '</h4>' +
      '<p>' + body + '</p>' +
      '<div class="tp-acts' + (st.actions && st.actions.length > 1 ? ' stack' : '') + '">' +
        (st.actions && st.actions.length > 1 ? '' : '<span class="sp"></span>') + acts +
        '<button class="skip" id="tut-skip">跳过</button></div>';

    var nx = $('#tut-next');
    if (nx) nx.addEventListener('click', tutNext);
    var sk = $('#tut-skip');
    if (sk) sk.addEventListener('click', function () { tutEnd(true); });
    $$('[data-act]', tut.tip).forEach(function (b) {
      b.addEventListener('click', function () { st.actions[+b.dataset.act].fn(); });
    });

    if (tut.lastTarget) tut.lastTarget.classList.remove('tut-target');
    var target = st.sel ? document.querySelector(st.sel) : null;
    tut.lastTarget = target;
    if (target) {
      target.classList.add('tut-target');
      try { target.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) { target.scrollIntoView(); }
    }
    requestAnimationFrame(function () {
      tutPos();
      if (tut.layer) tut.layer.style.visibility = '';
    });
  }

  function tutNext() { tutShow(tut.i + 1); }

  function tutNotify(kind) {
    if (!tut.on || !tut.step || tut.step.wait !== kind) return;
    if (kind === 'place' && App.game && App.game.state.lastAction) {
      var la = App.game.state.lastAction;
      tut.snap = { cost: la.preview.cost, fame: la.preview.fame, name: la.card.name };
    }
    setTimeout(tutNext, kind === 'place' ? 1800 : (kind === 'roll' ? 1300 : 700));
  }
  App.tutNotify = tutNotify;

  function tutEnd(skipped) {
    tut.on = false; tut.phase = 'idle';
    if (tut.flow === 'board' && window.SBBoard && window.SBBoard.S) {
      window.SBBoard.S.scripted = [];
      window.SBBoard.render();
    }
    tutRemove();
    toast(skipped ? '教程已跳过；想再看，点首页「新手教程」。' : '教程到此。点右上角「规则」可随时查条款。', 3000);
  }

  function setMode(mode) {
    App.mode = mode;
    $$('#mode-pick .orb').forEach(function (x) {
      x.classList.toggle('on', x.dataset.mode === mode);
      x.setAttribute('aria-pressed', x.dataset.mode === mode ? 'true' : 'false');
    });
    var sub = $('#tut-sub');
    if (sub) sub.textContent = mode === 'board'
      ? '两分钟，带你看懂棋盘、掷骰与成组'
      : '三分钟，一步步带你走完一回合';
  }

  function startTutorial() {
    if (tut.on) return;
    tut.on = true; tut.phase = 'intro'; tut.i = 0; tut.offset = 0; tut.flow = null; tut.snap = null;
    tutLayer();
    tut.steps = [{
      sel: '.mode-pick', title: '先学哪一种？',
      text: '两种打法共用同一副 377 首的牌。<br>选一个，我带你走一遍；教程随时可以再点开，不会只给一次。',
      actions: [
        { label: '词宗 · 辑录选牌', primary: true, fn: function () { tutDeckFlow(); } },
        { label: '词路 · 掷骰行棋', fn: function () { tutBoardFlow(); } }
      ]
    }];
    tutShow(0);
  }

  function seatStep() {
    return {
      sel: '#seats', title: '座位就是出手顺序',
      text: '从上到下依次出手。按住行首的<b>「⋮⋮」</b>可以直接拖动换位——你想坐哪一位都行，不一定是先手。<br>三人、四人局的后手有墨与声名的补偿，越靠后补得越多。'
    };
  }
  function diffStep() {
    return {
      sel: '#seg-difficulty', title: '难度只影响对手',
      text: '<b>初涉</b>会犯明显的错，<b>熟手</b>偶尔失手，<b>老吏</b>每手挑最优、算得出制胜与卡位。教程局固定用初涉。'
    };
  }

  /* 词宗分支 */
  function tutDeckFlow() {
    setMode('deck');
    tut.flow = 'deck';
    tut.offset = 1;
    tut.steps = [
      seatStep(),
      diffStep(),
      {
        sel: '#btn-start', title: '点「开卷」开始',
        text: '教程局固定你先手，只有你和一位初涉墨客；牌序按热度挑过，最先出的都是最火的歌。<br><b>点上面的「开卷」。</b>',
        wait: 'start'
      },
      {
        sel: '#market', title: '歌肆：公共牌列',
        text: '这五张是公共的，你拿走别人就没有。每张牌左下角是<b>墨费</b>，右下角是<b>声名</b>。'
      },
      {
        sel: null, title: '先收一张试试',
        text: '点高亮的牌，把它收进自己的谱。',
        before: function () {
          var g = App.game;
          if (!g) return;
          var p = g.state.players[App.myIdx];
          var best = null;
          g.state.market.forEach(function (id) {
            var pv = g.preview(id, App.myIdx);
            if (pv && pv.cost <= p.ink && (!best || pv.fame > best.pv.fame)) best = { id: id, pv: pv };
          });
          if (best) {
            tut.steps[4].sel = '#market .card[data-id="' + best.id + '"]';
            tut.steps[4].wait = 'place';
            tut.steps[4].text = '点高亮的《' + g.card(best.id).name + '》——费 <b>' + best.pv.cost +
              ' 墨</b>，得 <b>+' + best.pv.fame + ' 声名</b>。';
          } else {
            tut.steps[4].sel = '#btn-gather';
            tut.steps[4].wait = 'gather';
            tut.steps[4].text = '手上的墨不够收牌，先点下面的<b>「采风」</b>换 4 墨。';
          }
        }
      },
      {
        sel: '.zone.me .goals', title: '四条终点线',
        text: '<b>声名</b>＝挑高声名的牌，稳扎稳打；<b>通史</b>＝按年代铺开，抢年代空位；<b>立派</b>＝死磕同几位创作者；<b>成题</b>＝按主题横向收束，一类到底。<br>任意一条先达成就赢，不用四条都做；具体门槛在右上角「规则」。'
      },
      {
        sel: '.zone.me', title: '这一行是你',
        text: function () {
          var sn = tut.snap;
          if (sn) {
            return '你花 <b>' + sn.cost + ' 墨</b>收下《' + sn.name + '》，声名 <b>+' +
              sn.fame + '</b>。墨是当钱用的；声名是四条终点线里的一条。';
          }
          return '墨是当钱用的；声名是四条终点线里的一条。谱里的牌会一直留着，四条线都从谱里算。';
        }
      },
      {
        sel: '#timeline', title: '编年轴：看六个年代',
        text: '六个年代各收了几张，一眼就能看出「通史」还缺哪一段。你收一张，对应的格子就会亮起来。'
      },
      {
        sel: '#side-me', title: '右栏：班底与主题',
        text: '这里把<b>班底</b>（词／曲各几首，够 2 首标朱）和<b>主题</b>（四类各几首、跨几代）摊开，不用自己记「还差谁」。'
      },
      {
        sel: '.parse-flag', title: '右键 / 长按，读解析',
        text: '任何一张牌，<b>右键</b>（手机<b>长按</b>）都能看完整档案：词曲编唱、笺注出处，以及这首歌的解析。<br>牌面右上角有「注」的，就是有解析的。'
      },
      {
        sel: '#btn-gather', title: '墨不够，就采风——点一下试试',
        text: '得 <b>4 墨</b>，换掉歌肆最左一张；代价是这一轮不能收歌。<br><b>点上面高亮的「采风」。</b>',
        wait: 'gather'
      },
      {
        sel: null, title: '教程到此',
        text: '这局可以接着打，也可以重开一局正式对局。教程随时能再点开。',
        actions: [
          { label: '继续这局', primary: true, fn: function () { tutEnd(); } },
          { label: '重开正式局', fn: function () { tutEnd(); App.game = null; startGame(); } }
        ]
      }
    ];
    tutShow(0);
  }

  /* 词路分支 */
  function tutBoardFlow() {
    setMode('board');
    tut.flow = 'board';
    tut.offset = 1;
    tut.steps = [
      seatStep(),
      diffStep(),
      {
        sel: '#btn-start', title: '点「开卷」开始',
        text: '教程局只有你和一位初涉墨客；棋盘每段第一格都换成了熟歌，骰子也先走固定点数。',
        wait: 'start'
      },
      {
        sel: '#bp-grid', title: '棋盘：49 格一条龙',
        text: '开卷格 + 6 段 × 8 格 = 49 格，跟着右上角编号走。<br>扣着的格子<b>走到才翻开</b>：歌格可以辑录占地，段末是机会 / 命运。'
      },
      {
        sel: '#bp-roll', title: '轮到你，点这里掷骰',
        text: '掷骰前进 1–6 格，落地结算。<br><b>上面全暗只是还没走，不是卡住</b>——点这个朱色「掷骰」。',
        wait: 'roll'
      },
      {
        sel: '#bp-buy', title: '落地之后：点「辑录」',
        text: '脚下是歌格：点<b>「辑录」</b>，付墨把这张收进谱里，并占住这一格。<br>墨不够或不想收，才点「略过」；翻到机会 / 命运则直接结算。',
        wait: 'buy'
      },
      {
        sel: '#bp-side', title: '右侧：成组看板',
        text: '年代段 / 主题 / 班底，任一维度占满 <b>3 格</b>即成一組：立刻 +' + (window.SBBoard.BOARD.groupBonus || 3) + ' 声名，过路费也按满额收。'
      },
      {
        sel: '#bp-gather', title: '缺墨就采风',
        text: '得 <b>4 墨</b>，这一轮不行棋。手上缺墨时用它换钱。'
      },
      {
        sel: null, title: '开始行棋',
        text: '落地翻牌、收歌占地；声名先到 <b>120</b> 者胜。<br>踩到别人的格子付不起墨，会掉 5 声名。',
        actions: [
          { label: '知道了', primary: true, fn: function () { tutEnd(); } }
        ]
      }
    ];
    tutShow(0);
  }

  /** 教程局（词宗）：固定两人、固定种子，歌肆换成挑过的热门牌 */
  function tutStartGame() {
    tut.phase = 'game';
    var roster = [
      { name: '你', isMe: true, isAI: false },
      { name: '墨客', isMe: false, isAI: true }
    ];
    launchDeck(roster, { seed: 20261102 });
    var g = App.game;
    var ids = TUT_CARDS.map(function (n) {
      var c = App.data.cards.filter(function (x) { return x.name === n; })[0];
      return c || null;
    }).filter(Boolean).sort(function (a, b) {
      return tutHotScore(a) - tutHotScore(b);
    }).map(function (c) { return c.id; });
    g.state.piles.forEach(function (pile) {
      for (var i = pile.length - 1; i >= 0; i--) if (ids.indexOf(pile[i]) >= 0) pile.splice(i, 1);
    });
    g.state.market = ids.slice(0, g.marketSize);
    // 教程局不按年代分堆：所有剩余牌按热度排成一条，补牌永远先出最热的
    var rest = [];
    g.state.piles.forEach(function (pile) { rest = rest.concat(pile); });
    rest = rest.filter(function (id) { return ids.indexOf(id) < 0; });
    // pop() 取末尾，所以越热越靠后；市场展示时再反过来（最热在左）
    rest.sort(function (a, b) { return tutHotScore(g.card(b)) - tutHotScore(g.card(a)); });
    g.state.piles = [rest];
    g.state.market.sort(function (a, b) { return tutHotScore(g.card(a)) - tutHotScore(g.card(b)); });
    var rawRefill = g.refill.bind(g);
    g.refill = function () {
      rawRefill();
      g.state.market.sort(function (a, b) { return tutHotScore(g.card(a)) - tutHotScore(g.card(b)); });
    };
    g.refill();
    g.log('教程局：歌肆与后续补牌都按「解析数 + 热度榜」排序。');
    renderAll();
    setTimeout(function () { tutShow(3); }, 450);
  }

  /** 教程局（词路）：固定两人、固定骰序，每段第一格是熟歌 */
  function tutStartBoardGame() {
    tut.phase = 'game';
    var roster = [
      { name: '你', isMe: true, isAI: false },
      { name: '墨客', isMe: false, isAI: true }
    ];
    launchBoard(roster, { tutorial: true, manual: true });
    setTimeout(function () { tutShow(3); }, 600);
  }

  /* ---------------- 战绩卡（Canvas 生成 PNG） ---------------- */
  var DIFF_LABEL = { easy: '初涉', normal: '熟手', hard: '老吏' };

  function deckShareSpec() {
    var g = App.game;
    if (!g) return null;
    var my = App.myIdx, me = g.state.players[my], winP = g.state.players[g.state.winner];
    var cfg = g.config, pg = E.progress(me, cfg);
    var iWin = g.state.winner === my;
    var byLabel = { fame: '声名', schools: '立派', eras: '通史', themes: '成题', timeout: '总进度' }[g.state.winBy] || '声名';

    var th = (pg.themes.detail || [])[0] || { count: 0, eras: 0 };
    var dbl = cfg.eraDoubleSegs || 0, grp = cfg.eraMinGroups || 0;
    var eraP = Math.min(pg.eras.now / cfg.eraTarget, dbl ? (pg.eras.doubles || 0) / dbl : 1, grp ? (pg.eras.groups || 0) / grp : 1);

    return {
      mode: '词宗',
      win: iWin,
      verdict: iWin ? '谱 成' : '谱 未 成',
      line: iWin ? '以「' + byLabel + '」先成一家' : '「' + winP.name + '」以「' + byLabel + '」先成一家',
      meta: [g.state.players.length + ' 人', DIFF_LABEL[App.lastDiff || App.difficulty] || '熟手', '第 ' + g.state.round + ' 轮'],
      players: g.state.players.map(function (p) {
        return { name: p.name, fame: p.fame, hand: p.hand.length, me: p.idx === my, win: p.idx === g.state.winner };
      }),
      rows: [
        { k: '声名', v: pg.fame.now + ' / ' + cfg.fameTarget, p: Math.min(1, pg.fame.now / cfg.fameTarget) },
        { k: '通史', v: pg.eras.now + '/6 段 · 双 ' + (pg.eras.doubles || 0) + '/' + dbl + ' · 跨 ' + (pg.eras.groups || 0) + '/' + grp, p: eraP },
        { k: '立派', v: pg.schools.now + ' / ' + cfg.schoolTarget + ' 派', p: Math.min(1, pg.schools.now / cfg.schoolTarget) },
        { k: '成题', v: th.count + ' 首（跨 ' + (th.eras || 0) + ' 代）/ ' + cfg.themeSize + ' 首 · ' + (cfg.themeEras || 0) + ' 代',
          p: Math.min(1, Math.min(th.count / cfg.themeSize, (th.eras || 0) / (cfg.themeEras || 1))) }
      ],
      section: '四 条 线',
      songs: me.hand.map(function (c) { return c.name; }).slice(0, 8),
      note: '声名 ' + me.fame + ' · 谱中 ' + me.hand.length + ' 首'
    };
  }

  function boardShareSpec() {
    var B = window.SBBoard;
    if (!B || !B.S || !B.S.players.length) return null;
    var S = B.S, me = S.players[S.myIdx], w = S.players[S.winner];
    var iWin = S.winner === S.myIdx;
    var cells = S.cells.filter(function (c) { return c.owner === S.myIdx; }).length;
    var groups = Object.keys(me.rewarded || {}).length;
    return {
      mode: '词路',
      win: iWin,
      verdict: iWin ? '路 成' : '路 未 成',
      line: iWin ? '以声名 ' + me.fame + ' 先成一家' : '「' + w.name + '」以声名 ' + w.fame + ' 先成一家',
      meta: [S.players.length + ' 人', DIFF_LABEL[B.cfg.difficulty] || '熟手', S.turns + ' 手'],
      players: S.players.slice().sort(function (a, b) { return b.fame - a.fame; }).map(function (p) {
        return { name: p.name, fame: p.fame, hand: p.hand.length, me: p.idx === S.myIdx, win: p.idx === S.winner };
      }),
      rows: [
        { k: '声名', v: me.fame + ' / ' + B.BOARD.fameTarget, p: Math.min(1, me.fame / B.BOARD.fameTarget) },
        { k: '占地', v: cells + ' 格', p: Math.min(1, cells / 18) },
        { k: '成组', v: groups + ' 组', p: Math.min(1, groups / 5) },
        { k: '行棋', v: me.lap + ' 卷 · ' + me.hand.length + ' 首', p: Math.min(1, me.lap / 3) }
      ],
      section: '战 绩',
      songs: me.hand.map(function (c) { return c.name; }).slice(0, 8),
      note: '共 ' + S.players.length + ' 家 · 声名先到 ' + B.BOARD.fameTarget
    };
  }

  function rrect(ctx, l, t, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(l + r, t);
    ctx.arcTo(l + w, t, l + w, t + h, r);
    ctx.arcTo(l + w, t + h, l, t + h, r);
    ctx.arcTo(l, t + h, l, t, r);
    ctx.arcTo(l, t, l + w, t, r);
    ctx.closePath();
  }

  function spaced(ctx, text, x, y, gap) {
    var cx = x;
    for (var i = 0; i < text.length; i++) {
      ctx.fillText(text[i], cx, y);
      cx += ctx.measureText(text[i]).width + gap;
    }
    return cx;
  }

  /** 真正的绘制：H 由外部决定，返回内容底部 y（用于自适应高度） */
  function paintShare(c, spec, H) {
    var W = 900, M = 84;
    var SERIF = '"Songti SC","STSong","SimSun","Noto Serif CJK SC",serif';
    var SANS = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif';

    c.fillStyle = '#f7f2e7'; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(158,61,50,.03)';
    for (var i = 0; i < H; i += 6) c.fillRect(0, i, W, 1);

    c.strokeStyle = 'rgba(158,61,50,.55)'; c.lineWidth = 2;
    c.strokeRect(40, 40, W - 80, H - 80);
    c.strokeStyle = 'rgba(158,61,50,.16)'; c.lineWidth = 1;
    c.strokeRect(52, 52, W - 104, H - 104);

    // 页眉
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#8a7a68'; c.font = '22px ' + SERIF;
    spaced(c, '三 百 首', M, 118, 4);
    c.font = '14px ' + SANS; c.fillStyle = '#a2957f';
    c.textAlign = 'right';
    c.fillText('377 首古风歌曲', W - M - 124, 116);
    c.textAlign = 'left';

    // 玩法印
    c.fillStyle = '#9e3d32';
    rrect(c, W - M - 100, 90, 100, 40, 2); c.fill();
    c.fillStyle = '#fbf3e6'; c.font = '19px ' + SERIF; c.textAlign = 'center';
    c.fillText('词 ' + (spec.mode === '词宗' ? '宗' : '路'), W - M - 50, 118);
    c.textAlign = 'left';

    // 判定
    var y = 240;
    c.fillStyle = spec.win ? '#9e3d32' : '#2f2a24';
    c.font = '74px ' + SERIF;
    spaced(c, spec.verdict, M, y, 9);
    if (spec.win) {
      c.strokeStyle = 'rgba(158,61,50,.45)'; c.lineWidth = 2;
      c.beginPath(); c.arc(W - M - 32, y - 24, 33, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#9e3d32'; c.font = '21px ' + SERIF; c.textAlign = 'center';
      c.fillText('胜', W - M - 32, y - 16);
      c.textAlign = 'left';
    }

    c.fillStyle = '#5a5249'; c.font = '22px ' + SERIF;
    c.fillText(spec.line, M, y + 58);

    // 元信息
    var cx = M, cy = y + 92;
    c.font = '15px ' + SANS;
    spec.meta.forEach(function (t) {
      var w = c.measureText(t).width + 26;
      c.strokeStyle = 'rgba(90,82,73,.3)'; c.lineWidth = 1;
      rrect(c, cx, cy, w, 30, 2); c.stroke();
      c.fillStyle = '#6f665a'; c.fillText(t, cx + 13, cy + 20);
      cx += w + 8;
    });

    function hr(yy) {
      c.strokeStyle = 'rgba(90,82,73,.2)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(M, yy); c.lineTo(W - M, yy); c.stroke();
    }
    function section(title, yy) {
      c.fillStyle = '#a2957f'; c.font = '13px ' + SANS;
      spaced(c, title, M, yy, 2);
    }

    hr(cy + 48);
    y = cy + 84;
    section('对 局', y);
    y += 32;
    spec.players.forEach(function (p) {
      if (p.win) {
        c.fillStyle = 'rgba(158,61,50,.055)';
        rrect(c, M - 10, y - 22, W - M * 2 + 20, 40, 2); c.fill();
      }
      c.fillStyle = p.me ? '#9e3d32' : '#2f2a24'; c.font = '21px ' + SERIF;
      c.fillText(p.name + (p.me ? '（你）' : ''), M, y + 4);
      c.textAlign = 'right';
      c.font = '15px ' + SANS; c.fillStyle = '#8a7a68';
      c.fillText('谱中 ' + p.hand + ' 首', W - M - 104, y + 3);
      c.font = '21px ' + SERIF; c.fillStyle = p.win ? '#9e3d32' : '#5a5249';
      c.fillText('声名 ' + p.fame, W - M, y + 3);
      c.textAlign = 'left';
      y += 44;
    });

    y += 22; hr(y); y += 38;
    section(spec.section || '四 条 线', y);
    y += 32;
    spec.rows.forEach(function (r) {
      c.fillStyle = '#5a5249'; c.font = '17px ' + SERIF;
      c.fillText(r.k, M, y + 3);
      c.textAlign = 'right'; c.font = '15px ' + SANS; c.fillStyle = '#6f665a';
      c.fillText(r.v, W - M, y + 2);
      c.textAlign = 'left';
      c.fillStyle = 'rgba(90,82,73,.13)';
      rrect(c, M, y + 11, W - M * 2, 5, 2.5); c.fill();
      c.fillStyle = r.p >= 1 ? '#9e3d32' : 'rgba(158,61,50,.5)';
      rrect(c, M, y + 11, Math.max(4, (W - M * 2) * Math.max(0, Math.min(1, r.p))), 5, 2.5); c.fill();
      y += 40;
    });

    y += 12; hr(y); y += 38;
    section('谱 中', y);
    y += 30;
    var x2 = M;
    c.font = '16px ' + SERIF;
    if (!spec.songs.length) {
      c.fillStyle = '#b3a894'; c.fillText('（空）', M, y);
      y += 34;
    }
    spec.songs.forEach(function (nm) {
      var w = c.measureText('《' + nm + '》').width + 20;
      if (x2 + w > W - M) { x2 = M; y += 36; }
      c.strokeStyle = 'rgba(158,61,50,.24)'; c.lineWidth = 1;
      rrect(c, x2, y - 19, w, 30, 2); c.stroke();
      c.fillStyle = '#7a4038';
      c.fillText('《' + nm + '》', x2 + 10, y + 2);
      x2 += w + 8;
    });
    return y;
  }

  function renderShare(spec) {
    var W = 900;
    var probe = document.createElement('canvas');
    probe.width = W; probe.height = 1400;
    var bottom = paintShare(probe.getContext('2d'), spec, 1400);
    var H = Math.max(940, Math.min(1500, bottom + 132));
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    paintShare(c, spec, H);

    // 页脚
    var SERIF = '"Songti SC","STSong","SimSun","Noto Serif CJK SC",serif';
    var SANS = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif';
    c.fillStyle = '#a2957f'; c.font = '13px ' + SANS;
    var d = new Date();
    c.fillText(d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate() + '　' + spec.note, 84, H - 76);
    c.textAlign = 'right';
    c.fillText('三百首 · 词宗 / 词路', W - 84, H - 76);
    c.textAlign = 'left';
    return cv;
  }

  function showShare(spec) {
    if (!spec) { toast('还没有可分享的对局'); return; }
    var cv = renderShare(spec);
    var url = cv.toDataURL('image/png');
    var img = $('#share-img');
    img.src = url;
    var a = $('#share-dl');
    var d = new Date();
    a.href = url;
    a.download = '三百首_' + spec.mode + '_' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '.png';
    openModal('modal-share');
  }

  App.showShare = showShare;
  App.deckShareSpec = deckShareSpec;
  App.boardShareSpec = boardShareSpec;

  function boot() {
    loadData();
    App.openCard = openCard;
    App.showView = showView;
    App.bindArchive = bindArchive;
    App.renderAll = renderAll;
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
