#!/usr/bin/env node
// Maintainer tool: render public/og.png (1200×630 social preview) with a headless Chromium.
//   CHROMIUM_PATH=/usr/bin/chromium node scripts/gen-og.mjs
// The image only contains the product name, tagline and factual status (no app UI is drawn).
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const icon = await readFile(path.join(ROOT, 'public', 'favicon.svg'), 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;width:1200px;height:630px;font-family:system-ui,"Noto Sans CJK SC",sans-serif;color:#e9edf8;
background:radial-gradient(700px 500px at 10% 0%,rgba(88,110,255,.45),transparent 60%),radial-gradient(700px 500px at 100% 20%,rgba(160,96,255,.38),transparent 62%),linear-gradient(180deg,#070a14,#0b1022);}
.card{position:absolute;inset:60px;border-radius:36px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);padding:64px 72px;box-sizing:border-box}
.icon{width:96px;height:96px}.t{font-size:84px;font-weight:800;margin:28px 0 8px;letter-spacing:.5px}
.s{font-size:34px;color:#c8d0ea;margin:0 0 30px}.c{font-size:24px;color:#aab4cc}
</style></head><body><div class="card"><div class="icon">${icon}</div><div class="t">WQ's Proxy VPN</div>
<p class="s">Android proxy / VPN client · Flutter + sing-box</p><p class="c">Open source · GPL-3.0-or-later · arm64-v8a · debug-signed</p></div></body></html>`;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
await p.setContent(html);
await p.screenshot({ path: path.join(ROOT, 'public', 'og.png') });
await b.close();
console.log('wrote public/og.png');
