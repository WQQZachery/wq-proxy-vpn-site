#!/usr/bin/env node
// Post-build checks for dist/. Exits 1 on any error.
//
//   npm run check            # offline checks
//   npm run check -- --live  # additionally compare data/releases.json with the live GitHub API

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, LANGS, pagePath, pageFile } from './lib/site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const LIVE = process.argv.includes('--live');
const errors = [];
const notes = [];
const err = (f, m) => errors.push(`${f}: ${m}`);

async function walk(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, base)));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const attrs = (tag) => {
  const o = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    o[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? '');
  }
  return o;
};

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function sanity(file, html) {
  if (!/^<!doctype html>/i.test(html)) err(file, 'missing <!doctype html>');
  if (!/<html[^>]+lang="[a-zA-Z-]+"/.test(html)) err(file, '<html> without lang');
  if ((html.match(/<title>/g) || []).length !== 1) err(file, 'must have exactly one <title>');
  if ((html.match(/<h1[\s>]/g) || []).length !== 1) err(file, 'must have exactly one <h1>');
  if (!/<meta name="viewport"/.test(html)) err(file, 'missing viewport meta');
  // Tag balance (ignores contents of <pre>/<code> only by virtue of escaping)
  const stack = [];
  const body = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g)) {
    const [, close, nameRaw] = m;
    const name = nameRaw.toLowerCase();
    if (VOID.has(name)) continue;
    if (!close) stack.push(name);
    else {
      const top = stack.pop();
      if (top !== name) { err(file, `tag mismatch: expected </${top}> got </${name}>`); return; }
    }
  }
  if (stack.length) err(file, `unclosed tags: ${stack.join(',')}`);
  // CSP compatibility: no inline script/style/handlers
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const a = attrs(m[1]);
    if (!a.src) err(file, 'inline <script> (blocked by CSP)');
    if (m[2].trim()) err(file, 'script element with inline content');
  }
  if (/<style[\s>]/.test(html)) err(file, 'inline <style> (blocked by CSP)');
  if (/\sstyle\s*=/.test(html)) err(file, 'style="" attribute (blocked by CSP)');
  if (/\son[a-z]+\s*=/.test(html.replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<code[\s\S]*?<\/code>/g, ''))) err(file, 'inline event handler attribute');
  if (/javascript:/i.test(html)) err(file, 'javascript: URL');
  // IDs unique
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) err(file, `duplicate ids: ${[...new Set(dup)].join(', ')}`);
  for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\salt="/.test(m[0])) err(file, 'img without alt');
  return new Set(ids);
}

function resolveInternal(href, files) {
  const [p] = href.split('#');
  if (p === '' || p === undefined) return 'self';
  const clean = p.split('?')[0];
  const candidates = clean.endsWith('/') ? [`${clean.slice(1)}index.html`] : [clean.slice(1), `${clean.slice(1)}.html`];
  return candidates.find((c) => files.has(c)) || null;
}

async function main() {
  try { await stat(DIST); } catch { console.error('dist/ missing — run npm run build first'); process.exit(1); }
  const files = new Set(await walk(DIST));
  const info = JSON.parse(await readFile(path.join(DIST, 'build-info.json'), 'utf8'));
  const siteUrl = info.site_url;
  const rel = JSON.parse(await readFile(path.join(ROOT, 'data', 'releases.json'), 'utf8'));
  const htmlFiles = [...files].filter((f) => f.endsWith('.html'));

  // Expected route files
  for (const lang of LANGS) for (const page of PAGES) if (!files.has(pageFile(page, lang))) err(pageFile(page, lang), 'expected page missing');
  for (const f of ['404.html', 'robots.txt', 'favicon.svg', '_headers']) if (!files.has(f)) err(f, 'missing');

  const pagesIds = {};
  const htmlByFile = {};
  const titles = new Map();
  const descs = new Map();
  let linkCount = 0;
  let extCount = 0;
  for (const f of htmlFiles) {
    const html = await readFile(path.join(DIST, f), 'utf8');
    htmlByFile[f] = html;
    pagesIds[f] = sanity(f, html);
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
    const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
    if (!desc || desc.length < 20) err(f, 'missing/short meta description');
    for (const k of ['og:title', 'og:description', 'og:type', 'og:site_name', 'og:locale']) {
      if (!new RegExp(`<meta property="${k}" content="[^"]+"`).test(html)) err(f, `missing ${k}`);
    }
    if (titles.has(title)) err(f, `duplicate <title> with ${titles.get(title)}`); else titles.set(title, f);
    if (descs.has(desc)) err(f, `duplicate description with ${descs.get(desc)}`); else descs.set(desc, f);
    const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    if (siteUrl && f !== '404.html') {
      if (!canonical || !canonical.startsWith(siteUrl)) err(f, 'canonical missing or wrong host');
      if (!/hreflang="x-default"/.test(html)) err(f, 'hreflang x-default missing');
      if (!/property="og:url"/.test(html)) err(f, 'og:url missing');
    } else if (canonical || /property="og:url"/.test(html) || /rel="alternate" hreflang/.test(html)) {
      err(f, 'canonical/og:url/hreflang present although SITE_URL is unset');
    }
  }

  // Links
  for (const [f, html] of Object.entries(htmlByFile)) {
    for (const m of html.matchAll(/<(a|link|script|img)\b[^>]*>/g)) {
      const a = attrs(m[0]);
      const url = a.href ?? a.src;
      if (url === undefined) continue;
      if (m[1] === 'link' && ['canonical', 'alternate'].includes(a.rel)) continue;
      linkCount++;
      if (/^(https?:)?\/\//.test(url)) {
        extCount++;
        if (!url.startsWith('https://')) err(f, `non-https external URL: ${url}`);
        if (a.target === '_blank') {
          const r = (a.rel || '').split(/\s+/);
          if (!r.includes('noopener') || !r.includes('noreferrer')) err(f, `target=_blank without rel="noopener noreferrer": ${url}`);
        }
        continue;
      }
      if (/^(mailto:|tel:)/.test(url)) continue;
      if (!url.startsWith('/') && !url.startsWith('#')) { err(f, `relative URL not allowed: ${url}`); continue; }
      const target = url.startsWith('#') ? f : resolveInternal(url, files);
      if (!target) { err(f, `broken internal link: ${url}`); continue; }
      const frag = url.split('#')[1];
      if (frag) {
        const tf = target === 'self' ? f : target;
        if (pagesIds[tf] && !pagesIds[tf].has(frag)) err(f, `missing anchor #${frag} in ${tf}`);
      }
    }
  }

  // Language switch points to the same page in the other language
  for (const lang of LANGS) {
    const other = lang === 'zh' ? 'en' : 'zh';
    for (const page of PAGES) {
      const html = htmlByFile[pageFile(page, lang)];
      const sw = (html.match(/<a class="lang-switch" href="([^"]+)"/) || [])[1];
      if (sw !== pagePath(page, other)) err(pageFile(page, lang), `language switch → ${sw}, expected ${pagePath(page, other)}`);
    }
  }

  // Release data on /download matches data/releases.json
  const expected = rel.releases.flatMap((r) => r.assets.map((a) => ({ tag: r.tag, ...a })));
  for (const lang of LANGS) {
    const f = pageFile('download', lang);
    const html = htmlByFile[f];
    const found = [...html.matchAll(/<div class="asset" data-asset ([^>]*)>([\s\S]*?)<\/div>\s*<\/div>/g)].map((m) => ({ a: attrs(m[1]), inner: m[2] }));
    if (found.length !== expected.length) err(f, `asset count ${found.length} ≠ releases.json ${expected.length}`);
    for (const e of expected) {
      const hit = found.find((x) => x.a['data-tag'] === e.tag && x.a['data-name'] === e.name);
      if (!hit) { err(f, `asset ${e.tag}/${e.name} not rendered`); continue; }
      if (Number(hit.a['data-size']) !== e.size) err(f, `${e.name}: size mismatch`);
      if (hit.a['data-sha256'] !== e.sha256) err(f, `${e.name}: sha256 mismatch`);
      if (hit.a['data-url'] !== e.url) err(f, `${e.name}: url mismatch`);
      if (!hit.inner.includes(`>${e.sha256}</code>`)) err(f, `${e.name}: displayed SHA-256 differs`);
      if (!hit.inner.includes(`href="${e.url}"`)) err(f, `${e.name}: download button href differs`);
      if (!hit.inner.includes(e.size.toLocaleString('en-US'))) err(f, `${e.name}: displayed size differs`);
      if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//.test(e.url)) err(f, `${e.name}: not a GitHub release asset URL`);
    }
  }
  const latest = rel.releases.find((r) => !r.prerelease);
  for (const lang of LANGS) {
    if (!htmlByFile[pageFile('home', lang)].includes(`v${latest.version}`)) err(pageFile('home', lang), `latest version v${latest.version} not shown`);
  }

  // robots / sitemap
  const robots = await readFile(path.join(DIST, 'robots.txt'), 'utf8');
  if (siteUrl) {
    if (!files.has('sitemap.xml')) err('sitemap.xml', 'missing although SITE_URL set');
    if (!robots.includes(`Sitemap: ${siteUrl}/sitemap.xml`)) err('robots.txt', 'Sitemap line missing');
    const sm = await readFile(path.join(DIST, 'sitemap.xml'), 'utf8');
    for (const lang of LANGS) for (const page of PAGES) if (!sm.includes(`<loc>${siteUrl}${pagePath(page, lang)}</loc>`)) err('sitemap.xml', `missing ${pagePath(page, lang)}`);
  } else {
    if (files.has('sitemap.xml')) err('sitemap.xml', 'present although SITE_URL unset');
    if (/Sitemap:/i.test(robots)) err('robots.txt', 'Sitemap line present although SITE_URL unset');
  }

  // Headers file
  const headers = await readFile(path.join(DIST, '_headers'), 'utf8');
  for (const h of ['Content-Security-Policy:', "frame-ancestors 'none'", "script-src 'self'", 'X-Content-Type-Options: nosniff', 'Referrer-Policy:', 'Permissions-Policy:', 'Strict-Transport-Security:', 'immutable']) {
    if (!headers.includes(h)) err('_headers', `missing ${h}`);
  }
  // Owner allowed Cloudflare-injected inline loader in script-src (2026-10-26); styles stay strict.
  if (/unsafe-eval/.test(headers) || /style-src[^;]*unsafe-inline/.test(headers)) err('_headers', 'CSP must not allow unsafe-eval or inline styles');

  // No secrets / binaries in the output
  for (const f of files) {
    if (/\.(apk|aar|so|key|pem|jks|keystore)$/i.test(f)) err(f, 'binary or key material must not be in dist/');
    if (/\.(html|js|css|json|txt|svg|xml)$/.test(f) || f === '_headers') {
      const s = await readFile(path.join(DIST, f), 'utf8');
      if (/[0-9a-f]{72,}/i.test(s)) err(f, 'suspiciously long hex string (possible API key)');
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(s)) err(f, 'private key material');
    }
  }

  if (LIVE) {
    try {
      const repo = rel.repo;
      const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=50`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'wq-proxy-vpn-site-check' }, signal: AbortSignal.timeout(15000) });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const live = (await res.json()).filter((r) => !r.draft);
      for (const r of rel.releases) {
        const l = live.find((x) => x.tag_name === r.tag);
        if (!l) { err('releases.json', `${r.tag} not found in live API`); continue; }
        for (const a of r.assets) {
          const la = l.assets.find((x) => x.name === a.name);
          if (!la) err('releases.json', `${r.tag}/${a.name} missing live`);
          else if (la.size !== a.size || la.digest !== `sha256:${a.sha256}` || la.browser_download_url !== a.url) err('releases.json', `${r.tag}/${a.name} differs from live API`);
        }
      }
      const newer = live.filter((l) => !rel.releases.some((r) => r.tag === l.tag_name));
      if (newer.length) notes.push(`live API has releases not in snapshot: ${newer.map((x) => x.tag_name).join(', ')} (run npm run fetch-releases)`);
      notes.push(`live GitHub API comparison: ${rel.releases.length} releases checked`);
    } catch (e) {
      notes.push(`live comparison skipped: ${e.message}`);
    }
  }

  console.log(`[check] ${htmlFiles.length} HTML files, ${linkCount} links/resources (${extCount} external), ${expected.length} release assets, SITE_URL=${siteUrl || 'unset'}`);
  for (const n of notes) console.log(`[check] note: ${n}`);
  if (errors.length) {
    for (const e of errors) console.error(`[check] ERROR ${e}`);
    console.error(`[check] FAILED with ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log('[check] OK — all checks passed');
}

await main();
