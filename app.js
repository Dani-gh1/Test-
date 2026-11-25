(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Mode: a baked-in snapshot (published page) or live data (this repo, opened in a browser)
  // ---------------------------------------------------------------------------
  const E = window.LetItCookEngine;
  const L = window.LetItCookLive || null;
  const SNAP = window.LET_IT_COOK_SNAPSHOT || null;
  const MODE = SNAP ? 'snapshot' : 'live';
  const STORE_KEY = 'let-it-cook:v1';
  const qs = new URLSearchParams(location.search);
  const startParam = Number.parseFloat(qs.get('start'));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ACT_TTL = 25e3;
  const CHART_LABEL_X = 16;
  const { money, signed, short } = E.fmt;
  const MINUS = '−';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const pad = (n) => String(n).padStart(2, '0');
  const int = (v) => Math.floor(v).toLocaleString('en-US');
  const count = (v) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.floor(v)));
  const hm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const hms = (ms) => hm(ms) + ':' + pad(new Date(ms).getSeconds());
  const dayTime = (ms) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const hueOf = (s) => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 360; };
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const avatar = (sym, cls = 'av') => {
    const n = el('span', cls, (sym || '?').slice(0, 1).toUpperCase());
    n.style.setProperty('--h', hueOf(sym || '?'));
    return n;
  };
  const setText = (node, txt) => {
    if (node._t !== txt) { node.textContent = txt; node._t = txt; }
  };
  const tag = (sym) => '$' + String(sym || '?').replace(/^\$+/, '');
  const pctChg = (c) => {
    const a = Math.abs(c);
    const body = a >= 1000 ? (a / 1000).toFixed(2) + 'K' : a >= 10 ? a.toFixed(1) : a.toFixed(2);
    return (c >= 0 ? '+' : MINUS) + body + '%';
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  function freshState() {
    return E.create(Date.now(), { startUsd: startParam > 0 ? startParam : undefined });
  }
  function loadState() {
    if (SNAP) return SNAP;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.v === 1 && Array.isArray(s.hist)) return s;
      }
    } catch (_) { /* storage unavailable: start fresh */ }
    return freshState();
  }
  let S = loadState();
  let runner = null;
  let lastSave = 0;
  const viewNow = () => (MODE === 'live' ? Date.now() : S.updatedAt);

  function save(force) {
    if (MODE !== 'live') return;
    const now = Date.now();
    if (!force && now - lastSave < 5000) return;
    lastSave = now;
    try { localStorage.setItem(STORE_KEY, E.serialize(S)); } catch (_) { /* full or blocked */ }
  }
  function startLive() {
    if (MODE !== 'live' || !L) return;
    runner = L.createRunner(E, S, { onChange: () => save(false) });
    runner.start();
  }
  function newSession() {
    if (MODE !== 'live') return;
    if (runner) runner.stop();
    S = freshState();
    resetView();
    renderStatic();
    save(true);
    startLive();
  }

  // ---------------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------------
  const dom = {
    ticker: $('ticker'), startAmt: $('startAmt'), balance: $('balance'), balWhole: $('balWhole'), balCents: $('balCents'),
    pnl: $('pnl'), sol: $('sol'), mult: $('mult'), best: $('best'), worst: $('worst'), status: $('status'),
    clock: $('clock'), clockStart: $('clockStart'), srcNote: $('srcNote'), sigTotal: $('sigTotal'),
    copiedTotal: $('copiedTotal'), skipped: $('skipped'), log: $('log'), tapeLast: $('tapeLast'),
    rulesList: $('rulesList'), footNote: $('footNote'), newSession: $('newSession'),
  };
  const STAGES = ['scout', 'filter', 'analyst', 'sniper', 'guard'];
  const rows = {};
  for (const s of STAGES) {
    const li = document.querySelector(`.stage[data-stage="${s}"]`);
    rows[s] = { li, act: li.querySelector('.stage-act'), pill: li.querySelector('.pill'), key: '' };
  }

  const canv = {};
  for (const id of ['chart', 'radar', 'bars']) {
    const node = $(id);
    canv[id] = { node, ctx: node.getContext('2d'), w: 0, h: 0 };
  }
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const c = canv[e.target.id];
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      c.w = e.contentRect.width;
      c.h = e.contentRect.height;
      c.node.width = Math.max(1, Math.round(c.w * dpr));
      c.node.height = Math.max(1, Math.round(c.h * dpr));
      c.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  });
  for (const c of Object.values(canv)) ro.observe(c.node);

  let disp = E.equity(S);
  let renderedLogId = 0;
  let tickerKey = null;
  let tickerEls = [];
  let lastAria = -Infinity;

  function resetView() {
    disp = E.equity(S);
    renderedLogId = 0;
    dom.log.replaceChildren();
    for (const s of STAGES) rows[s].key = '';
    dom.tapeLast._key = '';
    tickerKey = null;
    lastAria = -Infinity;
  }

  // ---------------------------------------------------------------------------
  // Static text: mode notes and rules
  // ---------------------------------------------------------------------------
  function renderStatic() {
    const R = E.RULES;
    const rules = [
      ['filter', 'Filter', `Kills tokens with liquidity under ${short(R.filter.minLiquidity)}, market cap under ${short(R.filter.minMcap)} or over ${short(R.filter.maxMcap)}, a pool younger than ${R.filter.minAgeMin} min or older than ${R.filter.maxAgeH} h, more than +${R.filter.maxChangeH1}% in the last hour, 24 h volume under ${short(R.filter.minVolumeH24)}, or liquidity under ${R.filter.minLiqToMcap * 100}% of market cap.`],
      ['analyst', 'Analyst', `Kills tokens with no website or socials, a copycat ticker (same symbol elsewhere with ${R.analyst.copycatFactor}× the market cap), fewer than ${R.analyst.minTradesH1} trades in the last hour, sells outnumbering buys by more than ${Math.round((R.analyst.maxSellBuyH1 - 1) * 100)}%, or a drop of more than ${-R.analyst.minChangeM5}% in 5 min.`],
      ['sniper', 'Sniper', `Paper-buys ${R.sniper.sizePct * 100}% of the balance in each token that passes, at most ${R.sniper.maxOpen} at a time. Every buy and sell pays ${R.sniper.feePct * 100}% plus estimated price impact from pool liquidity.`],
      ['guard', 'Guard', `Sells at ${R.guard.stopPct * 100}%, takes profit at +${R.guard.takePct * 100}%, trails ${R.guard.trailPct * 100}% below the peak once a trade is up ${R.guard.trailArmPct * 100}%, and exits after ${R.guard.maxHoldMin} min.`],
      ['', 'Data', 'Prices, liquidity, market cap, pool age, trades and socials come from the public DexScreener API; new and trending tokens from DexScreener and GeckoTerminal. Open positions are re-priced every 15 seconds.'],
    ];
    dom.rulesList.replaceChildren(...rules.flatMap(([cls, dt, dd]) => [el('dt', cls, dt), el('dd', '', dd)]));

    setText(dom.startAmt, money(S.startUsd, S.startUsd % 1 ? 2 : 0));
    if (MODE === 'snapshot') {
      setText(dom.srcNote, 'paper trading · snapshot');
      const sameDay = new Date(S.startedAt).toDateString() === new Date(S.updatedAt).toDateString();
      setText(dom.footNote, `Snapshot of a paper-trading session on live DexScreener and GeckoTerminal data, ${dayTime(S.startedAt)} to ${sameDay ? hm(S.updatedAt) : dayTime(S.updatedAt)}. No real money or wallets.`);
      dom.newSession.hidden = true;
    } else {
      setText(dom.srcNote, 'paper trading · live data');
      setText(dom.footNote, 'Paper trading on live data from DexScreener and GeckoTerminal. No real money or wallets. The session is kept in this browser.');
      dom.newSession.hidden = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering: DOM
  // ---------------------------------------------------------------------------
  function activityFor(stage) {
    const a = S.act && S.act[stage];
    if (a && (MODE === 'snapshot' || viewNow() - a.at < ACT_TTL)) return a;
    const open = S.positions[S.positions.length - 1];
    switch (stage) {
      case 'scout': return { text: 'scanning DexScreener + GeckoTerminal' };
      case 'filter': return { text: 'hard rules armed' };
      case 'analyst': return { text: 'nothing in review' };
      case 'sniper': return open ? { sym: open.sym, text: `holding ${open.sol != null ? open.sol.toFixed(2) + ' SOL' : money(open.costUsd)}` } : { text: 'waiting · nothing passes' };
      default: return { text: S.positions.length ? `${S.positions.length} stop${S.positions.length === 1 ? '' : 's'} armed` : 'stops set by rules' };
    }
  }

  function renderActivity(stage) {
    const a = activityFor(stage);
    const r = rows[stage];
    const key = `${a.sym}|${a.text}|${a.strike}`;
    if (r.key === key) return;
    r.key = key;
    const parts = [];
    if (a.sym) parts.push(avatar(a.sym), el(a.strike ? 's' : 'span', 'tok', tag(a.sym)));
    parts.push(el('span', 'txt', a.text));
    r.act.replaceChildren(...parts);
  }

  function logItem(e) {
    const li = el('li', 'log-item ' + e.stage);
    li.append(el('span', 'dot'), el('span', 'tm', hms(e.at)), el('span', 'who', e.verb), el('span', 'tok', tag(e.sym)), el('span', 'det', '· ' + e.detail));
    return li;
  }
  function renderLog() {
    const top = S.log[0];
    if (!top) {
      if (renderedLogId) { dom.log.replaceChildren(); renderedLogId = 0; }
      return;
    }
    if (top.id === renderedLogId) return;
    const fresh = S.log.filter((e) => e.id > renderedLogId);
    if (!renderedLogId || top.id < renderedLogId || fresh.length > 9) {
      dom.log.replaceChildren(...S.log.slice(0, 9).map(logItem));
    } else {
      for (let i = fresh.length - 1; i >= 0; i--) dom.log.prepend(logItem(fresh[i]));
      while (dom.log.children.length > 9) dom.log.lastElementChild.remove();
      if (!reduceMotion && dom.log.animate) {
        dom.log.animate([{ transform: `translateY(${-22 * fresh.length}px)` }, { transform: 'translateY(0)' }], {
          duration: 280, easing: 'cubic-bezier(.2,.7,.2,1)',
        });
      }
    }
    renderedLogId = top.id;
  }

  function renderTicker() {
    const list = S.ticker || [];
    const key = list.map((t) => t.sym).join('|');
    if (key !== tickerKey) {
      tickerKey = key;
      tickerEls = [];
      if (!list.length) {
        dom.ticker.replaceChildren(el('div', 'tk tk-empty', MODE === 'live' ? 'loading live market…' : 'no market data in this snapshot'));
        dom.ticker.style.animation = 'none';
      } else {
        const frag = document.createDocumentFragment();
        for (let copy = 0; copy < 2; copy++) {
          for (const t of list) {
            const item = el('div', 'tk');
            const mc = el('span', 'mc');
            const chg = el('span', 'chg');
            item.append(avatar(t.sym, 'av av-lg'), el('span', 'sym', t.sym), mc, chg);
            if (copy) item.setAttribute('aria-hidden', 'true');
            frag.append(item);
            tickerEls.push({ sym: t.sym, mc, chg });
          }
        }
        dom.ticker.replaceChildren(frag);
        dom.ticker.style.animation = '';
      }
    }
    const bySym = new Map(list.map((t) => [t.sym, t]));
    for (const x of tickerEls) {
      const t = bySym.get(x.sym);
      if (!t) continue;
      setText(x.mc, short(t.mcap));
      setText(x.chg, pctChg(t.ch24));
      const cls = 'chg ' + (t.ch24 >= 0 ? 'up' : 'down');
      if (x.chg.className !== cls) x.chg.className = cls;
    }
  }

  function renderTapeHead() {
    const open = S.positions[S.positions.length - 1];
    let sym, amount, label;
    if (open) {
      sym = open.sym; amount = open.qty * open.lastPx - open.costUsd; label = MODE === 'live' ? 'live' : 'open';
    } else if (S.lastClosed) {
      ({ sym, pnl: amount, kind: label } = S.lastClosed);
    } else {
      const idle = S.counts.bought ? 'scanning…' : 'waiting for first buy…';
      if (dom.tapeLast._key !== idle) {
        dom.tapeLast._key = idle;
        dom.tapeLast.replaceChildren(el('span', 'muted', idle));
      }
      return;
    }
    const key = sym + label;
    if (dom.tapeLast._key !== key) {
      dom.tapeLast._key = key;
      dom.tapeLast._amt = el('span', '');
      dom.tapeLast.replaceChildren(avatar(sym), el('span', 'tok', tag(sym)), dom.tapeLast._amt, el('span', '', label));
    }
    dom.tapeLast._amt.className = amount >= 0 ? 'up' : 'down';
    setText(dom.tapeLast._amt, signed(amount, Math.abs(amount) >= 100 ? 0 : 2));
  }

  function renderAria() {
    lastAria = Date.now();
    const c = S.counts;
    canv.chart.node.setAttribute('aria-label',
      `Paper-trading balance from ${hm(S.startedAt)} to ${hm(viewNow())}: started at ${money(S.startUsd)}, now ${money(disp)} ` +
      `(${(disp / S.startUsd).toFixed(2)} times the start). ${c.wins} winning and ${c.losses} losing trades marked.`);
    canv.bars.node.setAttribute('aria-label', S.closed.length
      ? `Closed trades as bars above (win) or below (loss) zero: ${c.wins} wins, ${c.losses} losses. ` +
        `Best ${signed(S.best ?? 0)}${S.worst != null ? `, worst ${money(S.worst)}` : ''}.`
      : 'Closed trades: none yet');
  }

  function renderDom() {
    const c = S.counts;
    const totalCents = Math.round(disp * 100);
    const whole = Math.floor(totalCents / 100);
    const wholeTxt = money(whole, 0);
    setText(dom.balWhole, wholeTxt);
    setText(dom.balCents, '.' + pad(((totalCents % 100) + 100) % 100));
    dom.balance.style.setProperty('--k', Math.min(1, 6.5 / Math.max(6.5, wholeTxt.length)).toFixed(3));

    const diff = disp - S.startUsd;
    const pct = Math.round((diff / S.startUsd) * 100);
    setText(dom.pnl, `${signed(diff)} (${pct < 0 ? MINUS : ''}${Math.abs(pct).toLocaleString('en-US')}%)`);
    dom.pnl.classList.toggle('neg', diff < -0.004);
    setText(dom.sol, S.solUsd ? `${(disp / S.solUsd).toFixed(3)} SOL · SOL $${S.solUsd.toFixed(2)}` : 'SOL price loading…');
    setText(dom.mult, (disp / S.startUsd).toFixed(2) + '×');

    dom.best.hidden = S.best == null;
    if (S.best != null) setText(dom.best, signed(S.best, 0));
    dom.worst.hidden = S.worst == null;
    if (S.worst != null) setText(dom.worst, money(S.worst, 0));

    const closedN = c.wins + c.losses;
    let status;
    if (MODE === 'live' && S.health && !S.health.ok) status = 'data delayed · retrying';
    else if (closedN) status = `${c.bought} bought · ${Math.round((c.wins / closedN) * 100)}% win`;
    else if (c.bought) status = `${c.bought} bought · cooking`;
    else status = MODE === 'live' ? 'scanning live pools…' : 'no trades in snapshot';
    setText(dom.status, status);

    const longRun = viewNow() - S.startedAt > 12 * 3600e3;
    setText(dom.clockStart, longRun ? dayTime(S.startedAt) : hm(S.startedAt));
    setText(dom.clock, longRun ? dayTime(viewNow()) : hm(viewNow()));
    setText(dom.sigTotal, int(c.signals) + ' tokens');
    setText(dom.copiedTotal, c.bought + ' bought');
    setText(dom.skipped, int(Math.max(0, c.signals - c.bought)) + ' skipped');

    setText(rows.scout.pill, count(c.signals) + ' tokens');
    setText(rows.filter.pill, int(c.filterKilled) + ' killed');
    setText(rows.analyst.pill, int(c.analystKilled) + ' killed');
    setText(rows.sniper.pill, c.bought + ' bought');
    setText(rows.guard.pill, c.losses + (c.losses === 1 ? ' stop' : ' stops'));

    for (const s of STAGES) {
      renderActivity(s);
      rows[s].li.classList.toggle('active', S.active === s);
    }
    renderLog();
    renderTicker();
    renderTapeHead();
    if (Date.now() - lastAria > 3000) renderAria();
  }

  // ---------------------------------------------------------------------------
  // Rendering: canvases
  // ---------------------------------------------------------------------------
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawChart(tSec) {
    const { ctx, w, h } = canv.chart;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const t0 = S.startedAt;
    const tNow = Math.max(viewNow(), t0 + 1000);
    const pts = S.hist.filter((p) => p.t <= tNow).map((p) => ({ t: p.t, v: p.v }));
    pts.push({ t: tNow, v: disp });

    const start = S.startUsd;
    let lo = start, hi = start;
    for (const p of pts) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
    const span = Math.max(hi - lo, start * 0.08);
    lo -= span * 0.08;
    hi += span * 0.1;

    const padL = 8, padR = 18, padT = 16, padB = 8;
    const X = (t) => padL + ((t - t0) / (tNow - t0)) * (w - padL - padR);
    const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    for (let i = 1; i <= 3; i++) {
      const y = Math.round(padT + ((h - padT - padB) * i) / 4) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    const yb = Math.round(Y(start)) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, yb); ctx.lineTo(w, yb); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '500 9px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('start ' + money(start, start % 1 ? 2 : 0), CHART_LABEL_X, yb + 3);

    const xs = pts.map((p) => X(p.t));
    const ys = pts.map((p) => Y(p.v));
    const n = xs.length;
    const trace = () => {
      ctx.moveTo(xs[0], ys[0]);
      for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2);
      ctx.lineTo(xs[n - 1], ys[n - 1]);
    };

    const area = ctx.createLinearGradient(0, padT, 0, h);
    area.addColorStop(0, 'rgba(255,255,255,0.32)');
    area.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath(); trace();
    ctx.lineTo(xs[n - 1], h); ctx.lineTo(xs[0], h); ctx.closePath();
    ctx.fillStyle = area; ctx.fill();

    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,0.85)';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 2.6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = '#fff';
    ctx.beginPath(); trace(); ctx.stroke();
    ctx.restore();

    for (const m of S.marks) {
      if (m.t < t0 || m.t > tNow) continue;
      ctx.beginPath();
      ctx.arc(X(m.t), Y(m.v), 3.4, 0, Math.PI * 2);
      ctx.fillStyle = m.win ? '#5ef0a8' : '#3a0a24';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
    }

    const ex = xs[n - 1], ey = ys[n - 1];
    const halo = ctx.createRadialGradient(ex, ey, 0, ex, ey, 16);
    halo.addColorStop(0, 'rgba(255,255,255,0.55)');
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(ex, ey, 16, 0, Math.PI * 2); ctx.fill();
    if (!reduceMotion && MODE === 'live') {
      const ph = (tSec % 1.6) / 1.6;
      ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - ph)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(ex, ey, 7 + 9 * ph, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ex, ey, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ex, ey, 3.6, 0, Math.PI * 2); ctx.fill();
  }

  const STAGE_COLOR = { filter: '#ffb84d', analyst: '#cdb2ff', guard: '#ff7ab8' };
  function drawRadar(tSec) {
    const { ctx, w, h } = canv.radar;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 2;
    const TAU = Math.PI * 2;

    const body = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    body.addColorStop(0, 'rgba(112,20,72,0.95)');
    body.addColorStop(1, 'rgba(38,3,24,0.98)');
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.24)';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    for (const k of [0.33, 0.66]) { ctx.beginPath(); ctx.arc(cx, cy, r * k, 0, TAU); ctx.stroke(); }
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU, len = i % 6 === 0 ? 4.5 : 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - len - 1), cy + Math.sin(a) * (r - len - 1));
      ctx.lineTo(cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1));
      ctx.stroke();
    }

    const a = reduceMotion ? -Math.PI / 3 : (tSec * 2.2) % TAU;
    const trail = 1.1;
    if (ctx.createConicGradient) {
      const cg = ctx.createConicGradient(a - trail, cx, cy);
      cg.addColorStop(0, 'rgba(255,140,200,0)');
      cg.addColorStop(trail / TAU, 'rgba(255,170,215,0.38)');
      cg.addColorStop(Math.min(1, trail / TAU + 0.001), 'rgba(255,140,200,0)');
      ctx.fillStyle = cg;
    } else {
      ctx.fillStyle = 'rgba(255,170,215,0.14)';
    }
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r - 1, a - trail, a); ctx.closePath(); ctx.fill();

    // Killed tokens: crosses that fade with age and light up when the sweep passes.
    ctx.lineWidth = 1.4;
    const marks = S.radar || [];
    marks.forEach((m, i) => {
      const life = MODE === 'live' ? clamp(1 - (Date.now() - m.at) / 8000, 0, 1) : 0.3 + (0.7 * (i + 1)) / marks.length;
      if (!life) return;
      const behind = (((a - m.ang) % TAU) + TAU) % TAU;
      const glow = 0.35 + 0.65 * Math.exp(-behind * 1.5);
      const x = cx + Math.cos(m.ang) * m.rad * r, y = cy + Math.sin(m.ang) * m.rad * r, s = 2.6;
      ctx.globalAlpha = life * glow;
      ctx.strokeStyle = STAGE_COLOR[m.stage] || '#ffb84d';
      ctx.beginPath();
      ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.shadowColor = 'rgba(255,200,230,0.9)'; ctx.shadowBlur = 6;
    ctx.strokeStyle = 'rgba(255,230,242,0.95)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2)); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, TAU); ctx.fill();

    for (const p of S.positions) {
      const x = cx + Math.cos(p.ang) * p.rad * r, y = cy + Math.sin(p.ang) * p.rad * r;
      const up = p.qty * p.lastPx >= p.costUsd;
      const ph = reduceMotion ? 0 : (tSec % 1.4) / 1.4;
      ctx.strokeStyle = up ? `rgba(94,240,168,${0.7 * (1 - ph)})` : `rgba(255,122,184,${0.7 * (1 - ph)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 9 + 6 * ph, 0, TAU); ctx.stroke();
      const hue = hueOf(p.sym || '?');
      const g = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, 9);
      g.addColorStop(0, `hsl(${hue} 95% 72%)`);
      g.addColorStop(1, `hsl(${hue} 72% 36%)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 8.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = up ? '#5ef0a8' : '#ff7ab8'; ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '800 8px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((p.sym || '?').slice(0, 1).toUpperCase(), x, y + 0.5);
    }
  }

  function drawBars(tSec) {
    const { ctx, w, h } = canv.bars;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const bw = 15, gap = 9;
    const maxN = Math.max(1, Math.floor((w + gap) / (bw + gap)));
    const open = S.positions[S.positions.length - 1];
    const items = S.closed.slice(-(open ? maxN - 1 : maxN)).map((c) => ({ pnl: c.pnl, at: c.at }));
    if (open) items.push({ pnl: open.qty * open.lastPx - open.costUsd, live: true });

    // Linear scale shared by wins and losses; the zero line moves to fit both.
    let maxPos = 0, maxNeg = 0;
    for (const it of items) {
      if (it.pnl >= 0) maxPos = Math.max(maxPos, it.pnl);
      else maxNeg = Math.max(maxNeg, -it.pnl);
    }
    const k = (h - 10) / (maxPos + maxNeg || 1);
    const base = (items.length ? Math.round(4 + maxPos * k) : Math.round(h * 0.66)) + 0.5;
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, base); ctx.lineTo(w, base); ctx.stroke();
    ctx.setLineDash([]);
    if (!items.length) return;

    const x0 = w - (items.length * (bw + gap) - gap);
    items.forEach((it, i) => {
      const x = x0 + i * (bw + gap);
      const age = it.at != null && MODE === 'live' && !reduceMotion ? (Date.now() - it.at) / 450 : 1;
      const grow = 1 - Math.pow(1 - clamp(age, 0, 1), 3);
      const len = Math.max(3, Math.abs(it.pnl) * k) * grow;
      const newest = i === items.length - 1;
      ctx.globalAlpha = it.live ? (reduceMotion ? 0.8 : 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(tSec * 5))) : newest ? 1 : 0.82;
      if (it.pnl >= 0) {
        const g = ctx.createLinearGradient(0, base - len, 0, base);
        g.addColorStop(0, newest ? '#8dffc6' : '#62f0ad');
        g.addColorStop(1, '#2fcf86');
        ctx.fillStyle = g;
        roundRect(ctx, x, base - 1 - len, bw, len, 4);
      } else {
        ctx.fillStyle = '#ff5fa8';
        roundRect(ctx, x, base + 1, bw, len, 4);
      }
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  let last = performance.now();
  function frame(nowMs) {
    const dt = Math.min(0.1, (nowMs - last) / 1000);
    last = nowMs;
    const eq = E.equity(S);
    disp += (eq - disp) * (1 - Math.exp(-dt * 6));
    if (Math.abs(eq - disp) < 0.005) disp = eq;
    const tSec = nowMs / 1000;
    renderDom();
    drawChart(tSec);
    drawRadar(tSec);
    drawBars(tSec);
    requestAnimationFrame(frame);
  }

  dom.newSession.addEventListener('click', newSession);
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !e.altKey && e.target === document.body) newSession();
  });
  window.addEventListener('pagehide', () => save(true));

  window.letItCook = { get state() { return S; }, mode: MODE, newSession };

  renderStatic();
  resetView();
  startLive();
  requestAnimationFrame(frame);
})();
