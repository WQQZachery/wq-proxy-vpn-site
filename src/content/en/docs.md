> **Note:** the app's interface is currently Simplified Chinese only (the locale is fixed to zh-CN in `lib/main.dart`). Button and screen names in this guide are English translations of the Chinese labels.

# Installing the APK {#install}

1. Open the [download page](/en/download) and download the latest APK (named like `WQs-Proxy-VPN-1.3.0-arm64-v8a.apk`). The link points to GitHub Releases.
2. Verify the **SHA-256** as described on the download page and make sure it matches exactly.
3. Open the APK on your phone. Android will usually say that apps from this source are not allowed; in the settings screen that opens, allow your browser or file manager to “install unknown apps”, then go back and continue.
4. After installing you can switch the “install unknown apps” permission off again in system settings.

> **Why the security warning?** The app is not installed from an app store and it is signed with an Android **debug certificate** (not a production release key). Some vendor systems or security apps may scan it or show additional risk warnings. Only download from the GitHub Releases links on this site and check the SHA-256.

**Requirements**: Android 7.0 or later (minSdk 24) on an arm64-v8a processor. 32-bit ARM and x86 devices cannot install it. Behaviour on each Android version is ==Unverified==.

## Upgrading from an older version {#upgrade}

- From **1.1.1 or later**: install over the existing app (same signing certificate).
- From **1.0.0 or 1.1.0**: uninstall the old version first, otherwise Android reports a signature conflict or the install fails. Uninstalling deletes every node, subscription and setting in the app (Android system backup is disabled for this app), and 1.0.0 / 1.1.0 have no export feature, so keep your original share links or subscription URLs and re-import them after upgrading.

# First launch and permissions {#first-launch}

- **VPN permission**: the first time you tap connect, the app starts Android's VPN consent flow and the system shows a “Connection request” dialog. Tap OK. If you decline, the app reports that it is not authorised and does not connect.
- **Notification permission** (Android 13+): the app asks for it at start-up to show the VPN foreground-service notification (connection status plus a “Disconnect” action). Declining does not stop you from using the app, but you may not see the status notification.
- **Camera permission**: only requested when you choose “Scan QR code”. If you decline you can still read a QR code from a gallery image.
- **Photos**: reading a QR code from the gallery uses the system photo picker (no storage permission on Android 13+).

These steps are written from the source code; the exact dialogs and behaviour on different vendor systems are ==Unverified==.

# Supported protocols {#protocols}

| Protocol | Notes |
|---|---|
| Shadowsocks | 2022-blake3-aes-128-gcm / 2022-blake3-aes-256-gcm / 2022-blake3-chacha20-poly1305 and classic AEAD ciphers |
| VMess | Optional TLS and transports |
| VLESS | REALITY (public key pbk required) and xtls-rprx-vision (TCP transport only) |
| Trojan | Normally used with TLS |
| Hysteria2 | Optional salamander obfuscation |
| TUIC | Congestion control and UDP relay mode configurable |
| SOCKS5 | Optional username / password |
| HTTP | Optional username / password; there is no common share-link format, so add it manually or import it via sing-box JSON |

Transports: TCP, WebSocket, gRPC, HTTP and HTTPUpgrade. The generated config is checked by the sing-box core before it starts. **Not supported**: ShadowsocksR, NaïveProxy, Hysteria v1, WireGuard links and AnyTLS links (the importer says so explicitly). Interoperability of each protocol with real servers is ==Unverified==.

# Importing nodes {#import}

From “Add node” on the Nodes screen you can:

- **Paste**: `ss://`, `vmess://`, `vless://`, `trojan://`, `hysteria2://`, `hy2://`, `tuic://`, `socks://` / `socks5://` share links, several lines at once; Base64-encoded subscription content and sing-box JSON (with outbounds) also work. When the import dialog opens, clipboard text containing `://` is pre-filled automatically.
- **Add subscription**: enter an http(s) subscription URL; the app downloads it (5 MB limit), parses it and imports the nodes. You can refresh it manually later.
- **Scan QR code** with the camera ==Unverified==.
- **Read a QR code from a gallery image.**
- **Add manually** in the editor.

Each entry is validated; malformed or unsupported entries are rejected with a reason and duplicates are skipped. A QR code that contains a single http(s) URL is pre-filled into “Add subscription”; other content (such as Wi-Fi QR codes) is rejected.

**Export**: select nodes to copy share links, copy a Base64 subscription, send via the share sheet, or show a QR code (unavailable when the content is too long). Exports contain passwords, UUIDs and other credentials — only share them with people you trust.

# Routing modes {#routing}

| Mode | Behaviour |
|---|---|
| Rule (default) | DNS traffic goes to the built-in DNS; LAN / private addresses go direct; your “direct domain” suffixes go direct; your “proxy domain” suffixes are proxied; everything else is proxied |
| Global | Everything except LAN and reserved addresses goes through the selected node |
| Direct | The VPN captures traffic but sends all of it direct, for troubleshooting or comparison |

Rule mode does **not** include GeoIP / GeoSite rule sets — it only uses the domain suffix lists you set. The default remote DNS is `https://1.1.1.1/dns-query` (through the proxy) and the default direct DNS is `223.5.5.5` (used to resolve node servers and direct domains); both can be changed in Settings.

# Latency tests and groups {#latency}

Every result says which layer it measured, and a lower-layer success is never reported as “node works”:

- **TCP only**: with the VPN off, only checks that the server port accepts connections.
- **TLS handshake**: port reachable and the TLS certificate verified, but proxy authentication not tested.
- **Proxy request**: with the VPN on, sing-box completes a real HTTP request through that node (default target `https://www.gstatic.com/generate_204`). Only this means the node works.

Hysteria2 / TUIC run over UDP and show “not applicable” while the VPN is off. “Test…” lets you pick all nodes, the current filter or a group, and each group header has “Test this group”. Testing automatically when you open the Nodes screen is a setting and is off by default.

**Groups and sorting**: no grouping / by source / by protocol / custom groups; sort by default order, latency or name. Custom groups can be created, renamed and deleted, and nodes stay in their group after a subscription refresh. Grouping only affects the display, not the nodes or the generated config.

**Remove failed nodes**: deletes nodes whose last test failed or timed out, after showing you the list to confirm.

# Risky nodes {#risk}

- **High risk**: the node skips TLS certificate verification (insecure / allowInsecure), so a man-in-the-middle could impersonate the server and steal credentials. Such nodes are **not** written into the running config by default; you must confirm a “risky connection” for that node first.
- **Risk**: traffic is plain text or unencrypted — e.g. VLESS / Trojan without TLS, VMess or Shadowsocks without encryption, SOCKS / HTTP, Hysteria2 without a password. These run, but you are prompted before connecting.
- You can filter the node list by risk. “Allow all risky nodes” in Settings is off by default; turning it on skips per-node confirmation, so use it with care.

# Diagnostics center {#diagnostics}

The diagnostics center checks DNS resolution, TCP connect, TLS handshake and the HTTP request step by step and shows the timing and where it failed, for:

- **Cloudflare**: default `https://www.cloudflare.com/cdn-cgi/trace`.
- **Claude**: default `https://api.anthropic.com/v1/messages`. Only a GET request without any credentials is sent, to tell whether the network path works; the result states “account authentication: not performed”.
- **Custom URL**: pre-filled with `https://www.google.com/generate_204`, change it to any address.

Both default targets can be changed in Settings. Results say whether they were “direct (VPN off)” or “through the VPN tunnel” and are kept in a local history (30 days by default, adjustable in Settings).

# Speed test {#speedtest}

The speed test supports M-Lab ndt7 (it first asks `locate.measurementlab.net` for nearby servers) and Cloudflare (`speed.cloudflare.com`). It probes server latency before choosing, or you can pick a server. Results include latency, jitter, download and upload; metrics it cannot measure reliably, such as packet loss, are shown as “not supported”.

- M-Lab **publishes** test data, including your IP address and the time of the test — see the [M-Lab privacy policy](https://www.measurementlab.net/privacy/).
- Cloudflare's speed endpoints may return HTTP 429 (rate limited) after repeated tests; wait and try again.
- With the VPN on you measure the speed through the node; with it off, your direct connection. Accuracy on phones is ==Unverified==.

# IP reputation and your own AbuseIPDB key {#reputation}

“Exit IP & reputation” first looks up your current exit IP (`api.ip.sb/geoip`, falling back to `ipinfo.io/json`) and then sends that IP to AbuseIPDB for its abuse score, report count, ISP, country, Tor status and more. Results for the same IP are cached in the app for 30 minutes.

The 1.3.0 APK contains a default AbuseIPDB key. It ships inside the APK, so every user shares its quota and anyone could extract it. We recommend:

1. Sign up at [AbuseIPDB](https://www.abuseipdb.com/) and create your own API key.
2. Enter it in the app's Settings. Your own key then takes priority; it is stored in secure storage protected by the Android Keystore.
3. If you see “quota exhausted or rate limited (HTTP 429)” or “API key invalid (HTTP 401/403)”, check or replace the key.

# FAQ and troubleshooting {#faq}

## “Signature conflict” / cannot install over the old version

You have 1.0.0 or 1.1.0 installed. Those versions use different signing certificates from 1.1.1 and later, so uninstall the old version first (this clears the app's data).

## The installer says the app “failed a security check” or blocks it

This happens because the app comes from outside an app store and is debug-signed. Confirm the SHA-256 matches the download page before deciding to install.

## Connected but nothing loads

1. In diagnostics, run “Custom URL” and see whether it fails at DNS, TCP, TLS or HTTP.
2. With the VPN on, run a latency test and make sure the node succeeds at the “proxy request” layer, not just “TCP only”.
3. Compare with Direct mode: if Direct mode works, the problem is most likely the node or its parameters.
4. Check whether the node is marked high risk and not yet confirmed (unconfirmed high-risk nodes are left out of the running config).

## “unknown uTLS fingerprint” error

Fixed in 1.1.1: unsupported fingerprint values (such as `fp=unsafe`) are ignored with a diagnostic message. If you still see it, update to the latest version.

## Stuck on “Connecting”

Since 1.2.0, if the core has not started within 30 seconds it is stopped and the app shows “Connection timed out”. Use Settings → “Export logs (redacted)” and report it on GitHub Issues.

## How to report a problem

Open an issue on [GitHub Issues](https://github.com/WQQZachery/wq-s-vpn-proxy/issues). Settings → “Export logs (redacted)” copies the logs with subscription URLs, passwords, UUIDs and tokens hidden, but please review them yourself before posting.
