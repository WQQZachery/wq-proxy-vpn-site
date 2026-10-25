#!/usr/bin/env node
// Visual-style checks for the main-site-aligned theme (run while wrangler dev serves dist/):
//   CHROMIUM_PATH=/usr/bin/chromium scripts/with-dev-server.sh node scripts/style-checks.mjs
// 1. WCAG contrast of the theme's text/background pairs, computed from the tokens, incl. a worst-case
//    glass background (white 4.5 % glass over the brightest green glow of the ambient field).
// 2. "No backdrop-filter" fallback: serves the stylesheet with every @supports(backdrop-filter) block removed,
//    then checks cards/header are opaque solid panels and runs axe color-contrast on them.
// 3. Focus ring, current-nav indicator, reduced-motion transitions, open mobile menu screenshot.
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'screenshots');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const AXE = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
await mkdir(OUT, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fails++; };

// ---- 1. contrast from tokens ----
const hex = (h) => h.replace('#', '').match(/../g).map((x) => parseInt(x, 16));
const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const black = [0, 0, 0];
const glow = over(hex('#76b900'), 0.2, black);              // brightest spot of the ambient field
const glassWorst = over([255, 255, 255], 0.045, glow);      // card glass over it
const solid = hex('#141418');                                // fallback panel
const amberCard = over(hex('#fbbf24'), 0.07, glassWorst);
const pairs = [
  ['body text #f5f5f7', hex('#f5f5f7'), [['#000', black], ['glass worst', glassWorst], ['solid #141418', solid]], 4.5],
  ['muted #a1a1a6', hex('#a1a1a6'), [['#000', black], ['glass worst', glassWorst], ['solid #141418', solid]], 4.5],
  ['tertiary #9a9aa0', hex('#9a9aa0'), [['#000', black], ['glass worst', glassWorst], ['solid #141418', solid]], 4.5],
  ['brand green #76b900 (large/dots)', hex('#76b900'), [['#000', black], ['glass worst', glassWorst]], 3],
  ['link green #9ad13b', hex('#9ad13b'), [['#000', black], ['glass worst', glassWorst], ['solid #141418', solid]], 4.5],
  ['#000 on green button', black, [['#76b900', hex('#76b900')], ['#8fd400 hover', hex('#8fd400')]], 4.5],
  ['amber #fbbf24', hex('#fbbf24'), [['#000', black], ['amber notice', amberCard]], 4.5],
  ['focus ring #60a5fa (non-text 3:1)', hex('#60a5fa'), [['#000', black], ['glass worst', glassWorst]], 3],
];
console.log('contrast (WCAG 2.x):');
for (const [name, fg, bgs, min] of pairs) for (const [bn, bg] of bgs) {
  const r = ratio(fg, bg); ok(r >= min, `${name} on ${bn}: ${r.toFixed(2)}:1 (min ${min})`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });

// ---- 2. fallback without backdrop-filter ----
console.log('fallback (stylesheet served without @supports(backdrop-filter) blocks):');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true, reducedMotion: 'reduce' });
  // Serve the stylesheet with every @supports (backdrop-filter) block cut out, so the page renders
  // exactly as in a browser without backdrop-filter support (no CSSOM edits, no transitions involved).
  const stripped = { count: 0 };
  await ctx.route(/\/assets\/site\.[0-9a-f]+\.css$/, async (route) => {
    const res = await route.fetch();
    let css = await res.text(); let n = 0;
    for (;;) {
      const i = css.search(/@supports[^{]*backdrop-filter[^{]*\{/);
      if (i < 0) break;
      let j = css.indexOf('{', i) + 1, depth = 1;
      while (depth && j < css.length) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
      css = css.slice(0, i) + css.slice(j); n++;
    }
    stripped.count = n;
    await route.fulfill({ response: res, body: css });
  });
  const page = await ctx.newPage();
  for (const url of ['/', '/download', '/en/docs']) {
    await page.goto(BASE + url, { waitUntil: 'load' });
    const removed = stripped.count;
    const info = await page.evaluate((removed) => {
      const cs = (s) => { const e = document.querySelector(s); if (!e) return null; const c = getComputedStyle(e); return { bg: c.backgroundColor, bf: c.backdropFilter }; };
      return { removed, card: cs('.card:not(.notice-warn)'), header: cs('.header-inner'), btn: cs('.btn:not(.btn-primary):not(.btn-ghost)') };
    }, removed);
    const opaque = (x) => x && /^rgb\(/.test(x.bg) && (x.bf === 'none' || !x.bf);
    ok(info.removed >= 4 && opaque(info.card) && opaque(info.header), `${url}: ${info.removed} @supports(backdrop-filter) blocks removed; card ${info.card?.bg}, header ${info.header?.bg}, button ${info.btn?.bg}`);
    await page.evaluate(AXE);
    const v = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } })).violations.length);
    ok(v === 0, `${url}: axe color-contrast violations in fallback = ${v}`);
    if (url === '/download') await page.screenshot({ path: path.join(OUT, 'fallback-zh-download-1280.png') });
  }
  await ctx.close();
}

// ---- 3. focus, nav indicator, motion, mobile menu ----
console.log('focus / nav / motion:');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/download', { waitUntil: 'load' });
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  // let the 0.01 ms reduced-motion transition finish (headless Chromium only ticks it when frames are produced)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(300);
  const f = await page.evaluate(() => { const e = document.activeElement; const c = getComputedStyle(e); return { tag: (e.className || e.tagName) + (e.matches(':focus-visible') ? ' :focus-visible' : ' (not focus-visible)'), outline: `${c.outlineStyle} ${c.outlineWidth} ${c.outlineColor}` }; });
  ok(/solid 2px rgb\(96, 165, 250\)/.test(f.outline), `focus ring on ${f.tag}: ${f.outline}`);
  const dot = await page.evaluate(() => getComputedStyle(document.querySelector('.nav-list a[aria-current="page"]'), '::after').opacity);
  ok(dot === '1', `current-page green dot visible (opacity ${dot})`);
  const tr = await page.evaluate(() => getComputedStyle(document.querySelector('.btn')).transitionDuration);
  ok(tr.split(',').every((d) => parseFloat(d) <= 0.0001), `reduced motion: .btn transition-duration ${tr}`);
  await ctx.close();
  const m = await browser.newContext({ viewport: { width: 360, height: 760 }, reducedMotion: 'reduce' });
  const mp = await m.newPage();
  await mp.goto(BASE + '/', { waitUntil: 'load' });
  await mp.click('.nav-toggle');
  await mp.screenshot({ path: path.join(OUT, 'menu-open-zh-360.png') });
  ok(await mp.isVisible('#site-nav .lang-switch'), 'mobile menu open: language switch visible');
  await m.close();
}
await browser.close();
console.log(fails ? `STYLE CHECKS: ${fails} FAIL` : 'STYLE CHECKS: ALL PASS');
process.exit(fails ? 1 : 0);
