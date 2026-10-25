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
body{margin:0;width:1200px;height:630px;overflow:hidden;font-family:-apple-system,"SF Pro Display","PingFang SC","Noto Sans CJK SC",system-ui,sans-serif;color:#f5f5f7;background:#000;position:relative}
.f{position:absolute;inset:0;background:radial-gradient(620px 460px at 6% -4%,rgba(118,185,0,.32),transparent 70%),radial-gradient(560px 440px at 100% 10%,rgba(96,165,250,.18),transparent 70%)}
.d{position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.12) 1px,transparent 1.4px);background-size:22px 22px;-webkit-mask:radial-gradient(ellipse 85% 70% at 40% 20%,#000 20%,transparent 75%)}
.card{position:absolute;inset:60px;border-radius:40px;background:rgba(255,255,255,.045);padding:60px 72px;box-sizing:border-box;
box-shadow:inset 1.5px 1.5px 1px -1px rgba(255,255,255,.45),inset -1px -1px 1px -.5px rgba(255,255,255,.18),inset 0 0 12px rgba(255,255,255,.04),inset 0 0 0 1px rgba(255,255,255,.06),0 8px 28px -8px rgba(0,0,0,.5)}
.icon{width:96px;height:96px}.t{font-size:88px;font-weight:700;margin:26px 0 6px;letter-spacing:-2.5px}
.k{display:flex;align-items:center;gap:12px;font-size:22px;font-weight:600;letter-spacing:1.5px;color:#9ad13b;margin:0 0 14px}
.k i{width:10px;height:10px;border-radius:50%;background:#76b900;box-shadow:0 0 14px #76b900}
.s{font-size:34px;color:#e5e5ea;margin:0 0 26px}.c{font-size:24px;color:#a1a1a6;margin:0}
</style></head><body><div class="f"></div><div class="d"></div><div class="card"><div class="icon">${icon}</div><div class="t">WQ's Proxy VPN</div>
<p class="k"><i></i>OPEN SOURCE · ANDROID</p><p class="s">Android proxy / VPN client · Flutter + sing-box</p><p class="c">GPL-3.0-or-later · arm64-v8a · debug-signed</p></div></body></html>`;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
await p.setContent(html);
await p.screenshot({ path: path.join(ROOT, 'public', 'og.png') });
await b.close();
console.log('wrote public/og.png');
