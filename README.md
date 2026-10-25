# WQ's Proxy VPN — product website

Bilingual (简体中文 / English) static website for the Android app
[WQ's Proxy VPN](https://github.com/WQQZachery/wq-s-vpn-proxy), served by an **independent**
Cloudflare Worker named `wq-proxy-vpn-site` using Workers Static Assets.

- No Worker script, no bindings, no Durable Objects, no databases, no secrets.
- The site never hosts APKs: download buttons point to GitHub Release assets.
- It is **not** part of, and must never be deployed as, the personal-site Worker `wqzachery`.

> Status: built and tested locally only. Nothing has been pushed, deployed, or attached to a domain.

## Layout

```
data/
  releases.json        snapshot of GitHub Releases (validated; committed)
  dependencies.json    Flutter/Dart packages from the app's pubspec.lock (committed)
  app.json             hand-verified app facts (commits, signing cert fingerprints, versions)
src/
  templates/layout.html
  i18n/zh.json en.json  UI strings, page metadata, home/download/changelog copy
  content/{zh,en}/docs.md privacy.md licenses.md
  content/changelog.json English summaries + notes for unreleased dev builds
public/
  _headers             security + cache headers (copied to dist/)
  favicon.svg og.png
  assets/css/site.css assets/js/site.js assets/js/early.js   (content-hashed at build)
scripts/
  fetch-releases.mjs   GitHub API → data/releases.json (keeps snapshot on failure, exit 0)
  build.mjs            renders dist/ (12 pages + 404, robots, optional sitemap)
  check.mjs            HTML/link/SEO/release-consistency/header/secret checks (--live compares with GitHub)
  test-routes.sh       wrangler dev + curl every route, redirects, 404s, headers
  screenshots.mjs      Chromium screenshots 360/768/1280, overflow, axe-core, interaction checks
  style-checks.mjs     theme contrast table, no-backdrop-filter fallback, focus ring, reduced motion
  with-dev-server.sh   run a command while wrangler dev serves dist/
  gen-deps.mjs gen-og.mjs  maintainer tools (regenerate dependencies.json / og.png)
  lib/markdown.mjs     tiny escaping Markdown converter (no raw HTML passthrough)
wrangler.jsonc
```

Routes (Chinese default, English under `/en/`):
`/ /download /changelog /docs /privacy /licenses` and `/en/ /en/download /en/changelog /en/docs /en/privacy /en/licenses`.
`html_handling: "auto-trailing-slash"` serves `x.html` at `/x` and `en/index.html` at `/en/`
(`/download/` and `/en` redirect). Unknown paths return the bilingual `404.html` with status 404.

## Local development

Requirements: Node 20+ (tested with v22).

```bash
npm ci
npm run fetch-releases   # optional; needs network. Keeps the committed snapshot on any failure
npm run build            # → dist/
npm run check            # offline checks; add `-- --live` to compare with the live GitHub API
npm run dev              # build + `wrangler dev` on http://localhost:8787 (local only, no login)
```

Behind an HTTP proxy, make sure `NO_PROXY=127.0.0.1,localhost` is set for local tests.

Extra local tests:

```bash
scripts/test-routes.sh                                   # routes, redirects, 404, headers
CHROMIUM_PATH=/usr/bin/chromium scripts/with-dev-server.sh node scripts/screenshots.mjs
CHROMIUM_PATH=/usr/bin/chromium scripts/with-dev-server.sh node scripts/style-checks.mjs
# PHASES=shots|axe|interact and WIDTHS=360,768,1280 select subsets
```

## Visual style

The look follows the main site [wqzachery.dpdns.org](https://wqzachery.dpdns.org/): pure black
background, iOS 26-style liquid-glass surfaces (white 3.5–6 % fill, `blur(7px) saturate(170%)
brightness(1.06)`, inset highlights and a gradient rim), brand green `#76b900`, pill buttons, a floating
glass nav pill with a green dot under the current page, Apple system font stack and a `#60a5fa` focus ring.
It is re-implemented in `public/assets/css/site.css` (no assets, fonts or scripts are loaded from the main
site). Without `backdrop-filter`, with `prefers-reduced-transparency` or `prefers-contrast: more`, surfaces
fall back to opaque `#141418` / `#0b0b0d` panels. Tokens and contrast are checked by `scripts/style-checks.mjs`.

## Base URL / canonical

The domain is **not configured yet**, so the default build omits `<link rel="canonical">`,
`hreflang` alternates, `og:url`, `og:image` and `sitemap.xml`, and `robots.txt` has no `Sitemap:` line.

Once `vpn.wqzachery.dpdns.org` is approved and created, build production with:

```bash
SITE_URL=https://vpn.wqzachery.dpdns.org npm run build && npm run check
```

## Updating content

- New release: `npm run fetch-releases`, then add `releaseMeta` (commit, signing, cert SHA-256 measured
  with `apksigner verify --print-certs`) to `data/app.json` and an English summary to
  `src/content/changelog.json`. Review the diff of `data/releases.json` before committing.
- Drafts are never shown; prereleases are rendered in a separate, labelled section.
- Only assets with a name, positive size, `sha256:` digest and a GitHub release download URL are accepted.
- Dependencies: `APP_DIR=/path/to/wq-s-vpn-proxy PUB_CACHE=~/.pub-cache npm run gen-deps`.
- Privacy policy: update `src/content/{zh,en}/privacy.md` **and** its “Last updated” date whenever the
  app's data handling changes; re-audit the source rather than copying other policies.

## Cloudflare plan (not executed)

1. **Preview first.** In the Cloudflare dashboard create a Worker from this repository
   (Workers Builds) with:
   - Worker name: `wq-proxy-vpn-site` (must match `wrangler.jsonc`; never `wqzachery`)
   - Root directory: `/` (repository root; or the sub-folder if this lives in a monorepo)
   - Build command: `npm ci && npm run build`
   - Deploy command: `npx wrangler deploy` (deploys only the Worker named in `wrangler.jsonc`)
   - Non-production branch deploy command (preview): `npx wrangler versions upload`
   - Build variable `SITE_URL`: leave **unset** for previews.
   Check the `*.workers.dev` / preview URL with `scripts/test-routes.sh`-style requests and a browser.
2. **Domain (after approval).** Confirm in the dashboard that the `wqzachery.dpdns.org` zone allows a
   Workers custom domain for `vpn.wqzachery.dpdns.org`. Then add to `wrangler.jsonc`:
   ```jsonc
   "routes": [{ "pattern": "vpn.wqzachery.dpdns.org", "custom_domain": true }]
   ```
   and set the build variable `SITE_URL=https://vpn.wqzachery.dpdns.org`.
3. Do not touch the personal-site Worker `wqzachery`, its routes, Durable Objects or secrets.
   This Worker has no secrets and needs none.

## License

The website code in this repository is released under GPL-3.0-or-later, the same license as the app.
