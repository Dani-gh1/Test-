#!/usr/bin/env node
// Builds a single self-contained page (for claude.ai Artifacts) that shows a saved snapshot.
// The artifact viewer blocks network requests, so the page renders the snapshot instead of live data.
//
//   node scripts/build-page.js --snapshot data/snapshot.json --out dist/let-it-cook.html
//
// The output has no <!doctype>/<html>/<head>/<body>: the Artifact publisher wraps it.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const snapPath = path.resolve(opt('snapshot', path.join(root, 'data/snapshot.json')));
const outPath = path.resolve(opt('out', path.join(root, 'dist/let-it-cook.html')));

const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html');
const css = read('styles.css');
const engine = read('engine.js');
const app = read('app.js');

const body = html.match(/<body>\s*([\s\S]*?)\s*<script src=/);
if (!body) throw new Error('could not find the page body in index.html');

const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
delete snap.seen;     // only needed to continue a session
delete snap.symBest;
const snapJson = JSON.stringify(snap).replace(/</g, '\\u003c');

for (const [name, src] of [['styles.css', css], ['engine.js', engine], ['app.js', app]]) {
  if (/<\/(script|style)/i.test(src)) throw new Error(`${name} contains a closing tag that would break inlining`);
}

const overrides = `
/* ---------- Published page: safe areas and side gutter ---------- */
:root { color-scheme: dark; }
html { height: 100%; }
body { min-height: 100%; }
.app {
  min-height: 0;
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
}
.ticker, .chart {
  margin-left: calc(-1 * max(16px, env(safe-area-inset-left, 0px)));
  margin-right: calc(-1 * max(16px, env(safe-area-inset-right, 0px)));
}
.chart-times {
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
}
@media (max-width: 559px) {
  body { background: #8c0e4f; }
  .app {
    margin-top: calc(-1 * env(safe-area-inset-top, 0px));
    padding-top: env(safe-area-inset-top, 0px);
  }
}
`;

const page = `<title>Let It Cook</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="theme-color" content="#d92283">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>
${css}${overrides}</style>
${body[1]}
<script>window.LET_IT_COOK_SNAPSHOT = ${snapJson};</script>
<script>
${engine}</script>
<script>
${app}</script>
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, page);
console.log(`wrote ${path.relative(process.cwd(), outPath)} (${(page.length / 1024).toFixed(1)} KB)`);
