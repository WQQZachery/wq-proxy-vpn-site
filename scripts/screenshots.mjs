#!/usr/bin/env node
// Browser checks against a running server (wrangler dev): full-page screenshots at 360/390/600/768/1024/1440,
// horizontal-overflow detection, console/CSP errors, mobile menu, copy button, language
// suggestion + preference, no-JS navigation, and an axe-core WCAG 2 AA scan.
//
//   BASE=http://127.0.0.1:8787 CHROMIUM_PATH=/usr/bin/chromium node scripts/screenshots.mjs
// Uses the playwright library with a system Chromium when CHROMIUM_PATH is set.

import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, LANGS, pagePath } from './lib/site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = path.join(ROOT, 'screenshots');
const WIDTHS = (process.env.WIDTHS || '360,390,600,768,1024,1440').split(',').map(Number);
const PHASES = (process.env.PHASES || 'shots,axe,interact').split(',');
const AXE = await readFile(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const results = { overflow: [], console: [], axe: [], checks: [] };
const pass = (name, ok, detail = '') => results.checks.push({ name, ok, detail });

const routes = [];
for (const lang of LANGS) for (const page of PAGES) routes.push({ lang, page, url: pagePath(page, lang) });
routes.push({ lang: 'zh', page: '404', url: '/this-page-does-not-exist' });

for (const w of PHASES.includes('shots') ? WIDTHS : []) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, locale: 'zh-CN', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !(page.url().includes('does-not-exist') && m.text().includes('status of 404'))) results.console.push(`${w}px ${page.url()}: ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => results.console.push(`${w}px ${page.url()}: pageerror: ${e.message}`));
  for (const r of routes) {
    await page.goto(BASE + r.url, { waitUntil: 'load' });
    const ov = await page.evaluate(() => {
      const de = document.documentElement;
      const wide = [];
      if (de.scrollWidth > de.clientWidth + 1) {
        for (const el of document.querySelectorAll('body *')) {
          const b = el.getBoundingClientRect();
          if (b.right > de.clientWidth + 1 && !el.closest('.table-wrap, pre') && getComputedStyle(el).position !== 'fixed') wide.push(`${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80));
          if (wide.length > 5) break;
        }
      }
      return { sw: de.scrollWidth, cw: de.clientWidth, wide };
    });
    if (ov.sw > ov.cw + 1) results.overflow.push(`${w}px ${r.url}: scrollWidth ${ov.sw} > ${ov.cw} ${ov.wide.join(' | ')}`);
    await page.screenshot({ path: path.join(OUT, `${r.lang}-${r.page}-${w}.png`), fullPage: true });
  }
  await ctx.close();
}

// axe-core WCAG 2 A/AA scan at 1280 and 360 (CSP bypassed only to inject the axe script)
for (const w of PHASES.includes('axe') ? [1280, 360] : []) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, bypassCSP: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  for (const r of routes) {
    await page.goto(BASE + r.url, { waitUntil: 'load' });
    await page.evaluate(AXE);
    const res = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const out = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
      return out.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes.slice(0, 2).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n').slice(0, 2).join(' ')) }));
    });
    for (const v of res) results.axe.push(`${w}px ${r.url}: ${v.id} (${v.impact}, ${v.n} nodes) ${v.sample.join(' || ')}`);
  }
  await ctx.close();
}

// Interaction checks
if (PHASES.includes('interact')) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, locale: 'en-US' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/download');
  pass('mobile: nav hidden until toggled (JS)', !(await page.isVisible('#site-nav .nav-list a')));
  await page.click('.nav-toggle');
  pass('mobile: nav visible after toggle', await page.isVisible('#site-nav .nav-list a'), await page.getAttribute('.nav-toggle', 'aria-expanded'));
  await page.keyboard.press('Escape');
  pass('mobile: Escape closes nav', (await page.getAttribute('.nav-toggle', 'aria-expanded')) === 'false');
  pass('download: copy button revealed by JS', await page.isVisible('.copy-btn'));
  pass('zh page + en browser locale: English suggestion shown', await page.isVisible('#lang-suggest'));
  pass('no automatic redirect from zh page', new URL(page.url()).pathname === '/download');
  await page.click('#lang-suggest [data-set-lang="en"]');
  await page.waitForURL('**/en/download');
  pass('suggestion keeps current page (/en/download)', new URL(page.url()).pathname === '/en/download');
  pass('preference saved in localStorage', (await page.evaluate(() => localStorage.getItem('wqvpn-lang'))) === 'en');
  await page.click('.nav-toggle');
  await page.click('a.lang-switch');
  await page.waitForURL('**/download');
  pass('language switch back keeps page (/download)', new URL(page.url()).pathname === '/download');
  pass('switching to zh stores zh', (await page.evaluate(() => localStorage.getItem('wqvpn-lang'))) === 'zh');
  pass('zh pref: no suggestion banner', !(await page.isVisible('#lang-suggest')));
  await page.goBack();
  pass('history back works (/en/download)', new URL(page.url()).pathname === '/en/download');
  await ctx.close();
}
if (PHASES.includes('interact')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await page.goto(BASE + '/download');
  pass('zh browser locale: no suggestion banner', !(await page.isVisible('#lang-suggest')));
  const expected = (await page.textContent('#sha-v130-0')).trim();
  await page.click('[data-copy-target="sha-v130-0"]');
  let clip = '';
  try { clip = await page.evaluate(() => navigator.clipboard.readText()); } catch (e) { clip = `ERR ${e.message}`; }
  pass('copy button copies SHA-256', clip === expected, clip.slice(0, 20));
  // keyboard: first Tab on a fresh load focuses the skip link
  await page.goto(BASE + '/download');
  await page.keyboard.press('Tab');
  pass('keyboard: first Tab focuses skip link', (await page.evaluate(() => document.activeElement && document.activeElement.className)) === 'skip-link');
  await ctx.close();
}
if (PHASES.includes('interact')) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(BASE + '/en/download');
  pass('no-JS: nav links visible on mobile', await page.isVisible('#site-nav .nav-list a'));
  pass('no-JS: SHA-256 visible as text', (await page.textContent('#sha-v130-0')).trim().length === 64);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  pass('no-JS: no horizontal overflow at 360px', sw <= 1, String(sw));
  await page.screenshot({ path: path.join(OUT, 'nojs-en-download-360.png'), fullPage: false });
  await ctx.close();
}
if (PHASES.includes('interact')) {
  // 320px extreme: overflow on every page
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const page = await ctx.newPage();
  for (const r of routes) {
    await page.goto(BASE + r.url);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (sw > 1) results.overflow.push(`320px ${r.url}: overflow ${sw}px`);
  }
  pass('320px: no horizontal overflow on any page', !results.overflow.some((x) => x.startsWith('320px')));
  await ctx.close();
}
await browser.close();

const report = [
  `routes: ${routes.length} × widths ${WIDTHS.join('/')} → ${routes.length * WIDTHS.length} screenshots in screenshots/`,
  `horizontal overflow: ${results.overflow.length ? results.overflow.join('\n  ') : 'none'}`,
  `console errors/warnings: ${results.console.length ? '\n  ' + results.console.join('\n  ') : 'none'}`,
  `axe WCAG 2 A/AA violations: ${results.axe.length ? '\n  ' + results.axe.join('\n  ') : 'none'}`,
  'interaction checks:',
  ...results.checks.map((c) => `  ${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` [${c.detail}]` : ''}`),
].join('\n');
await writeFile(path.join(OUT, `report-${PHASES.join('_')}-${WIDTHS.join('_')}.txt`), report + '\n');
console.log(report);
const failed = results.overflow.length || results.console.length || results.axe.length || results.checks.some((c) => !c.ok);
process.exit(failed ? 1 : 0);
