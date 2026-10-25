#!/usr/bin/env node
// Pull GitHub Releases for the app repo and write a validated snapshot to data/releases.json.
//
// Safety rules:
// - Drafts are never published. Prereleases are kept but flagged (rendered separately, labelled).
// - An asset is accepted only if it is an .apk with a name, a positive size, a "sha256:<64 hex>"
//   digest and an https browser_download_url on github.com under this repo's release path.
// - On any network error, timeout, rate limit, non-200 or invalid payload we keep the existing
//   committed snapshot untouched and exit 0 with a warning (the build stays reproducible).
// - Release bodies are stored as plain text; they are converted to HTML at build time by a
//   markdown converter that escapes everything (no raw HTML is ever passed through).

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'releases.json');
const REPO = process.env.RELEASES_REPO || 'WQQZachery/wq-s-vpn-proxy';
const API = `https://api.github.com/repos/${REPO}/releases?per_page=50`;
const TIMEOUT_MS = Number(process.env.RELEASES_TIMEOUT_MS || 15000);

const warn = (m) => console.warn(`[fetch-releases] WARNING: ${m}`);
const info = (m) => console.log(`[fetch-releases] ${m}`);

function keepSnapshot(reason) {
  warn(`${reason} — keeping existing snapshot ${path.relative(ROOT, OUT)}`);
  process.exit(0);
}

const ARCH_RE = /(arm64-v8a|armeabi-v7a|x86_64|x86|universal)/i;

export function validateAsset(a, tag) {
  const problems = [];
  if (!a || typeof a !== 'object') return { ok: false, problems: ['not an object'] };
  if (typeof a.name !== 'string' || !/^[A-Za-z0-9._+-]+\.apk$/.test(a.name)) problems.push('name');
  if (!Number.isInteger(a.size) || a.size <= 0) problems.push('size');
  if (typeof a.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(a.digest)) problems.push('digest');
  const prefix = `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/`;
  if (typeof a.browser_download_url !== 'string' || !a.browser_download_url.startsWith(prefix)) problems.push('browser_download_url');
  if (a.state && a.state !== 'uploaded') problems.push('state');
  return { ok: problems.length === 0, problems };
}

export function normalize(list) {
  if (!Array.isArray(list)) throw new Error('payload is not an array');
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    if (r.draft) { info(`skip draft ${r.tag_name}`); continue; }
    if (typeof r.tag_name !== 'string' || !/^v?\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$/.test(r.tag_name)) {
      warn(`skip release with unexpected tag ${JSON.stringify(r.tag_name)}`);
      continue;
    }
    const assets = [];
    for (const a of r.assets || []) {
      if (!String(a.name || '').endsWith('.apk')) continue;
      const v = validateAsset(a, r.tag_name);
      if (!v.ok) { warn(`${r.tag_name}: reject asset ${a.name} (${v.problems.join(', ')})`); continue; }
      const arch = (a.name.match(ARCH_RE) || [])[1] || null;
      assets.push({
        name: a.name,
        size: a.size,
        sha256: a.digest.slice('sha256:'.length),
        url: a.browser_download_url,
        arch,
        content_type: a.content_type || null,
        updated_at: a.updated_at || null,
      });
    }
    out.push({
      tag: r.tag_name,
      version: r.tag_name.replace(/^v/, ''),
      name: typeof r.name === 'string' && r.name ? r.name : r.tag_name,
      prerelease: !!r.prerelease,
      published_at: r.published_at || null,
      html_url: typeof r.html_url === 'string' && r.html_url.startsWith(`https://github.com/${REPO}/releases/tag/`) ? r.html_url : `https://github.com/${REPO}/releases/tag/${encodeURIComponent(r.tag_name)}`,
      target_commitish: r.target_commitish || null,
      body: typeof r.body === 'string' ? r.body : '',
      assets,
    });
  }
  out.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
  return out;
}

async function main() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(API, {
      signal: ctl.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'wq-proxy-vpn-site-build',
      },
    });
  } catch (e) {
    clearTimeout(timer);
    return keepSnapshot(`request failed (${e.name === 'AbortError' ? `timeout ${TIMEOUT_MS}ms` : e.message})`);
  }
  clearTimeout(timer);
  if (res.status === 403 || res.status === 429) {
    return keepSnapshot(`rate limited (HTTP ${res.status}, remaining=${res.headers.get('x-ratelimit-remaining')})`);
  }
  if (res.status !== 200) return keepSnapshot(`unexpected HTTP ${res.status}`);
  let json;
  try { json = await res.json(); } catch { return keepSnapshot('invalid JSON'); }
  let releases;
  try { releases = normalize(json); } catch (e) { return keepSnapshot(e.message); }
  const stable = releases.filter((r) => !r.prerelease);
  if (stable.length === 0 || !stable.some((r) => r.assets.length > 0)) {
    return keepSnapshot('no stable release with a valid APK asset');
  }
  let previous = null;
  try { previous = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }
  const snapshot = {
    source: `https://api.github.com/repos/${REPO}/releases`,
    repo: REPO,
    fetched_at: new Date().toISOString(),
    releases,
  };
  if (previous && JSON.stringify(previous.releases) === JSON.stringify(releases)) {
    info(`no change (${releases.length} releases); snapshot left as is`);
    return;
  }
  await writeFile(OUT, JSON.stringify(snapshot, null, 2) + '\n');
  info(`wrote ${releases.length} releases (${stable.length} stable) to ${path.relative(ROOT, OUT)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => keepSnapshot(`unexpected error: ${e.message}`));
}
