// Live market data for Let It Cook: public DexScreener and GeckoTerminal endpoints
// (both send CORS headers, so this runs in a browser as well as in Node 18+).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LetItCookLive = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DS = 'https://api.dexscreener.com';
  const GT = 'https://api.geckoterminal.com/api/v2';
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const SKIP = new Set([
    SOL_MINT,
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  ]);

  async function getJSON(url, timeoutMs = 12000) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined });
      if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
      return await res.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // Token symbols come from third parties: keep them short and printable.
  const cleanSym = (s) => String(s || '').replace(/[^\p{L}\p{N}._$-]/gu, '').replace(/^\$+/, '').slice(0, 12) || '???';

  function normalize(pair, now) {
    const info = pair.info || {};
    const sym = cleanSym(pair.baseToken && pair.baseToken.symbol);
    return {
      addr: pair.baseToken.address,
      sym,
      symKey: sym.toUpperCase(),
      url: typeof pair.url === 'string' && pair.url.startsWith('https://') ? pair.url : null,
      priceUsd: Number(pair.priceUsd) || 0,
      liqUsd: (pair.liquidity && pair.liquidity.usd) || 0,
      mcap: pair.marketCap || pair.fdv || 0,
      ageMin: pair.pairCreatedAt ? (now - pair.pairCreatedAt) / 60000 : null,
      chM5: (pair.priceChange && pair.priceChange.m5) || 0,
      chH1: (pair.priceChange && pair.priceChange.h1) || 0,
      ch24: (pair.priceChange && pair.priceChange.h24) || 0,
      volH24: (pair.volume && pair.volume.h24) || 0,
      buysH1: (pair.txns && pair.txns.h1 && pair.txns.h1.buys) || 0,
      sellsH1: (pair.txns && pair.txns.h1 && pair.txns.h1.sells) || 0,
      hasSocials: !!((info.websites && info.websites.length) || (info.socials && info.socials.length)),
    };
  }

  // Best (most liquid) Solana pair per token address, up to 30 addresses per call.
  async function tokens(addrs, now = Date.now()) {
    const out = new Map();
    for (let i = 0; i < addrs.length; i += 30) {
      const chunk = addrs.slice(i, i + 30);
      const pairs = await getJSON(`${DS}/tokens/v1/solana/${chunk.join(',')}`);
      for (const p of Array.isArray(pairs) ? pairs : []) {
        if (p.chainId !== 'solana' || !p.baseToken || !chunk.includes(p.baseToken.address)) continue;
        const cur = out.get(p.baseToken.address);
        if (!cur || ((p.liquidity && p.liquidity.usd) || 0) > cur._liq) {
          const t = normalize(p, now);
          Object.defineProperty(t, '_liq', { value: t.liqUsd, enumerable: false });
          out.set(t.addr, t);
        }
      }
    }
    return out;
  }

  async function solPrice() {
    const pairs = await getJSON(`${DS}/tokens/v1/solana/${SOL_MINT}`);
    const usd = (Array.isArray(pairs) ? pairs : []).filter(
      (p) => p.baseToken && p.baseToken.address === SOL_MINT && p.quoteToken && /^(USDC|USDT)$/.test(p.quoteToken.symbol),
    );
    usd.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0));
    return usd.length ? Number(usd[0].priceUsd) : null;
  }

  // New and trending Solana tokens from several public feeds.
  async function discover() {
    const sol = (list) => (Array.isArray(list) ? list : []).filter((x) => x.chainId === 'solana').map((x) => x.tokenAddress);
    const gtBase = (res) =>
      ((res && res.data) || [])
        .map((d) => d.relationships && d.relationships.base_token && d.relationships.base_token.data && d.relationships.base_token.data.id)
        .filter((id) => typeof id === 'string' && id.startsWith('solana_'))
        .map((id) => id.slice(7));
    const calls = await Promise.allSettled([
      getJSON(`${DS}/token-profiles/latest/v1`).then(sol),
      getJSON(`${DS}/token-boosts/latest/v1`).then(sol),
      getJSON(`${DS}/token-boosts/top/v1`).then(sol),
      getJSON(`${GT}/networks/solana/new_pools?page=1`).then(gtBase),
      getJSON(`${GT}/networks/solana/trending_pools?page=1`).then(gtBase),
    ]);
    const ok = calls.filter((c) => c.status === 'fulfilled').map((c) => c.value);
    if (!ok.length) throw calls[0].reason || new Error('no market feed answered');
    const uniq = (arr) => [...new Set(arr.filter((a) => typeof a === 'string' && a.length >= 32 && !SKIP.has(a)))];
    const val = (i) => (calls[i].status === 'fulfilled' ? calls[i].value : []);
    return {
      all: uniq(ok.flat()),
      ticker: uniq([...val(4), ...val(2)]).slice(0, 14),
      failed: calls.length - ok.length,
    };
  }

  // Polls the feeds and drips new tokens into the engine one at a time, so the log reads like a stream.
  function createRunner(engine, state, opts = {}) {
    const now = opts.now || (() => Date.now());
    const onChange = opts.onChange || (() => {});
    const pending = [];
    const ready = [];
    let tickerAddrs = [];
    const timers = [];
    const busy = {};

    const guard = (name, fn) => async () => {
      if (busy[name]) return;
      busy[name] = true;
      try {
        await fn();
        if (!state.health.ok && name !== 'drip') engine.setHealth(state, now(), true);
      } catch (e) {
        engine.setHealth(state, now(), false, String((e && e.message) || e));
      } finally {
        busy[name] = false;
        onChange();
      }
    };

    const doDiscover = guard('discover', async () => {
      const d = await discover();
      const queued = new Set([...pending, ...ready.map((r) => r.addr)]);
      for (const a of d.all) if (!engine.hasSeen(state, a) && !queued.has(a)) pending.push(a);
      if (pending.length > 300) pending.splice(0, pending.length - 300);
      if (d.ticker.length) tickerAddrs = d.ticker;
    });

    const doPrices = guard('prices', async () => {
      const held = state.positions.map((p) => p.addr);
      const fresh = pending.splice(0, Math.max(0, 30 - held.length));
      if (!held.length && !fresh.length) return;
      const t0 = now();
      let map;
      try {
        map = await tokens([...held, ...fresh], t0);
      } catch (e) {
        pending.unshift(...fresh); // try these again next round
        throw e;
      }
      for (const a of held) engine.mark(state, a, map.get(a) || null, t0);
      for (const a of fresh) ready.push(map.get(a) || { addr: a, sym: null, missing: true });
      engine.sample(state, t0);
    });

    const doSol = guard('sol', async () => {
      const p = await solPrice();
      if (p) engine.setSol(state, p);
    });

    const doTicker = guard('ticker', async () => {
      if (!tickerAddrs.length) return;
      const map = await tokens(tickerAddrs);
      const list = [...map.values()].sort((a, b) => b.mcap - a.mcap);
      engine.setTicker(state, list);
    });

    const drip = () => {
      if (!ready.length) {
        engine.sample(state, now());
        return;
      }
      const n = ready.length > 40 ? 3 : ready.length > 15 ? 2 : 1;
      for (let i = 0; i < n && ready.length; i++) {
        const t = ready.shift();
        engine.consider(state, t, now());
      }
      onChange();
    };

    function start() {
      doSol();
      doDiscover().then(() => {
        doPrices();
        doTicker();
      });
      timers.push(setInterval(doDiscover, 60e3));
      timers.push(setInterval(doPrices, 15e3));
      timers.push(setInterval(doSol, 60e3));
      timers.push(setInterval(doTicker, 120e3));
      timers.push(setInterval(drip, 600));
    }
    function stop() {
      while (timers.length) clearInterval(timers.pop());
    }
    const queueSize = () => pending.length + ready.length;
    return { start, stop, queueSize };
  }

  return { discover, tokens, solPrice, createRunner };
});
