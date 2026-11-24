#!/usr/bin/env node
// Runs a Let It Cook paper-trading session against live market data and saves its state.
//
//   NODE_USE_ENV_PROXY=1 node scripts/snapshot.js --minutes 30 --out data/snapshot.json
//   node scripts/snapshot.js --minutes 30 --continue data/snapshot.json
//
// --continue picks up an earlier session (open positions are re-priced on the first round).
'use strict';
const fs = require('fs');
const path = require('path');
const engine = require('../engine.js');
const live = require('../live.js');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const minutes = Number(opt('minutes', 30));
const cont = opt('continue', null);
const out = opt('out', cont || 'data/snapshot.json');
const startUsd = Number(opt('start', engine.RULES.sniper.startUsd));

if (!(minutes > 0)) {
  console.error('--minutes must be a positive number');
  process.exit(1);
}

const state = cont && fs.existsSync(cont) ? JSON.parse(fs.readFileSync(cont, 'utf8')) : engine.create(Date.now(), { startUsd });
const save = () => {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const tmp = out + '.tmp';
  fs.writeFileSync(tmp, engine.serialize(state));
  fs.renameSync(tmp, out);
};

const runner = live.createRunner(engine, state);
runner.start();
const began = Date.now();
const report = () => {
  const c = state.counts;
  const eq = engine.equity(state);
  const mins = ((Date.now() - began) / 60000).toFixed(1);
  console.log(
    `${mins}m  equity ${engine.fmt.money(eq)} (${(eq / state.startUsd).toFixed(2)}x)  tokens ${c.signals}  ` +
      `filter ${c.filterKilled}  analyst ${c.analystKilled}  bought ${c.bought}  W/L ${c.wins}/${c.losses}  ` +
      `open ${state.positions.length}  queue ${runner.queueSize()}  ${state.health.ok ? 'ok' : 'ERR ' + state.health.msg}`,
  );
};
const tick = setInterval(() => {
  report();
  save();
}, 60e3);

setTimeout(() => {
  runner.stop();
  clearInterval(tick);
  engine.sample(state, Date.now());
  state.updatedAt = Date.now();
  save();
  report();
  console.log('saved', out);
  process.exit(0);
}, minutes * 60e3);
