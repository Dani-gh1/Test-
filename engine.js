// Let It Cook paper-trading engine.
// Pure logic on plain JSON state, shared by the browser page and the Node snapshot script.
// It never trades real money: buys and sells are bookkeeping against live market prices.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LetItCookEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RULES = {
    filter: {
      minLiquidity: 25000,   // USD in the pool
      minMcap: 50000,
      maxMcap: 50e6,
      minAgeMin: 5,          // pool must have traded a few minutes
      maxAgeH: 72,           // memecoins only: skip pools older than three days
      maxChangeH1: 100,      // don't chase a token already up >100% this hour
      minVolumeH24: 50000,
      minLiqToMcap: 0.03,    // liquidity at least 3% of market cap
    },
    analyst: {
      requireSocials: true,
      copycatFactor: 2,      // same ticker with 2x the market cap elsewhere
      minTradesH1: 150,
      maxSellBuyH1: 1.3,     // sells may not outnumber buys by more than 30%
      minChangeM5: -10,      // not while it is dumping right now
    },
    sniper: {
      startUsd: 183,
      sizePct: 0.25,         // of equity per buy
      maxOpen: 3,
      feePct: 0.01,          // per side, on top of estimated price impact
    },
    guard: {
      stopPct: -0.25,
      takePct: 1.5,
      trailArmPct: 0.3,      // trailing stop arms at +30%...
      trailPct: 0.15,        // ...and sells 15% below the peak
      maxHoldMin: 30,
    },
  };
  const ANALYST_CHECKS = 5;
  const LOG_MAX = 40;
  const SEEN_MAX = 40000;
  const HIST_MAX = 1500;
  const SAMPLE_MS = 30e3;

  const MINUS = '−';
  const money = (v, dp = 2) =>
    (v < 0 ? MINUS : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const signed = (v, dp = 2) => (v >= 0 ? '+' : '') + money(v, dp);
  const short = (v) => {
    const a = Math.abs(v);
    const trim = (x) => x.replace(/\.0+$/, '');
    const s = a >= 1e9 ? trim((a / 1e9).toFixed(2)) + 'B' : a >= 1e6 ? trim((a / 1e6).toFixed(2)) + 'M' : a >= 1e3 ? trim((a / 1e3).toFixed(1)) + 'k' : a.toFixed(0);
    return (v < 0 ? MINUS : '') + '$' + s;
  };
  const pct = (v, dp = 0) => (v >= 0 ? '+' : MINUS) + Math.abs(v * 100).toFixed(dp) + '%';
  const price = (v) => {
    if (!(v > 0)) return '$0';
    if (v >= 1) return '$' + v.toFixed(4);
    const digits = Math.max(2, -Math.floor(Math.log10(v)) + 3);
    return '$' + v.toFixed(Math.min(12, digits));
  };
  const hash = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return h;
  };

  function create(now, opts = {}) {
    const startUsd = opts.startUsd || RULES.sniper.startUsd;
    return {
      v: 1,
      startedAt: now,
      updatedAt: now,
      startUsd,
      cash: startUsd,
      solUsd: null,
      positions: [],
      closed: [],
      hist: [{ t: now, v: startUsd }],
      marks: [],
      seen: [],
      symBest: {},
      counts: { signals: 0, filterKilled: 0, analystKilled: 0, passed: 0, bought: 0, wins: 0, losses: 0, skipped: 0 },
      best: null,
      worst: null,
      log: [],
      logSeq: 0,
      act: {},
      active: 'scout',
      ticker: [],
      radar: [],
      lastClosed: null,
      health: { ok: true, at: now, msg: '' },
      source: 'DexScreener + GeckoTerminal',
    };
  }

  const equity = (s) => s.cash + s.positions.reduce((a, p) => a + p.qty * p.lastPx, 0);
  const impact = (usd, liq) => (liq > 0 ? Math.min(0.5, usd / (liq / 2)) : 0.5);

  function addLog(s, now, stage, verb, sym, detail) {
    s.log.unshift({ id: ++s.logSeq, at: now, stage, verb, sym, detail });
    if (s.log.length > LOG_MAX) s.log.length = LOG_MAX;
    s.active = stage;
    s.updatedAt = now;
  }
  function setAct(s, now, stage, sym, text, strike = false) {
    s.act[stage] = { sym, text, strike, at: now };
  }
  function radar(s, now, stage, addr) {
    const h = hash(addr || String(now));
    s.radar.push({ ang: ((h % 3600) / 3600) * Math.PI * 2, rad: 0.25 + ((h >>> 12) % 65) / 100, at: now, stage });
    if (s.radar.length > 16) s.radar.shift();
  }

  // Seen tokens are kept as 12-character address prefixes so a day-long session stays small.
  const seenKey = (addr) => String(addr).slice(0, 12);
  function hasSeen(s, addr) {
    if (!s._seenSet || s._seenSet.size !== s.seen.length) {
      s.seen = [...new Set(s.seen.map(seenKey))];
      s._seenSet = new Set(s.seen);
    }
    return s._seenSet.has(seenKey(addr));
  }
  function markSeen(s, addr) {
    hasSeen(s, addr);
    const k = seenKey(addr);
    s.seen.push(k);
    s._seenSet.add(k);
    if (s.seen.length > SEEN_MAX) {
      const drop = s.seen.splice(0, s.seen.length - SEEN_MAX);
      for (const a of drop) s._seenSet.delete(a);
    }
  }
  function noteSymbol(s, t) {
    const cur = s.symBest[t.symKey];
    if (!cur || t.mcap > cur.mcap) s.symBest[t.symKey] = { addr: t.addr, mcap: t.mcap };
    const keys = Object.keys(s.symBest);
    if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete s.symBest[k];
  }

  function filterReason(t) {
    const F = RULES.filter;
    if (!t || t.missing || !(t.priceUsd > 0)) return 'No priced DEX pool';
    if (!(t.liqUsd > 0)) return 'No pool liquidity yet';
    if (t.liqUsd < F.minLiquidity) return `Liquidity ${short(t.liqUsd)} < ${short(F.minLiquidity)}`;
    if (t.mcap < F.minMcap) return `Mcap ${short(t.mcap)} < ${short(F.minMcap)}`;
    if (t.mcap > F.maxMcap) return `Mcap ${short(t.mcap)} > ${short(F.maxMcap)}`;
    if (t.ageMin != null && t.ageMin < F.minAgeMin) return `Pool ${Math.max(0, Math.round(t.ageMin))}m old`;
    if (t.ageMin != null && t.ageMin > F.maxAgeH * 60) return `Pool ${Math.round(t.ageMin / 60)}h old`;
    if (t.chH1 > F.maxChangeH1) return `Already ${pct(t.chH1 / 100)} 1h`;
    if (t.volH24 < F.minVolumeH24) return `Volume ${short(t.volH24)} 24h`;
    if (t.mcap > 0 && t.liqUsd / t.mcap < F.minLiqToMcap) return `Liquidity ${((t.liqUsd / t.mcap) * 100).toFixed(1)}% of mcap`;
    return null;
  }

  function analystReason(s, t) {
    const A = RULES.analyst;
    if (A.requireSocials && !t.hasSocials) return 'No website or socials';
    const best = s.symBest[t.symKey];
    if (best && best.addr !== t.addr && best.mcap > t.mcap * A.copycatFactor) return `copycat ticker (original ${short(best.mcap)})`;
    const trades = t.buysH1 + t.sellsH1;
    if (trades < A.minTradesH1) return `Only ${trades} trades 1h`;
    if (t.buysH1 > 0 && t.sellsH1 / t.buysH1 > A.maxSellBuyH1) return `Sellers in control ${t.sellsH1}/${t.buysH1}`;
    if (t.chM5 < A.minChangeM5) return `Dumping ${pct(t.chM5 / 100)} 5m`;
    return null;
  }

  // Evaluate one newly discovered token. Returns the stage that decided it.
  function consider(s, t, now) {
    if (!t || !t.addr || hasSeen(s, t.addr)) return null;
    markSeen(s, t.addr);
    s.counts.signals++;
    const sym = t.sym || (t.addr.slice(0, 4) + '…' + t.addr.slice(-4));
    if (!t.missing) {
      noteSymbol(s, t);
      setAct(s, now, 'scout', sym, `${short(t.mcap)} mcap`);
    }

    const f = filterReason(t);
    if (f) {
      s.counts.filterKilled++;
      addLog(s, now, 'filter', 'Filter killed', sym, f);
      setAct(s, now, 'filter', sym, '× ' + f, true);
      radar(s, now, 'filter', t.addr);
      return 'filter';
    }
    const a = analystReason(s, t);
    if (a) {
      s.counts.analystKilled++;
      addLog(s, now, 'analyst', 'Analyst killed', sym, a);
      setAct(s, now, 'analyst', sym, '× ' + a, true);
      radar(s, now, 'analyst', t.addr);
      return 'analyst';
    }

    s.counts.passed++;
    addLog(s, now, 'analyst', 'Analyst passed', sym, `${ANALYST_CHECKS}/${ANALYST_CHECKS} checks`);
    setAct(s, now, 'analyst', sym, `${ANALYST_CHECKS}/${ANALYST_CHECKS} checks`);
    if (s.positions.length >= RULES.sniper.maxOpen) {
      s.counts.skipped++;
      addLog(s, now, 'sniper', 'Sniper skipped', sym, `${RULES.sniper.maxOpen} positions open`);
      return 'full';
    }
    return buy(s, t, now) ? 'bought' : 'full';
  }

  function buy(s, t, now) {
    const S = RULES.sniper;
    const size = Math.min(s.cash, equity(s) * S.sizePct);
    if (size < 1) {
      s.counts.skipped++;
      addLog(s, now, 'sniper', 'Sniper skipped', t.sym, 'no cash left');
      return false;
    }
    const entryPx = t.priceUsd * (1 + S.feePct + impact(size, t.liqUsd));
    const h = hash(t.addr);
    const p = {
      addr: t.addr, sym: t.sym, url: t.url || null,
      qty: size / entryPx, costUsd: size, entryPx,
      lastPx: t.priceUsd, peakPx: t.priceUsd, liqUsd: t.liqUsd,
      openedAt: now, lastSeen: now,
      sol: s.solUsd ? size / s.solUsd : null,
      ang: ((h % 3600) / 3600) * Math.PI * 2, rad: 0.4 + ((h >>> 12) % 38) / 100,
    };
    s.cash -= size;
    s.positions.push(p);
    s.counts.bought++;
    const amount = p.sol != null ? `${p.sol.toFixed(2)} SOL` : money(size);
    addLog(s, now, 'sniper', 'Sniper bought', t.sym, `${amount} @ ${price(t.priceUsd)}`);
    setAct(s, now, 'sniper', t.sym, `bought ${amount}`);
    return true;
  }

  // Update an open position with a fresh market snapshot (or null when the token had no data).
  function mark(s, addr, t, now) {
    const p = s.positions.find((x) => x.addr === addr);
    if (!p) return;
    const G = RULES.guard;
    let reason = null;
    if (!t || t.missing || !(t.priceUsd > 0)) {
      if (now - p.lastSeen > 3 * 60e3) reason = 'no price for 3m';
    } else {
      p.lastPx = t.priceUsd;
      p.liqUsd = t.liqUsd;
      p.lastSeen = now;
      if (t.priceUsd > p.peakPx) p.peakPx = t.priceUsd;
      const ret = p.lastPx / p.entryPx - 1;
      const peakRet = p.peakPx / p.entryPx - 1;
      if (t.liqUsd < 1000) reason = 'liquidity pulled';
      else if (ret <= G.stopPct) reason = `stop ${pct(G.stopPct)}`;
      else if (ret >= G.takePct) reason = `take profit ${pct(G.takePct)}`;
      else if (peakRet >= G.trailArmPct && p.lastPx <= p.peakPx * (1 - G.trailPct)) reason = `trailing stop, peak ${pct(peakRet)}`;
    }
    if (!reason && now - p.openedAt >= G.maxHoldMin * 60e3) reason = `time stop ${G.maxHoldMin}m`;
    if (reason) close(s, p, now, reason);
  }

  function close(s, p, now, reason) {
    const gross = p.qty * p.lastPx;
    const proceeds = gross * (1 - RULES.sniper.feePct - impact(gross, p.liqUsd));
    const pnl = proceeds - p.costUsd;
    s.cash += proceeds;
    s.positions.splice(s.positions.indexOf(p), 1);
    if (pnl >= 0) {
      s.counts.wins++;
      addLog(s, now, 'sniper', 'Sniper sold', p.sym, `${signed(pnl)} banked · ${reason}`);
      setAct(s, now, 'sniper', p.sym, `sold ${signed(pnl)}`);
    } else {
      s.counts.losses++;
      addLog(s, now, 'guard', 'Guard stop hit', p.sym, `${money(pnl)} · ${reason}`);
      setAct(s, now, 'guard', p.sym, `${money(pnl)} · ${reason}`);
      radar(s, now, 'guard', p.addr);
    }
    s.best = s.best == null ? pnl : Math.max(s.best, pnl);
    if (pnl < 0) s.worst = s.worst == null ? pnl : Math.min(s.worst, pnl);
    const v = equity(s);
    s.hist.push({ t: now, v });
    s.marks.push({ t: now, v, win: pnl >= 0 });
    if (s.marks.length > 400) s.marks.shift();
    s.closed.push({ sym: p.sym, pnl, at: now });
    if (s.closed.length > 500) s.closed.shift();
    s.lastClosed = { sym: p.sym, pnl, kind: pnl >= 0 ? 'banked' : 'stopped' };
  }

  function sample(s, now) {
    const last = s.hist[s.hist.length - 1];
    if (now - last.t >= SAMPLE_MS) s.hist.push({ t: now, v: equity(s) });
    if (s.hist.length > HIST_MAX) s.hist = s.hist.filter((_, i) => i === 0 || i % 2 === 1 || i === s.hist.length - 1);
    s.updatedAt = Math.max(s.updatedAt, now);
  }

  function setTicker(s, list) {
    s.ticker = list.slice(0, 12).map((t) => ({ sym: t.sym, mcap: t.mcap, ch24: t.ch24 }));
  }
  function setSol(s, usd) {
    if (usd > 0) s.solUsd = usd;
  }
  function setHealth(s, now, ok, msg = '') {
    s.health = { ok, at: now, msg };
  }

  // Remove runtime-only fields before saving.
  function serialize(s) {
    return JSON.stringify(s, (k, v) => (k.startsWith('_') ? undefined : v));
  }

  return {
    RULES, ANALYST_CHECKS, create, equity, consider, mark, sample, setTicker, setSol, setHealth,
    hasSeen, serialize, fmt: { money, signed, short, pct, price },
  };
});
