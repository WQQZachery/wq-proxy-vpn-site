#!/usr/bin/env node
// Interleaved A/B frame-render cost (headless-emulated, NOT a real device).
//   CHROMIUM_PATH=... ROUTES=/ ROUNDS=3 node scripts/perf-ab.mjs labelA=distA labelB=distB [...] [--out f.json]
// One browser (ANGLE/SwiftShader GPU), one 360×800 DPR 3 touch context per variant. After a warm-up pass of
// every variant (shader compilation, image decode), it alternates variants for ROUNDS passes; each pass scrolls
// the page in 400 px steps and forces a frame per step with Page.captureScreenshot, timing each round trip
// (= compositor + GPU drawing the frame, incl. every backdrop-filter in view). Alternating inside one process
// cancels most of the VM noise that separate runs show. Reports median / p90 / mean ms per frame.
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
const oi = argv.indexOf('--out');
const OUT = oi >= 0 ? argv.splice(oi, 2)[1] : null;
const VARIANTS = argv.map((a) => { const [label, dir] = a.split('='); return { label, dir: path.resolve(dir) }; });
const ROUTES = (process.env.ROUTES || '/').split(',');
const ROUNDS = Number(process.env.ROUNDS || 3);
const MAXY = Number(process.env.MAXY || 6000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' };

async function serve(dir) {
  const s = http.createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    for (const c of p.endsWith('/') ? [p + 'index.html'] : [p, p + '.html']) {
      try { const f = path.join(dir, c); if ((await stat(f)).isFile()) { res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(await readFile(f)); return; } } catch {}
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { s, base: `http://127.0.0.1:${s.address().port}` };
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-gpu'] });
for (const v of VARIANTS) {
  v.srv = await serve(v.dir);
  v.ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'zh-CN',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36' });
}
const stats = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1); return { n: s.length, median: q(0.5), p90: q(0.9), mean: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(1) }; };
const report = [];
for (const route of ROUTES) {
  const pages = [];
  for (const v of VARIANTS) {
    const page = await v.ctx.newPage(); const cdp = await v.ctx.newCDPSession(page);
    await page.goto(v.srv.base + route, { waitUntil: 'load' }); await page.waitForTimeout(600);
    const info = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, bf: [...document.querySelectorAll('*')].filter((e) => { const c = getComputedStyle(e); return c.backdropFilter && c.backdropFilter !== 'none'; }).length, lens: document.querySelectorAll('.lens').length }));
    pages.push({ v, page, cdp, info, frames: [] });
  }
  const pass = async (P, record) => {
    const maxY = Math.min(P.info.h - 800, MAXY);
    for (let y = 0; y <= maxY; y += 400) {
      await P.page.evaluate((y) => window.scrollTo(0, y), y);
      const t = performance.now();
      await P.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 10, clip: { x: 0, y, width: 360, height: 800, scale: 0.25 } });
      if (record) P.frames.push(performance.now() - t);
    }
    P.info.lensMax = Math.max(P.info.lensMax || 0, await P.page.evaluate(() => document.querySelectorAll('.lens').length));
  };
  for (const P of pages) await pass(P, false); // warm-up
  for (let r = 0; r < ROUNDS; r++) for (const P of (r % 2 ? [...pages].reverse() : pages)) await pass(P, true);
  for (const P of pages) {
    const row = { route, variant: P.v.label, pageHeight: P.info.h, backdropFilterEls: P.info.bf, lensElsSeen: P.info.lensMax, frameMs: stats(P.frames) };
    report.push(row); console.log(JSON.stringify(row));
    await P.page.close();
  }
}
await browser.close();
for (const v of VARIANTS) v.srv.s.close();
if (OUT) await writeFile(OUT, JSON.stringify({ env: 'headless Chromium 156 (Debian arm64), ANGLE/SwiftShader software GPU, 2 vCPU VM, 360x800 DPR3 touch emulation, Android UA', rounds: ROUNDS, report }, null, 2));
