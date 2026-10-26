#!/usr/bin/env node
// Static site generator: src/templates + src/i18n/{zh,en}.json + src/content + data/*.json → dist/
//
//   npm run build                         # local / preview build (no canonical, no sitemap)
//   SITE_URL=https://vpn.wqzachery.dpdns.org npm run build   # production build once the domain exists
//
// No network access happens here; release data comes from the committed data/releases.json.

import { readFile, writeFile, mkdir, rm, cp, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml as esc, inline, markdownToHtml } from './lib/markdown.mjs';
import { PAGES, LANGS, pagePath, pageFile, HREFLANG, normalizeSiteUrl } from './lib/site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SITE_URL = normalizeSiteUrl(process.env.SITE_URL || '');

const readJson = async (p) => JSON.parse(await readFile(path.join(ROOT, p), 'utf8'));
const readText = (p) => readFile(path.join(ROOT, p), 'utf8');

const I18N = { zh: await readJson('src/i18n/zh.json'), en: await readJson('src/i18n/en.json') };
const APP = await readJson('data/app.json');
const REL = await readJson('data/releases.json');
const DEPS = await readJson('data/dependencies.json');
const CHANGELOG = await readJson('src/content/changelog.json');
const LAYOUT = await readText('src/templates/layout.html');

const EXT = 'target="_blank" rel="noopener noreferrer"';
const fmt = (s, vars = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const short = (sha) => sha.slice(0, 7);
const repoBlob = (file, ref = APP.sourceRef) => `${APP.repo}/blob/${ref}/${file}`;
const commitUrl = (sha) => `${APP.repo}/commit/${sha}`;
const stable = REL.releases.filter((r) => !r.prerelease);
const pre = REL.releases.filter((r) => r.prerelease);
const latest = stable[0];
if (!latest) throw new Error('data/releases.json has no stable release');

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}
const fmtInt = (n) => n.toLocaleString('en-US');
const PUNCT = { zh: { colon: '：', lp: '（', rp: '）' }, en: { colon: ': ', lp: ' (', rp: ')' } };
const mib = (n) => (n / 1048576).toFixed(1);

function render(tpl, vars) {
  return tpl
    .replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => (vars[k] ?? ''))
    .replace(/\{\{(\w+)\}\}/g, (_, k) => {
      if (!(k in vars)) throw new Error(`template variable missing: ${k}`);
      return esc(vars[k]);
    });
}

// ---------------------------------------------------------------- assets
const SCREENS = {};
async function screenAssets() {
  const dir = path.join(ROOT, 'src', 'screens');
  await mkdir(path.join(DIST, 'assets', 'screens'), { recursive: true });
  for (const f of (await readdir(dir)).filter((n) => n.endsWith('.webp')).sort()) {
    const base = f.replace(/\.webp$/, '');
    SCREENS[base] = await hashedAsset(`src/screens/${f}`, 'assets/screens', base, 'webp');
  }
  for (const lang of LANGS) for (const sc of I18N[lang].home.screens) {
    if (!SCREENS[sc.file]) throw new Error(`screenshot missing: src/screens/${sc.file}.webp`);
  }
}

async function hashedAsset(src, outDir, base, ext) {
  const buf = await readFile(path.join(ROOT, src));
  const h = createHash('sha256').update(buf).digest('hex').slice(0, 10);
  const name = `${base}.${h}.${ext}`;
  await writeFile(path.join(DIST, outDir, name), buf);
  return `/${outDir}/${name}`;
}

// ---------------------------------------------------------------- shared fragments
function evidenceLinks(files, t, lang) {
  return `<p class="evidence"><span class="evidence-label">${esc(t.common.evidence)}${PUNCT[lang].colon.trim()}</span>` +
    files.map((f) => `<a href="${esc(repoBlob(f))}" ${EXT} title="${esc(f)}"><code>${esc(f.split('/').pop())}</code></a>`).join(' ') + '</p>';
}

// width: 'container' (default), 'reading' (long text pages) or 'doc' (aligned with the TOC + article grid)
function pageHeader(title, lead, width = 'container') {
  const cls = width === 'reading' ? 'reading-container' : width === 'doc' ? 'container doc-hero' : 'container';
  return `<section class="page-hero"><div class="${cls}"><h1>${esc(title)}</h1>${lead ? `<p class="lead">${inline(lead)}</p>` : ''}</div></section>`;
}

function withToc(t, bodyHtml, toc, extraTop = '') {
  const tocHtml = toc.length
    ? `<nav class="toc card" aria-label="${esc(t.common.toc)}"><p class="toc-title">${esc(t.common.toc)}</p><ol>${toc.map((x) => `<li><a href="#${esc(x.id)}">${inline(x.text)}</a></li>`).join('')}</ol></nav>`
    : '';
  return `<div class="container doc-layout"><aside class="doc-aside">${tocHtml}</aside><article class="doc prose card">${extraTop}${bodyHtml}</article></div>`;
}

function copyButton(targetId, t) {
  return `<button class="copy-btn" type="button" data-copy-target="${esc(targetId)}" data-label="${esc(t.common.copy)}" data-label-done="${esc(t.common.copied)}" data-label-fail="${esc(t.common.copyFail)}" hidden>${esc(t.common.copy)}</button>`;
}

// ---------------------------------------------------------------- pages
function pageHome(lang) {
  const t = I18N[lang];
  const h = t.home;
  const v = latest.version;
  const chips = [h.chips.version.replace('{version}', v), h.chips.android, h.chips.abi, h.chips.signing, h.chips.license];
  const features = h.features.map((f) => `
      <li class="card feature">
        <h3>${esc(f.title)}</h3>
        <p>${inline(f.text)}</p>
        ${evidenceLinks(f.files, t, lang)}
      </li>`).join('');
  const screens = h.screens.map((sc, i) => `
        <li class="screen">
          <figure>
            <div class="phone"><img src="${SCREENS[sc.file]}" width="486" height="1080" alt="${esc(sc.alt)}"${i === 0 ? '' : ' loading="lazy"'} decoding="async"></div>
            <figcaption>${esc(sc.caption)}</figcaption>
          </figure>
        </li>`).join('');
  return `
<section class="hero">
  <div class="container hero-inner">
    <p class="eyebrow">${esc(h.eyebrow)}</p>
    <h1 class="hero-title">${esc(h.title)}</h1>
    <p class="hero-tagline">${esc(h.tagline)}</p>
    <p class="lead">${esc(fmt(h.lead, { singbox: APP.singBox }))}</p>
    <div class="actions">
      <a class="btn btn-primary" href="${pagePath('download', lang)}">${esc(fmt(h.ctaDownload, { version: v }))}</a>
      <a class="btn" href="${esc(APP.repo)}" ${EXT}>${esc(h.ctaSource)}<span class="sr-only"> ${esc(t.common.external)}</span></a>
      <a class="btn btn-ghost" href="${pagePath('docs', lang)}">${esc(h.ctaDocs)}</a>
    </div>
    <ul class="chips">${chips.map((c) => `<li class="chip">${esc(c)}</li>`).join('')}</ul>
  </div>
</section>
<section class="section">
  <div class="container">
    <div class="card notice notice-warn" role="note">
      <h2 class="notice-title">${esc(h.statusTitle)}</h2>
      <p>${inline(h.statusText)}</p>
    </div>
  </div>
</section>
<section class="section" aria-labelledby="features">
  <div class="container">
    <h2 id="features" class="section-title">${esc(h.featuresTitle)}</h2>
    <p class="section-lead">${esc(fmt(h.featuresLead, { ref: APP.sourceRef }))}</p>
    <ul class="feature-grid">${features}
    </ul>
  </div>
</section>
<section class="section" aria-labelledby="screens">
  <div class="container">
    <div class="screens-head">
      <h2 id="screens" class="section-title">${esc(h.screensTitle)}</h2>
      <span class="badge">${esc(h.screensBadge)}</span>
    </div>
    <p class="section-lead">${esc(h.screensLead)}</p>
    <p class="screens-hint" aria-hidden="true">${esc(h.screensHint)}</p>
  </div>
  <div class="screen-scroller" tabindex="0" role="region" aria-label="${esc(h.screensTitle)}">
    <ul class="screen-list">${screens}
    </ul>
  </div>
</section>
<section class="section" aria-labelledby="compat">
  <div class="container two-col">
    <div class="card">
      <h2 id="compat" class="card-title">${esc(h.compatTitle)}</h2>
      <dl class="kv">${h.compat.map(([k, val]) => `<div class="kv-row"><dt>${esc(k)}</dt><dd>${inline(val)}</dd></div>`).join('')}</dl>
    </div>
    <div class="card">
      <h2 id="limits" class="card-title">${esc(h.limitsTitle)}</h2>
      <ul class="check-list warn-list">${h.limits.map((l) => `<li>${inline(l.replace('(/licenses)', `(${pagePath('licenses', lang)})`).replace('(/en/licenses)', `(${pagePath('licenses', lang)})`))}</li>`).join('')}</ul>
    </div>
  </div>
</section>
<section class="section">
  <div class="container">
    <div class="card cta-card">
      <h2 class="card-title">${esc(h.openTitle)}</h2>
      <p>${esc(h.openText)}</p>
      <div class="actions">
        <a class="btn" href="${pagePath('privacy', lang)}">${esc(h.openPrivacy)}</a>
        <a class="btn" href="${pagePath('licenses', lang)}">${esc(h.openLicenses)}</a>
      </div>
    </div>
  </div>
</section>`;
}

function releaseCard(r, lang, isLatest) {
  const t = I18N[lang];
  const d = t.download;
  const f = d.fields;
  const meta = APP.releaseMeta[r.tag] || {};
  const idBase = r.tag.replace(/[^A-Za-z0-9]/g, '');
  const assets = r.assets.length
    ? r.assets.map((a, i) => {
      const shaId = `sha-${idBase}-${i}`;
      return `
      <div class="asset" data-asset data-tag="${esc(r.tag)}" data-name="${esc(a.name)}" data-size="${a.size}" data-sha256="${esc(a.sha256)}" data-url="${esc(a.url)}">
        <dl class="kv">
          <div class="kv-row"><dt>${esc(f.file)}</dt><dd><code class="break">${esc(a.name)}</code></dd></div>
          <div class="kv-row"><dt>${esc(f.size)}</dt><dd>${fmtInt(a.size)} ${esc(t.common.bytes)}${PUNCT[lang].lp}${mib(a.size)} MiB${PUNCT[lang].rp}</dd></div>
          <div class="kv-row"><dt>${esc(f.arch)}</dt><dd>${esc(a.arch || '—')}</dd></div>
          <div class="kv-row"><dt>${esc(f.signing)}</dt><dd>${meta.signing === 'debug' ? esc(d.signingDebug) : '—'}</dd></div>
          ${meta.certSha256 ? `<div class="kv-row"><dt>${esc(f.cert)}</dt><dd><code class="hash">${esc(meta.certSha256)}</code></dd></div>` : ''}
          <div class="kv-row"><dt>${esc(f.sha)}</dt><dd><code class="hash" id="${shaId}">${esc(a.sha256)}</code> ${copyButton(shaId, t)}</dd></div>
        </dl>
        <div class="actions">
          <a class="btn btn-primary" href="${esc(a.url)}" rel="noopener noreferrer">${esc(d.btnDownload)}</a>
          <a class="btn" href="${esc(r.html_url)}" ${EXT}>${esc(d.btnRelease)}<span class="sr-only"> ${esc(t.common.external)}</span></a>
        </div>
      </div>`;
    }).join('')
    : `<p class="muted">${esc(d.noAsset)}</p><div class="actions"><a class="btn" href="${esc(r.html_url)}" ${EXT}>${esc(d.btnRelease)}</a></div>`;
  return `
  <article class="card release-card${isLatest ? ' release-latest' : ''}" id="${esc(r.tag)}" aria-labelledby="h-${idBase}">
    <header class="release-head">
      <h3 id="h-${idBase}" class="release-title">v${esc(r.version)}${isLatest ? ` <span class="badge badge-accent">${esc(d.latest)}</span>` : ''}${r.prerelease ? ` <span class="badge badge-warn">${esc(d.prerelease)}</span>` : ''}</h3>
      <p class="muted"><span>${esc(f.date)}${PUNCT[lang].colon}</span><time datetime="${esc(r.published_at || '')}">${esc(fmtDate(r.published_at))}</time>${meta.commit ? ` · <span>${esc(f.source)}${PUNCT[lang].colon}</span><a href="${esc(commitUrl(meta.commit))}" ${EXT}><code>${esc(short(meta.commit))}</code></a>` : ''}</p>
    </header>${assets}
  </article>`;
}

function pageDownload(lang) {
  const t = I18N[lang];
  const d = t.download;
  const name = latest.assets[0]?.name || 'WQs-Proxy-VPN.apk';
  return `${pageHeader(d.title, d.lead)}
<div class="container stack">
  <p class="muted small">${esc(fmt(d.snapshot, { date: fmtDate(REL.fetched_at) }))}</p>
  <section aria-labelledby="latest-h">
    <h2 id="latest-h" class="section-title">${esc(d.latest)}</h2>
    ${releaseCard(latest, lang, true)}
  </section>
  ${pre.length ? `<section aria-labelledby="pre-h"><h2 id="pre-h" class="section-title">${esc(d.prerelease)}</h2><p class="muted">${esc(d.prereleaseNote)}</p><div class="card-grid">${pre.map((r) => releaseCard(r, lang, false)).join('')}</div></section>` : ''}
  <div class="two-col">
  <section class="card" aria-labelledby="issues-h">
    <h2 id="issues-h" class="card-title">${esc(d.issuesTitle)}</h2>
    <ul class="check-list warn-list">${d.issues.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>
  </section>
  <section class="card" aria-labelledby="plat-h">
    <h2 id="plat-h" class="card-title">${esc(d.otherPlatforms)}</h2>
    <p>${esc(d.otherPlatformsText)}</p>
  </section>
  </div>
  <section class="card prose" aria-labelledby="verify-h">
    <h2 id="verify-h" class="card-title">${esc(d.verifyTitle)}</h2>
    <p>${esc(d.verifyLead)}</p>
    <p>${esc(d.verifyLinux)}</p>
    <pre class="code" tabindex="0"><code>sha256sum ${esc(name)}
# macOS
shasum -a 256 ${esc(name)}</code></pre>
    <p>${esc(d.verifyWin)}</p>
    <pre class="code" tabindex="0"><code>certutil -hashfile ${esc(name)} SHA256
# PowerShell
Get-FileHash .\\${esc(name)} -Algorithm SHA256</code></pre>
    <p>${esc(d.verifyAndroid)}</p>
    <p>${esc(d.verifyCert)}</p>
    <pre class="code" tabindex="0"><code>apksigner verify --print-certs ${esc(name)}</code></pre>
  </section>
  <section class="card" aria-labelledby="cert-h">
    <h2 id="cert-h" class="card-title">${esc(d.certTitle)}</h2>
    <p>${esc(d.certLead)}</p>
    <dl class="kv">${d.certRows.map(([k, v]) => `<div class="kv-row"><dt>${esc(k)}</dt><dd><code class="hash">${esc(v)}</code></dd></div>`).join('')}</dl>
    <p class="notice-inline">${esc(d.certNote)}</p>
  </section>
  <section aria-labelledby="older-h">
    <h2 id="older-h" class="section-title">${esc(d.older)}</h2>
    <div class="card-grid">${stable.slice(1).map((r) => releaseCard(r, lang, false)).join('')}
    </div>
  </section>
</div>`;
}

function pageChangelog(lang) {
  const t = I18N[lang];
  const c = t.changelog;
  const rel = REL.releases.map((r, i) => {
    const meta = APP.releaseMeta[r.tag] || {};
    const body = r.body && r.body.trim() ? markdownToHtml(r.body, { headingShift: 2 }) : `<p class="muted">${esc(c.noNotes)}</p>`;
    const sum = CHANGELOG.summaries[r.tag]?.[lang];
    const original = lang === 'en'
      ? `<details class="orig" open><summary>${esc(c.origLabel)}</summary><div class="prose" lang="zh-CN">${body}</div></details>`
      : `<div class="prose">${body}</div>`;
    const summary = lang === 'en'
      ? (sum ? `<div class="summary"><p class="summary-label">${esc(c.summaryLabel)}</p><div class="prose">${markdownToHtml(sum)}</div></div>` : `<p class="muted">${esc(c.noNotes)}</p>`)
      : '';
    return `
  <article class="card release-card" id="${esc(r.tag)}">
    <header class="release-head">
      <h2 class="release-title">v${esc(r.version)} <span class="badge ${r.prerelease ? 'badge-warn' : 'badge-accent'}">${esc(r.prerelease ? c.prerelease : c.released)}</span>${i === 0 && !r.prerelease ? '' : ''}</h2>
      <p class="muted"><time datetime="${esc(r.published_at || '')}">${esc(fmtDate(r.published_at))}</time> · <a href="${esc(r.html_url)}" ${EXT}>${esc(c.releasePage)}</a>${meta.commit ? ` · ${esc(c.commit)} <a href="${esc(commitUrl(meta.commit))}" ${EXT}><code>${esc(short(meta.commit))}</code></a>` : ''}</p>
    </header>
    ${summary}
    ${original}
  </article>`;
  }).join('');
  const unrel = APP.unreleased.map((u) => {
    const note = CHANGELOG.unreleased[u.version]?.[lang] || '';
    return `
    <article class="card release-card release-unreleased" id="v${esc(u.version)}">
      <header class="release-head">
        <h3 class="release-title">${esc(u.version)} <span class="badge">${esc(c.unreleasedBadge)}</span></h3>
        <p class="muted">${esc(c.commit)} <a href="${esc(commitUrl(u.commit))}" ${EXT}><code>${esc(short(u.commit))}</code></a>${u.doc ? ` · <a href="${esc(repoBlob(u.doc))}" ${EXT}>${esc(c.docLink)}</a>` : ''}</p>
      </header>
      <div class="prose">${markdownToHtml(note)}</div>
    </article>`;
  }).join('');
  return `${pageHeader(c.title, c.lead, 'reading')}
<div class="reading-container stack">
  ${rel}
  <section aria-labelledby="unrel-h" class="stack">
    <h2 id="unrel-h" class="section-title">${esc(c.unreleasedTitle)}</h2>
    <p class="section-lead">${esc(c.unreleasedLead)}</p>
    ${unrel}
  </section>
  <section class="card" aria-labelledby="ki-h">
    <h2 id="ki-h" class="card-title">${esc(c.knownIssuesTitle)}</h2>
    <ul class="check-list warn-list">${c.knownIssues.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>
  </section>
</div>`;
}

async function pageDocs(lang) {
  const t = I18N[lang];
  const toc = [];
  const md = (await readText(`src/content/${lang}/docs.md`)).replaceAll('](/download)', `](${pagePath('download', lang)})`);
  const html = markdownToHtml(md, { headingShift: 1, toc });
  return `${pageHeader(t.docs.title, t.docs.lead, 'doc')}${withToc(t, html, toc)}`;
}

async function pagePrivacy(lang) {
  const t = I18N[lang];
  const toc = [];
  const html = markdownToHtml(await readText(`src/content/${lang}/privacy.md`), { headingShift: 1, toc });
  return `${pageHeader(t.privacy.title, fmt(t.privacy.lead, { ref: APP.sourceRef }), 'doc')}${withToc(t, html, toc)}`;
}

function depsTables(lang) {
  const t = I18N[lang];
  const L = t.licenses;
  const row = (p) => `<tr><td>${p.url ? `<a href="${esc(p.url)}" ${EXT}>${esc(p.name)}</a>` : esc(p.name)}</td><td><code>${esc(p.source === 'sdk' ? 'Flutter SDK' : p.version)}</code></td><td>${esc(L.scope[p.scope])}</td><td>${esc(p.license)}</td></tr>`;
  const head = `<thead><tr>${L.depsCols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>`;
  const direct = DEPS.packages.filter((p) => p.scope === 'direct');
  const all = DEPS.packages;
  const allLabel = lang === 'en' ? `All ${all.length} packages in pubspec.lock (including transitive and dev-only)` : `pubspec.lock 中全部 ${all.length} 个包（含间接依赖与仅开发依赖）`;
  return `<p>${esc(fmt(L.depsLead, { commit: short(DEPS.app_commit || APP.appCommit) }))}</p>
<div class="table-wrap" tabindex="0"><table>${head}<tbody>${direct.map(row).join('')}</tbody></table></div>
<details class="deps-all"><summary>${esc(allLabel)}</summary><div class="table-wrap" tabindex="0"><table>${head}<tbody>${all.map(row).join('')}</tbody></table></div></details>`;
}

function sourcesTable(lang) {
  const L = I18N[lang].licenses;
  const rows = [];
  for (const r of stable.slice().reverse()) {
    const m = APP.releaseMeta[r.tag];
    rows.push({ v: r.version, tag: r.tag, commit: m?.commit, note: L.sourceReleased, tree: `${APP.repo}/tree/${r.tag}` });
  }
  for (const u of APP.unreleased) rows.push({ v: u.version, tag: null, commit: u.commit, note: L.sourceUnreleased, tree: `${APP.repo}/tree/${u.commit}` });
  rows.sort((a, b) => a.v.localeCompare(b.v, 'en', { numeric: true }));
  return `<p>${esc(L.sourceLead)}</p><div class="table-wrap" tabindex="0"><table><thead><tr>${L.sourceCols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.v)}</td><td>${r.tag ? `<a href="${esc(r.tree)}" ${EXT}><code>${esc(r.tag)}</code></a>` : '—'}</td><td>${r.commit ? `<a href="${esc(commitUrl(r.commit))}" ${EXT}><code>${esc(short(r.commit))}</code></a>` : '—'}</td><td>${esc(r.note)}</td></tr>`).join('')}</tbody></table></div>`;
}

async function pageLicenses(lang) {
  const t = I18N[lang];
  const toc = [];
  let html = markdownToHtml(await readText(`src/content/${lang}/licenses.md`), { headingShift: 1, toc });
  html = html.replace('<p>@@SOURCES@@</p>', sourcesTable(lang)).replace('<p>@@DEPS@@</p>', depsTables(lang));
  if (html.includes('@@')) throw new Error('licenses placeholder not replaced');
  return `${pageHeader(t.licenses.title, t.licenses.lead, 'doc')}${withToc(t, html, toc)}`;
}

function page404() {
  const z = I18N.zh.notFound;
  const e = I18N.en.notFound;
  return `<section class="page-hero nf"><div class="container">
  <p class="nf-code" aria-hidden="true">404</p>
  <div class="two-col">
    <div class="card"><h1>${esc(z.title)}</h1><p>${esc(z.text)}</p><div class="actions"><a class="btn btn-primary" href="/">${esc(z.home)}</a><a class="btn" href="/download">${esc(I18N.zh.nav.download)}</a></div></div>
    <div class="card" lang="en"><h2>${esc(e.title)}</h2><p>${esc(e.text)}</p><div class="actions"><a class="btn btn-primary" href="/en/">${esc(e.home)}</a><a class="btn" href="/en/download">${esc(I18N.en.nav.download)}</a></div></div>
  </div>
</div></section>`;
}

// ---------------------------------------------------------------- layout
function seoLinks(page, lang) {
  if (!SITE_URL || page === '404') return '';
  const self = SITE_URL + pagePath(page, lang);
  return [
    `<link rel="canonical" href="${esc(self)}">`,
    `<link rel="alternate" hreflang="zh-CN" href="${esc(SITE_URL + pagePath(page, 'zh'))}">`,
    `<link rel="alternate" hreflang="en" href="${esc(SITE_URL + pagePath(page, 'en'))}">`,
    `<link rel="alternate" hreflang="x-default" href="${esc(SITE_URL + pagePath(page, 'zh'))}">`,
  ].join('\n') + '\n';
}

let HAS_OG_PNG = false;
function ogExtra(page, lang) {
  if (!SITE_URL) return '';
  const parts = [];
  if (page !== '404') parts.push(`<meta property="og:url" content="${esc(SITE_URL + pagePath(page, lang))}">`);
  if (HAS_OG_PNG) {
    parts.push(`<meta property="og:image" content="${esc(SITE_URL)}/og.png">`, '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">', `<meta property="og:image:alt" content="WQ's Proxy VPN">`);
  }
  if (page !== '404') parts.push(`<meta property="og:locale:alternate" content="${lang === 'zh' ? 'en_US' : 'zh_CN'}">`);
  return parts.length ? parts.join('\n') + '\n' : '';
}

function layout({ page, lang, title, description, body, assets }) {
  const t = I18N[lang];
  const other = lang === 'zh' ? 'en' : 'zh';
  const navItems = PAGES.map((p) => {
    const href = pagePath(p, lang);
    const cur = p === page ? ' aria-current="page"' : '';
    return `        <li><a href="${href}"${cur}>${esc(t.nav[p])}</a></li>`;
  }).join('\n');
  const footerLinks = [
    [APP.repo, t.footer.repo, true],
    [`${APP.repo}/releases`, 'GitHub Releases', true],
    [`${APP.repo}/issues`, t.footer.issues, true],
    [pagePath('privacy', lang), t.nav.privacy, false],
    [pagePath('licenses', lang), t.nav.licenses, false],
  ].map(([href, label, ext]) => `      <li><a href="${esc(href)}"${ext ? ` ${EXT}` : ''}>${esc(label)}</a></li>`).join('\n');
  const altPage = page === '404' ? 'home' : page;
  const suggest = lang === 'zh' && page !== '404'
    ? `<div class="lang-suggest" id="lang-suggest" role="region" aria-label="${esc(I18N.zh.suggest.aria)}" lang="en" hidden><div class="container lang-suggest-inner"><p>${esc(I18N.zh.suggest.text)}</p><div class="actions"><a class="btn btn-small" href="${pagePath(altPage, 'en')}" data-set-lang="en">${esc(I18N.zh.suggest.go)}</a><button class="btn btn-small btn-ghost" type="button" data-dismiss-suggest>${esc(I18N.zh.suggest.dismiss)}</button></div></div></div>`
    : '';
  const disclaimer = fmt(t.footer.disclaimer, { ref: APP.sourceRef, commit: short(APP.appCommit) });
  let seo = seoLinks(page, lang);
  if (page === '404') seo = '<meta name="robots" content="noindex">\n';
  return glassify(render(LAYOUT, {
    htmlLang: t.htmlLang,
    title,
    description,
    seoLinks: seo,
    ogLocale: t.ogLocale,
    ogExtra: ogExtra(page, lang),
    twitterCard: SITE_URL && HAS_OG_PNG ? 'summary_large_image' : 'summary',
    cssPath: assets.css,
    jsPath: assets.js,
    earlyJsPath: assets.early,
    pageId: page,
    langKey: lang,
    skip: t.skip,
    homeHref: pagePath('home', lang),
    menuLabel: t.nav.menu,
    navLabel: t.nav.label,
    navItems,
    altHref: pagePath(altPage, other),
    altHreflang: HREFLANG[other],
    altLangKey: other,
    altAria: t.langSwitch.aria,
    altText: t.langSwitch.text,
    suggestBanner: suggest,
    body,
    footerTagline: t.footer.tagline,
    footerLicense: t.footer.license,
    footerHome: t.footer.home,
    footerHomeExt: t.common.external,
    footerLinks,
    footerDisclaimer: disclaimer,
  }));
}

// Backdrop-filter glass (.lg / .lg-rim) only on small floating surfaces: the language banner here, the header
// pill in the template. Cards, secondary buttons and phone frames get the same look from plain CSS (translucent
// fill + rim, see site.css) — blurring the black page behind them was invisible but cost a filter pass each.
function glassify(html) {
  return html.replace(/class="([^"]*)"/g, (m, cls) => {
    const c = cls.split(/\s+/);
    const add = c.includes('lang-suggest-inner');
    if (!add || c.includes('lg')) return m;
    return `class="${cls} lg lg-rim"`;
  });
}

// ---------------------------------------------------------------- main
async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(path.join(DIST, 'assets'), { recursive: true });
  await mkdir(path.join(DIST, 'en'), { recursive: true });

  // Static files from public/ (except the unhashed CSS/JS sources)
  for (const entry of await readdir(path.join(ROOT, 'public'))) {
    if (entry === 'assets') continue;
    await cp(path.join(ROOT, 'public', entry), path.join(DIST, entry), { recursive: true });
  }
  try { await stat(path.join(ROOT, 'public', 'og.png')); HAS_OG_PNG = true; } catch { HAS_OG_PNG = false; }

  const assets = {
    css: await hashedAsset('public/assets/css/site.css', 'assets', 'site', 'css'),
    js: await hashedAsset('public/assets/js/site.js', 'assets', 'site', 'js'),
    early: await hashedAsset('public/assets/js/early.js', 'assets', 'early', 'js'),
  };
  await screenAssets();

  const builders = { home: pageHome, download: pageDownload, changelog: pageChangelog, docs: pageDocs, privacy: pagePrivacy, licenses: pageLicenses };
  const written = [];
  for (const lang of LANGS) {
    for (const page of PAGES) {
      const body = await builders[page](lang);
      const m = I18N[lang].meta[page];
      const html = layout({ page, lang, title: m.title, description: m.description, body, assets });
      const file = pageFile(page, lang);
      await writeFile(path.join(DIST, file), html);
      written.push(file);
    }
  }
  const nf = layout({ page: '404', lang: 'zh', title: `${I18N.zh.meta.notFound.title} / ${I18N.en.meta.notFound.title}`, description: `${I18N.zh.meta.notFound.description} ${I18N.en.meta.notFound.description}`, body: page404(), assets });
  await writeFile(path.join(DIST, '404.html'), nf);
  written.push('404.html');

  // robots.txt and sitemap.xml
  let robots = 'User-agent: *\nAllow: /\n';
  if (SITE_URL) {
    const urls = [];
    for (const page of PAGES) {
      for (const lang of LANGS) {
        const alts = LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${HREFLANG[l]}" href="${SITE_URL}${pagePath(page, l)}"/>`).join('\n');
        urls.push(`  <url>\n    <loc>${SITE_URL}${pagePath(page, lang)}</loc>\n${alts}\n    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}${pagePath(page, 'zh')}"/>\n  </url>`);
      }
    }
    await writeFile(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);
    robots += `Sitemap: ${SITE_URL}/sitemap.xml\n`;
    written.push('sitemap.xml');
  }
  await writeFile(path.join(DIST, 'robots.txt'), robots);

  await writeFile(path.join(DIST, 'build-info.json'), JSON.stringify({
    site_url: SITE_URL,
    releases_snapshot: REL.fetched_at,
    latest: latest.tag,
    app_commit: APP.appCommit,
  }, null, 2) + '\n');
  console.log(`[build] ${written.length} files → dist/ (SITE_URL=${SITE_URL || 'unset: canonical/og:url/sitemap omitted'}; og.png=${HAS_OG_PNG})`);
}

await main();
