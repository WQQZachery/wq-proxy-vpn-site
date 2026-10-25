# Test report — WQ's Proxy VPN website (local)

Date: 2026-10-25 (Asia/Shanghai). Environment: Debian 13 aarch64 sandbox, Node v22.23.3,
wrangler 4.152.0 (local `wrangler dev`, no Cloudflare login), Chromium 156.0.8078.47 (Debian package)
driven by playwright 1.64 (library only; Playwright's own browser download failed on linux-arm64),
axe-core 4.14.

Status legend: **已运行通过 / passed** · **未执行 / not run** · **无权限 / no access**.

## Summary

| Test | Status | Evidence |
|---|---|---|
| `npm run build` | 已运行通过 | 13 HTML files + assets → `dist/` |
| `npm run check` (HTML sanity, internal links + anchors, external https + rel, unique title/description/OG, CSP compatibility, release data on /download vs `data/releases.json`, robots/sitemap rules, `_headers`, secret/binary scan) | 已运行通过 | `[check] OK — all checks passed` (703 links/resources, 417 external, 3 release assets) |
| Negative test of `check.mjs` (tampered SHA-256, broken link, missing `noreferrer`) | 已运行通过 (errors detected as expected) | see below |
| `npm run check -- --live` (snapshot vs live GitHub API) | 已运行通过 | `live GitHub API comparison: 3 releases checked`, no differences |
| `SITE_URL=https://vpn.wqzachery.dpdns.org` build + check (canonical, hreflang, og:url, og:image, sitemap, robots Sitemap line) | 已运行通过 | 14 files incl. `sitemap.xml` |
| `fetch-releases` failure path (1 ms timeout) | 已运行通过 | warning + snapshot kept, exit 0 |
| `scripts/test-routes.sh` via `wrangler dev` (12 routes, trailing slash, `.html`, static files, unknown paths → 404, headers, repeated GET) | 已运行通过 | `ROUTES: ALL PASS` |
| Screenshots 360 / 768 / 1280 for all 12 pages + 404 (39 PNGs) | 已运行通过 | `screenshots/` (git-ignored local artifacts) |
| Horizontal overflow at 320 / 360 / 768 / 1280 | 已运行通过 | `horizontal overflow: none` |
| Console errors / CSP violations in Chromium | 已运行通过 | `console errors/warnings: none` |
| axe-core WCAG 2.0/2.1 A + AA (incl. color-contrast) at 1280 and 360 | 已运行通过 | `axe WCAG 2 A/AA violations: none` (after fixing `scrollable-region-focusable` on `<pre>`) |
| Interaction: mobile menu, Escape, language suggestion + preference, language switch keeps page, history back, copy SHA-256, skip link, no-JS nav | 已运行通过 | 19/19 PASS |
| Manual visual review of screenshots | 已运行（抽查） | zh home 1280/360, en download 360, en changelog 1280, zh privacy 1280, zh 404 360, zh licenses 768, og.png |
| `wrangler deploy --dry-run` (config validation only, nothing uploaded) | 已运行通过 | `No bindings found. --dry-run: exiting now.` |
| Cloudflare preview / workers.dev deployment | 无权限 / 未执行 | Not allowed by the task; no account access used |
| Custom domain `vpn.wqzachery.dpdns.org` | 未执行 | Domain not approved/created |
| Real Android device behaviour of the app | 未执行 | The website states these items as “待验证 / Unverified” |
| Personal-site repo untouched | 已运行通过 | `/tmp/siteaudit` clean, HEAD 2d4fb3d0670c3a7c722e2118e10d4fa9258ddcea |
| App repo untouched (read only) | 已运行通过 | `proxypilot-mobile` clean, HEAD d6ed8a5 |

## Command output excerpts

```
$ npm run build && npm run check && npm run check -- --live
[build] 13 files → dist/ (SITE_URL=unset: canonical/og:url/sitemap omitted; og.png=true)
[check] 13 HTML files, 703 links/resources (417 external), 3 release assets, SITE_URL=unset
[check] OK — all checks passed
[check] 13 HTML files, 703 links/resources (417 external), 3 release assets, SITE_URL=unset
[check] note: live GitHub API comparison: 3 releases checked
[check] OK — all checks passed

$ SITE_URL=https://vpn.wqzachery.dpdns.org npm run build && npm run check
[build] 14 files → dist/ (SITE_URL=https://vpn.wqzachery.dpdns.org; og.png=true)
[check] 13 HTML files, 703 links/resources (417 external), 3 release assets, SITE_URL=https://vpn.wqzachery.dpdns.org
[check] OK — all checks passed

$ RELEASES_TIMEOUT_MS=1 node scripts/fetch-releases.mjs ; echo exit=$?
[fetch-releases] WARNING: request failed (timeout 1ms) — keeping existing snapshot data/releases.json
exit=0

# negative test (dist/download.html edited by hand, then restored)
[check] ERROR download.html: WQs-Proxy-VPN-1.3.0-arm64-v8a.apk: displayed SHA-256 differs
[check] ERROR download.html: broken internal link: /privacyx
[check] ERROR download.html: target=_blank without rel="noopener noreferrer": https://github.com/WQQZachery/wq-s-vpn-proxy/releases/tag/v1.3.0
```

```
$ scripts/test-routes.sh
PASS /                            -> 200 text/html; charset=utf-8
PASS /download … /licenses        -> 200 text/html; charset=utf-8   (all 6 zh routes)
PASS /en/ … /en/licenses          -> 200 text/html; charset=utf-8   (all 6 en routes)
PASS /download/                   -> 307  http://127.0.0.1:8787/download
PASS /en                          -> 307  http://127.0.0.1:8787/en/
PASS /en/docs/                    -> 307  http://127.0.0.1:8787/en/docs
PASS /download.html               -> 307  http://127.0.0.1:8787/download
PASS /index.html                  -> 307  http://127.0.0.1:8787/
PASS /favicon.svg                 -> 200 image/svg+xml
PASS /robots.txt                  -> 200 text/plain; charset=utf-8
PASS /assets/site.<hash>.css      -> 200 text/css; charset=utf-8
PASS /assets/site.<hash>.js       -> 200 text/javascript; charset=utf-8
PASS /nope, /en/nope, /download/extra, /assets/missing.css -> 404 text/html; charset=utf-8
PASS 404 body is the bilingual 404 page
content-security-policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
permissions-policy: accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
x-frame-options: DENY
cross-origin-opener-policy: same-origin
HTML:        Cache-Control: public, max-age=300, must-revalidate
hashed CSS:  Cache-Control: public, max-age=31536000, immutable
PASS repeated GET /en/privacy identical
ROUTES: ALL PASS
```

```
$ PHASES=shots,interact WIDTHS=1280 … node scripts/screenshots.mjs   (360/768 and axe runs analogous)
horizontal overflow: none
console errors/warnings: none
axe WCAG 2 A/AA violations: none
  PASS mobile: nav hidden until toggled (JS)
  PASS mobile: nav visible after toggle [true]
  PASS mobile: Escape closes nav
  PASS download: copy button revealed by JS
  PASS zh page + en browser locale: English suggestion shown
  PASS no automatic redirect from zh page
  PASS suggestion keeps current page (/en/download)
  PASS preference saved in localStorage
  PASS language switch back keeps page (/download)
  PASS switching to zh stores zh
  PASS zh pref: no suggestion banner
  PASS history back works (/en/download)
  PASS zh browser locale: no suggestion banner
  PASS copy button copies SHA-256 [15317b53b27ec3638479]
  PASS keyboard: first Tab focuses skip link
  PASS no-JS: nav links visible on mobile
  PASS no-JS: SHA-256 visible as text
  PASS no-JS: no horizontal overflow at 360px [0]
  PASS 320px: no horizontal overflow on any page
```

Issues found and fixed during testing: 22 px overflow at 320 px caused by long source-file names
(now wrap / basename only), `<pre>` blocks not keyboard-focusable (axe `scrollable-region-focusable`,
now `tabindex="0"`), full-width punctuation in English release metadata, TOC numbers clipped.

## Release data verification (performed for the content, 2026-10-25)

- GitHub API `GET /repos/WQQZachery/wq-s-vpn-proxy/releases`: v1.3.0, v1.1.0, v1.0.0, none draft or
  prerelease; asset sizes 32,332,951 / 27,938,256 / 27,891,808 bytes with matching `sha256:` digests.
- Local copies of all three APKs hash to the release digests; `apksigner verify --print-certs` gives
  signing certificates `2805576c…b6ef` (1.0.0), `43000125…0597` (1.1.0), `81081482…5cc6` (1.1.1–1.3.0).
  The 1.1.0 release note's claim that it shares 1.0.0's signature is therefore incorrect.
- Tags: v1.0.0 → 9180acd, v1.1.0 → 35dba15, v1.3.0 → d6ed8a5 (= current main).

## Not covered / limits

- No real-device or emulator test of the app; nothing on the site claims VPN connections work.
- The privacy audit is a source review. ML Kit / datatransport traffic and the sing-box
  `configuration.json` file left on disk were not observed on a device (marked 待审计).
- Cloudflare-side behaviour (`_headers` and asset routing in production, workers.dev, custom domain)
  was only exercised through local `wrangler dev`, which uses the same asset-serving logic but is not
  a production test.
- `wrangler dev` / `wrangler deploy --dry-run` were run before `send_metrics: false` was added to
  `wrangler.jsonc`; wrangler may have attempted to send anonymous usage metrics. No login, no upload.
