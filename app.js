(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Config (URL params): ?start=183&speed=1&minutes=75&seed=42&loop=0
  // ---------------------------------------------------------------------------
  const qs = new URLSearchParams(location.search);
  const numParam = (key, def, min, max) => {
    const v = Number.parseFloat(qs.get(key));
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  };
  const START = numParam('start', 183, 1, 1e9);
  const SPEED = numParam('speed', 1, 0.1, 20);
  const SESSION_SEC = numParam('minutes', 75, 5, 24 * 60) * 60;
  const LOOP = qs.get('loop') !== '0';
  const FIXED_SEED = qs.has('seed') ? Number.parseInt(qs.get('seed'), 10) >>> 0 : null;

  const SOL_PRICE = 68;
  const SIM_PER_REAL = 180 * SPEED;        // 3 simulated minutes per real second
  const CLOCK_START = 19 * 3600 + 40 * 60; // session starts at 19:40:00
  const MAX_OPEN = 3;
  const HOLD_AFTER_END = 4;                // real seconds before a loop restarts
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------------------
  // Seeded RNG so a run can be reproduced with ?seed=
  // ---------------------------------------------------------------------------
  const mulberry32 = (a) => () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let rand = Math.random;
  const R = (a, b) => a + (b - a) * rand();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const expo = (mean) => -Math.log(1 - rand()) * mean;

  // ---------------------------------------------------------------------------
  // Fictional tokens and rules
  // ---------------------------------------------------------------------------
  const TOKENS = [
    'DCTY', 'RUDY', 'HUSH', 'CYBERLEEK', 'PIPI', 'FIONA', 'SCRUMB', 'DINGUS', 'SWAGYU', 'MOOFI',
    'BEANZ', 'BLORP', 'SHONKER', 'CATNOMICS', 'SNUBI', 'GLOOP', 'FROGO', 'RUGGED', 'TOADZ', 'QUOKKA',
    'ZORPO', 'YAPPER', 'RIEMANN', 'SKRT', 'WOBBLE', 'FLOAT', 'GRONK', 'BRRR', 'SPIPI', 'SCATE',
  ];
  const FILTER_REASONS = [
    'Bundled buys', 'LP not locked', 'Dev wallet >5%', 'Liquidity under $25k',
    'Top 10 holders >35%', 'Already +100% 1h', 'Mint authority on', 'Honeypot sim failed',
  ];
  const ANALYST_REASONS = [
    'copycat ticker', 'Wallet sold early', 'fresh wallets only', 'Wallet cluster',
    'Snipers in block 0', 'Socials 2h old',
  ];
  const STOP_REASONS = ['stop where rules said', 'stop where rules said', 'rug · dev dumped', 'LP pulled', 'trailing stop'];
  const TICKER = [
    ['DCTY', 1.93e6, -82.4], ['RUDY', 68.6e3, 1330], ['HUSH', 79.7e3, 1680], ['CYBERLEEK', 1.57e6, 67.49],
    ['PIPI', 121e3, -43.8], ['FIONA', 412e3, 212.6], ['SCRUMB', 33.1e3, -12.7], ['MOOFI', 902e3, 488.1],
    ['FROGO', 54.2e3, 31.2], ['RIEMANN', 2.41e6, 145.3],
  ].map(([s, m, c]) => ({ s, m, m0: m / (1 + c / 100), els: [] }));

  // ---------------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------------
  const MINUS = '−';
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const pad = (n) => String(n).padStart(2, '0');
  const usd = (v, dp = 2) =>
    (v < 0 ? MINUS : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const signedUsd = (v, dp = 2) => (v >= 0 ? '+' : '') + usd(v, dp);
  const int = (v) => Math.floor(v).toLocaleString('en-US');
  const short = (v) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.floor(v)));
  const clock = (t, withSec) => {
    const s = Math.floor(CLOCK_START + t) % 86400;
    const hm = pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60);
    return withSec ? hm + ':' + pad(s % 60) : hm;
  };
  const mcap = (v) => (v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e5 ? '$' + Math.round(v / 1e3) + 'K' : '$' + (v / 1e3).toFixed(1) + 'K');
  const pctChg = (c) => {
    const a = Math.abs(c);
    const body = a >= 1000 ? (a / 1000).toFixed(2) + 'K' : a >= 10 ? a.toFixed(1) : a.toFixed(2);
    return (c >= 0 ? '+' : MINUS) + body + '%';
  };
  const hueOf = (s) => {
    let h = 7;
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 360;
  };
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const avatar = (sym, cls = 'av') => {
    const n = el('span', cls, sym[0]);
    n.style.setProperty('--h', hueOf(sym));
    return n;
  };
  const setText = (node, txt) => {
    if (node._t !== txt) { node.textContent = txt; node._t = txt; }
  };

  // ---------------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------------
  const dom = {
    app: $('app'), ticker: $('ticker'), startAmt: $('startAmt'), balance: $('balance'),
    balWhole: $('balWhole'), balCents: $('balCents'), pnl: $('pnl'), sol: $('sol'), mult: $('mult'),
    best: $('best'), worst: $('worst'), status: $('status'), clock: $('clock'), clockStart: $('clockStart'),
    sigTotal: $('sigTotal'), copiedTotal: $('copiedTotal'), skipped: $('skipped'), log: $('log'), tapeLast: $('tapeLast'),
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
  const sizeCanvas = (c, width, height) => {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    c.w = width;
    c.h = height;
    c.node.width = Math.max(1, Math.round(width * dpr));
    c.node.height = Math.max(1, Math.round(height * dpr));
    c.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) sizeCanvas(canv[e.target.id], e.contentRect.width, e.contentRect.height);
  });
  for (const c of Object.values(canv)) ro.observe(c.node);

  // ---------------------------------------------------------------------------
  // Simulation state
  // ---------------------------------------------------------------------------
  let S;
  let disp = START;       // displayed (tweened) balance
  let nowReal = 0;        // real time in seconds, for purely visual animation
  let paused = false;
  let endedFor = 0;
  let runSeed = 0;

  const equity = () => S.cash + S.positions.reduce((sum, p) => sum + p.value, 0);

  function reset() {
    runSeed = FIXED_SEED ?? (Math.random() * 2 ** 32) >>> 0;
    rand = mulberry32(runSeed);
    S = {
      t: 0,
      cash: START,
      positions: [],
      pending: new Set(),
      queue: [],
      hist: [{ t: 0, v: START }],
      lastSample: 0,
      marks: [],
      closed: [],
      radar: [],
      recentKills: [],
      sig: 0, fKill: 0, aKill: 0,
      copied: 0, wins: 0, losses: 0,
      best: null, worst: null,
      wallets: 480 + Math.floor(rand() * 60),
      nextCopy: R(30, 90),
      nextNoise: R(8, 20),
      nextScout: 0,
      act: {},
      active: 'scout',
      live: null,
      tapeLast: null,
    };
    for (const s of STAGES) S.act[s] = null;
    disp = START;
    endedFor = 0;
    simAcc = 0;
    dom.log.replaceChildren();
    for (const s of STAGES) rows[s].key = '';
    dom.tapeLast._key = '';
    lastAria = -Infinity;
    setText(dom.startAmt, usd(START, START % 1 ? 2 : 0));
    setText(dom.clockStart, clock(0));
  }

  function schedule(at, fn) {
    S.queue.push({ at, fn });
    S.queue.sort((a, b) => a.at - b.at);
  }

  function setActivity(stage, tok, text, strike = false, holdSec = 150) {
    S.act[stage] = { tok, text, strike, until: S.t + holdSec };
  }

  function activityFor(stage) {
    const a = S.act[stage];
    if (a && S.t < a.until) return a;
    switch (stage) {
      case 'scout': return { tok: null, text: `watching ${S.wallets} smart wallets` };
      case 'filter': return { tok: null, text: 'hard rules armed' };
      case 'analyst': return { tok: null, text: 'nothing in review' };
      case 'sniper': {
        const p = S.positions[S.positions.length - 1];
        return p ? { tok: p.tok, text: `holding ${p.sol.toFixed(2)} SOL` } : { tok: null, text: 'waiting · nothing passes' };
      }
      default: return { tok: null, text: 'stops set by rules' };
    }
  }

  function addLog(stage, verb, tok, detail) {
    const li = el('li', 'log-item ' + stage);
    li.append(el('span', 'dot'), el('span', 'tm', clock(S.t, true)), el('span', 'who', verb), el('span', 'tok', '$' + tok));
    li.append(el('span', 'det', '· ' + detail));
    dom.log.prepend(li);
    while (dom.log.children.length > 9) dom.log.lastElementChild.remove();
    if (!reduceMotion && dom.log.animate) {
      dom.log.animate([{ transform: 'translateY(-22px)' }, { transform: 'translateY(0)' }], {
        duration: 280, easing: 'cubic-bezier(.2,.7,.2,1)',
      });
    }
    S.active = stage;
  }

  function radarMark(color) {
    S.radar.push({ ang: rand() * Math.PI * 2, rad: R(0.25, 0.9), born: nowReal, color });
    if (S.radar.length > 16) S.radar.shift();
  }

  function freeToken() {
    const busy = new Set([...S.positions.map((p) => p.tok), ...S.pending, ...S.recentKills]);
    let tok = pick(TOKENS);
    for (let i = 0; i < 20 && busy.has(tok); i++) tok = pick(TOKENS);
    return tok;
  }

  // Wins are right-skewed: mostly modest, sometimes a runner.
  const winReturn = () => (rand() < 0.4 ? R(0.8, 2.2) : R(0.12, 0.6));

  function startCopy() {
    const tok = freeToken();
    S.pending.add(tok);
    addLog('analyst', 'Analyst passed', tok, '6/6 rules');
    setActivity('analyst', tok, '6/6 rules');

    schedule(S.t + R(6, 18), () => {
      S.pending.delete(tok);
      const size = Math.min(S.cash, equity() * R(0.28, 0.38));
      if (size < 0.5) return;
      const win = rand() < 0.68;
      const p = {
        tok, size, value: size, sol: size / SOL_PRICE,
        openT: S.t, closeT: S.t + (win ? R(70, 380) : R(60, 300)),
        win, ret: win ? winReturn() : -R(0.16, 0.5), rug: !win && rand() < 0.35,
        ph1: rand() * 6.28, ph2: rand() * 6.28,
        ang: rand() * Math.PI * 2, rad: R(0.4, 0.78),
      };
      S.cash -= size;
      S.positions.push(p);
      S.copied++;
      S.live = p;
      addLog('sniper', 'Sniper copied', tok, p.sol.toFixed(2) + ' SOL');
      setActivity('sniper', tok, `copying ${p.sol.toFixed(2)} SOL`);
    });
  }

  // Unrealised return path: ends exactly at p.ret when the position closes.
  function positionReturn(p, t) {
    const u = clamp((t - p.openT) / (p.closeT - p.openT), 0, 1);
    let base;
    if (p.win) base = p.ret * u * u * (3 - 2 * u);
    else if (p.rug) base = 0.14 * Math.sin(u * Math.PI) * (1 - u) + p.ret * Math.pow(u, 6);
    else base = p.ret * Math.pow(u, 1.6);
    const env = Math.sin(u * Math.PI);
    return base + env * (0.07 * Math.sin(u * 9 + p.ph1) + 0.03 * Math.sin(u * 23 + p.ph2));
  }

  function closePosition(p) {
    p.value = p.size * (1 + p.ret);
    const pnl = p.value - p.size;
    S.cash += p.value;
    S.positions.splice(S.positions.indexOf(p), 1);

    if (pnl >= 0) {
      S.wins++;
      addLog('sniper', 'Sniper sold', p.tok, signedUsd(pnl) + ' banked');
      setActivity('sniper', p.tok, `sold ${signedUsd(pnl)}`);
    } else {
      S.losses++;
      const reason = p.rug ? 'rug · dev dumped' : pick(STOP_REASONS);
      addLog('guard', 'Guard stop hit', p.tok, usd(pnl) + ' · ' + reason);
      setActivity('guard', p.tok, `${usd(pnl)} stopped`);
      radarMark('#ff7ab8');
    }
    S.best = S.best == null ? pnl : Math.max(S.best, pnl);
    S.worst = pnl < 0 ? (S.worst == null ? pnl : Math.min(S.worst, pnl)) : S.worst;

    const v = equity();
    S.hist.push({ t: S.t, v });
    S.lastSample = S.t;
    S.marks.push({ t: S.t, v, win: pnl >= 0 });
    S.closed.push({ pnl, born: nowReal });
    if (S.closed.length > 60) S.closed.shift();
    S.tapeLast = { tok: p.tok, pnl, kind: pnl >= 0 ? 'banked' : 'stopped' };
    if (S.live === p) S.live = S.positions[S.positions.length - 1] || null;
  }

  function noiseEvent() {
    const tok = freeToken();
    S.recentKills.push(tok);
    if (S.recentKills.length > 8) S.recentKills.shift();
    if (rand() < 0.72) {
      const r = pick(FILTER_REASONS);
      addLog('filter', 'Filter killed', tok, r);
      setActivity('filter', tok, '× ' + r, true, 400);
      radarMark('#ffb84d');
    } else {
      const r = pick(ANALYST_REASONS);
      addLog('analyst', 'Analyst killed', tok, r);
      setActivity('analyst', tok, '× ' + r, true, 400);
      radarMark('#cdb2ff');
    }
  }

  function scoutEvent() {
    S.wallets = clamp(S.wallets + Math.round(R(-3, 5)), 400, 999);
    if (rand() < 0.5) {
      const hex = () => Math.floor(rand() * 0xffff).toString(16).padStart(4, '0');
      setActivity('scout', pick(TOKENS), `0x${hex()}…${hex().slice(0, 2)} bought`, false, 90);
    } else {
      S.act.scout = null;
    }
  }

  function step(dt) {
    S.t += dt;
    const t = S.t;

    // Signal flow: ~2 per simulated second, almost all killed by the filter.
    const n = 2.2 * (0.85 + 0.3 * Math.sin(t / 97)) * dt * (0.7 + 0.6 * rand());
    S.sig += n;
    S.fKill += n * 0.925;
    S.aKill += n * 0.0165;

    if (t >= S.nextCopy) {
      if (S.positions.length + S.pending.size < MAX_OPEN) startCopy();
      S.nextCopy = t + Math.max(35, expo(140));
    }
    if (t >= S.nextNoise) {
      noiseEvent();
      S.nextNoise = t + Math.max(18, expo(60));
    }
    if (t >= S.nextScout) {
      scoutEvent();
      S.nextScout = t + R(40, 140);
    }
    while (S.queue.length && S.queue[0].at <= t) S.queue.shift().fn();

    for (const p of S.positions) p.value = p.size * (1 + positionReturn(p, t));
    for (const p of [...S.positions]) if (t >= p.closeT) closePosition(p);

    if (t - S.lastSample >= 15) {
      S.hist.push({ t, v: equity() });
      S.lastSample = t;
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering: DOM
  // ---------------------------------------------------------------------------
  function renderActivity(stage) {
    const a = activityFor(stage);
    const r = rows[stage];
    const key = `${a.tok}|${a.text}|${a.strike}`;
    if (r.key === key) return;
    r.key = key;
    const parts = [];
    if (a.tok) parts.push(avatar(a.tok), el(a.strike ? 's' : 'span', 'tok', '$' + a.tok));
    parts.push(el('span', 'txt', a.text));
    r.act.replaceChildren(...parts);
  }

  function renderTapeHead() {
    let tok, amount, label;
    if (S.live) {
      tok = S.live.tok; amount = S.live.value - S.live.size; label = 'live';
    } else if (S.tapeLast) {
      ({ tok, pnl: amount, kind: label } = S.tapeLast);
    } else {
      if (dom.tapeLast._key !== 'idle') {
        dom.tapeLast._key = 'idle';
        dom.tapeLast.replaceChildren(el('span', 'muted', S.copied ? 'scanning…' : 'waiting for first copy…'));
      }
      return;
    }
    const key = tok + label;
    if (dom.tapeLast._key !== key) {
      dom.tapeLast._key = key;
      dom.tapeLast._amt = el('span', '');
      dom.tapeLast.replaceChildren(avatar(tok), el('span', 'tok', '$' + tok), dom.tapeLast._amt, el('span', '', label));
    }
    dom.tapeLast._amt.className = amount >= 0 ? 'up' : 'down';
    setText(dom.tapeLast._amt, signedUsd(amount, Math.abs(amount) >= 100 ? 0 : 2));
  }

  function renderDom() {
    const totalCents = Math.round(disp * 100);
    const whole = Math.floor(totalCents / 100);
    const cents = totalCents % 100;
    const wholeTxt = usd(whole, 0);
    setText(dom.balWhole, wholeTxt);
    setText(dom.balCents, '.' + pad(cents));
    dom.balance.style.setProperty('--k', Math.min(1, 6.5 / Math.max(6.5, wholeTxt.length)).toFixed(3));

    const diff = disp - START;
    const pct = Math.round((diff / START) * 100);
    setText(dom.pnl, `${signedUsd(diff)} (${pct < 0 ? MINUS : ''}${Math.abs(pct).toLocaleString('en-US')}%)`);
    dom.pnl.classList.toggle('neg', diff < -0.004);
    setText(dom.sol, `${(disp / SOL_PRICE).toFixed(3)} SOL · SOL $${SOL_PRICE.toFixed(2)}`);
    setText(dom.mult, (disp / START).toFixed(2) + '×');

    dom.best.hidden = S.best == null;
    if (S.best != null) setText(dom.best, signedUsd(S.best, 0));
    dom.worst.hidden = S.worst == null;
    if (S.worst != null) setText(dom.worst, usd(S.worst, 0));

    const closedN = S.wins + S.losses;
    let status = 'watching wallets…';
    if (paused) status = 'paused · Space to resume';
    else if (closedN) status = `${S.copied} copied · ${Math.round((S.wins / closedN) * 100)}% win`;
    else if (S.copied) status = `${S.copied} copied · cooking`;
    setText(dom.status, status);

    setText(dom.clock, clock(S.t));
    setText(dom.sigTotal, int(S.sig) + ' signals');
    setText(dom.copiedTotal, S.copied + ' copied');
    setText(dom.skipped, int(Math.max(0, S.sig - S.copied)) + ' skipped');

    setText(rows.scout.pill, short(S.sig) + ' signals');
    setText(rows.filter.pill, int(S.fKill) + ' killed');
    setText(rows.analyst.pill, int(S.aKill) + ' killed');
    setText(rows.sniper.pill, S.copied + ' copied');
    setText(rows.guard.pill, S.losses + (S.losses === 1 ? ' stop' : ' stops'));

    for (const s of STAGES) {
      renderActivity(s);
      rows[s].li.classList.toggle('active', S.active === s);
    }
    renderTapeHead();
    if (nowReal - lastAria > 2) renderAria();
  }

  // Text alternatives for the two data canvases, refreshed every couple of seconds.
  let lastAria = -Infinity;
  function renderAria() {
    lastAria = nowReal;
    const mins = Math.round(S.t / 60);
    canv.chart.node.setAttribute('aria-label',
      `Balance line chart, ${clock(0)} to ${clock(S.t)} (${mins} min): started at ${usd(START)}, now ${usd(disp)}, ` +
      `${(disp / START).toFixed(2)} times the start. ${S.wins} winning and ${S.losses} losing trades marked.`);
    const shown = S.closed.length;
    canv.bars.node.setAttribute('aria-label', shown
      ? `Closed trades as bars above (win) or below (loss) zero: ${S.wins} wins, ${S.losses} losses. ` +
        `Biggest win ${signedUsd(S.best ?? 0)}${S.worst != null ? `, biggest loss ${usd(S.worst)}` : ''}.`
      : 'Closed trades: none yet');
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

  function drawChart() {
    const { ctx, w, h } = canv.chart;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);

    const pts = S.hist.slice();
    if (S.t > pts[pts.length - 1].t) pts.push({ t: S.t, v: disp });
    else pts[pts.length - 1] = { t: pts[pts.length - 1].t, v: disp };

    let lo = START, hi = START;
    for (const p of pts) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
    const span = Math.max(hi - lo, START * 0.08);
    lo -= span * 0.06;
    hi += span * 0.1;

    const padL = 8, padR = 18, padT = 16, padB = 8;
    const tMax = Math.max(S.t, 1);
    const X = (t) => padL + (t / tMax) * (w - padL - padR);
    const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    for (let i = 1; i <= 3; i++) {
      const y = Math.round(padT + ((h - padT - padB) * i) / 4) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    const yb = Math.round(Y(START)) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, yb); ctx.lineTo(w, yb); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '500 9px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('start ' + usd(START, START % 1 ? 2 : 0), 12, yb + 3);

    const xs = pts.map((p) => X(p.t));
    const ys = pts.map((p) => Y(p.v));
    if (xs.length === 1) { xs.push(w - padR); ys.push(ys[0]); }
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
    if (!reduceMotion) {
      const ph = (nowReal % 1.6) / 1.6;
      ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - ph)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(ex, ey, 7 + 9 * ph, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ex, ey, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ex, ey, 3.6, 0, Math.PI * 2); ctx.fill();
  }

  function drawRadar() {
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

    const a = reduceMotion ? -Math.PI / 3 : (nowReal * 2.2) % TAU;
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

    // Killed tokens show as fading crosses that light up when the sweep passes.
    ctx.lineWidth = 1.4;
    for (const m of S.radar) {
      const life = clamp(1 - (nowReal - m.born) / 6, 0, 1);
      if (!life) continue;
      const behind = (((a - m.ang) % TAU) + TAU) % TAU;
      const glow = 0.35 + 0.65 * Math.exp(-behind * 1.5);
      const x = cx + Math.cos(m.ang) * m.rad * r, y = cy + Math.sin(m.ang) * m.rad * r, s = 2.6;
      ctx.globalAlpha = life * glow;
      ctx.strokeStyle = m.color;
      ctx.beginPath();
      ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.shadowColor = 'rgba(255,200,230,0.9)'; ctx.shadowBlur = 6;
    ctx.strokeStyle = 'rgba(255,230,242,0.95)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2)); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, TAU); ctx.fill();

    const p = S.live;
    if (p) {
      const x = cx + Math.cos(p.ang) * p.rad * r, y = cy + Math.sin(p.ang) * p.rad * r;
      const up = p.value >= p.size;
      const ph = reduceMotion ? 0 : (nowReal % 1.4) / 1.4;
      ctx.strokeStyle = up ? `rgba(94,240,168,${0.7 * (1 - ph)})` : `rgba(255,122,184,${0.7 * (1 - ph)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 9 + 6 * ph, 0, TAU); ctx.stroke();
      const hue = hueOf(p.tok);
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
      ctx.fillText(p.tok[0], x, y + 0.5);
    }
  }

  function drawBars() {
    const { ctx, w, h } = canv.bars;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const bw = 15, gap = 9;
    const maxN = Math.max(1, Math.floor((w + gap) / (bw + gap)));
    const items = S.closed.slice(-(S.live ? maxN - 1 : maxN)).map((c) => ({ ...c }));
    if (S.live) items.push({ pnl: S.live.value - S.live.size, live: true });

    // Linear scale shared by wins and losses; the zero line moves to fit both.
    let maxPos = 0, maxNeg = 0;
    for (const it of items) {
      if (it.pnl >= 0) maxPos = Math.max(maxPos, it.pnl);
      else maxNeg = Math.max(maxNeg, -it.pnl);
    }
    const usable = h - 10;
    const total = maxPos + maxNeg || 1;
    const k = usable / total;
    const base = Math.round(4 + maxPos * k) + 0.5;
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, base); ctx.lineTo(w, base); ctx.stroke();
    ctx.setLineDash([]);
    if (!items.length) return;

    const x0 = w - (items.length * (bw + gap) - gap);

    items.forEach((it, i) => {
      const x = x0 + i * (bw + gap);
      const grow = it.born == null || reduceMotion ? 1 : 1 - Math.pow(1 - clamp((nowReal - it.born) / 0.45, 0, 1), 3);
      const len = Math.max(3, Math.abs(it.pnl) * k) * grow;
      const newest = i === items.length - 1;
      let alpha = newest ? 1 : 0.82;
      if (it.live) alpha = reduceMotion ? 0.8 : 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(nowReal * 5));
      ctx.globalAlpha = alpha;
      if (it.pnl >= 0) {
        const bh = len;
        const g = ctx.createLinearGradient(0, base - bh, 0, base);
        g.addColorStop(0, newest ? '#8dffc6' : '#62f0ad');
        g.addColorStop(1, '#2fcf86');
        ctx.fillStyle = g;
        roundRect(ctx, x, base - 1 - bh, bw, bh, 4);
      } else {
        ctx.fillStyle = '#ff5fa8';
        roundRect(ctx, x, base + 1, bw, len, 4);
      }
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Ticker (cosmetic, not seeded)
  // ---------------------------------------------------------------------------
  function buildTicker() {
    const frag = document.createDocumentFragment();
    for (let copy = 0; copy < 2; copy++) {
      for (const t of TICKER) {
        const item = el('div', 'tk');
        const mc = el('span', 'mc');
        const chg = el('span', 'chg');
        item.append(avatar(t.s, 'av av-lg'), el('span', 'sym', t.s), mc, chg);
        frag.append(item);
        t.els.push({ mc, chg });
      }
    }
    dom.ticker.replaceChildren(frag);
    updateTicker();
  }
  function updateTicker() {
    for (const t of TICKER) {
      const c = (t.m / t.m0 - 1) * 100;
      for (const { mc, chg } of t.els) {
        setText(mc, mcap(t.m));
        setText(chg, pctChg(c));
        chg.className = 'chg ' + (c >= 0 ? 'up' : 'down');
      }
    }
  }
  setInterval(() => {
    if (paused) return;
    for (const t of TICKER) t.m *= 1 + (Math.random() - 0.46) * 0.035;
    updateTicker();
  }, 2200);

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  const SIM_STEP = 3; // simulated seconds per step
  let simAcc = 0;
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    nowReal = now / 1000;

    if (!paused) {
      if (S.t < SESSION_SEC) {
        // Fixed simulation step keeps a seeded run identical at any frame rate.
        simAcc += dt * SIM_PER_REAL;
        while (simAcc >= SIM_STEP && S.t < SESSION_SEC) {
          step(SIM_STEP);
          simAcc -= SIM_STEP;
        }
      } else if (LOOP) {
        endedFor += dt;
        if (endedFor > HOLD_AFTER_END) reset();
      }
    }

    const eq = equity();
    disp += (eq - disp) * (1 - Math.exp(-dt * 9));
    if (Math.abs(eq - disp) < 0.005) disp = eq;

    renderDom();
    drawChart();
    drawRadar();
    drawBars();
    requestAnimationFrame(frame);
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      paused = !paused;
    } else if (e.key === 'r' || e.key === 'R') {
      reset();
    }
  });

  // Small hook for automated checks and recordings.
  window.letItCook = {
    get state() { return S; },
    get seed() { return runSeed; },
    pause: (v = true) => { paused = v; },
    restart: reset,
  };

  buildTicker();
  reset();
  requestAnimationFrame(frame);
})();
