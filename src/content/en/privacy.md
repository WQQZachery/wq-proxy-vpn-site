> **Last updated: 2026-10-25.** This policy was checked item by item against the 1.3.0 source (tag v1.3.0, commit d6ed8a5) and the merged AndroidManifest of the 1.3.0 build. The check was a source code review, **not** an on-device traffic capture; items marked ==Pending audit== are not fully confirmed yet.

# Summary {#summary}

- WQ's Proxy VPN has **no account system**; there is nothing to sign up for or log in to.
- The developer does **not run any server** that receives data from the app. The app's code contains no analytics, advertising or crash-reporting service of the developer's own.
- Every third-party service the app contacts is listed under “Network access” below. Almost all of them are only contacted when you tap a specific diagnostic or speed-test feature.
- However, the app bundles **Google ML Kit barcode scanning** (used for QR import). According to Google, ML Kit SDKs collect device and app information, performance metrics and similar data for diagnostics and usage analytics — see “Google ML Kit” below.
- As a VPN app, once the VPN is on your device's traffic passes through the node server you chose. Nodes are supplied by you; what a node operator can see depends on that node and the services you use, which this app cannot control.

# Data stored on your device {#local}

All data lives in the app's private storage and is deleted by Android when you uninstall the app. The manifest sets `android:allowBackup="false"`, so the app is excluded from Android system backup.

| Location | Contents |
|---|---|
| SQLite database `proxypilot.db` — `nodes` table | Node name, protocol, server address, port, protocol options, TLS and transport settings, enabled flag, source, subscription it belongs to, creation time (**no** passwords, UUIDs or other credentials) |
| `subscriptions` table | Subscription name, update time, node count, last error (**not** the subscription URL) |
| `node_health` table | Recent latency results, counts and errors per node |
| `probe_history` table | Results of diagnostics, speed tests and IP reputation: target (scheme + host + path), timing and details of each step (e.g. resolved IPs, certificate subject), HTTP status, selected response headers and up to 600 characters of the response body. For example the Cloudflare trace snippet and IP reputation results contain your exit IP at that time. Kept 30 days by default, adjustable in Settings |
| `kv` table | Settings: routing mode, DNS, direct / proxy domain lists, diagnostic targets, history retention, auto-test flag, risky-node confirmations, grouping and sorting |
| Secure storage (flutter_secure_storage, protected by the Android Keystore) | Node credentials (passwords, UUIDs, etc.), subscription URLs (which usually contain the subscription token), the AbuseIPDB key you entered, and the VPN session (local Clash API port and random secret, node tag mapping, node name, routing mode) |
| Running config file `running-config.json` | The sing-box config generated when the VPN starts, including credentials of the selected and all enabled nodes. The app deletes it when the VPN stops |
| sing-box core files (`configuration.json`, `sing-box/` working directory) | According to the sing-box 1.14.3 libbox source (`experimental/libbox/command_server.go`, `log.go`), the core saves the full running config as `configuration.json` in the app's private directory when it starts, and the app does **not** delete this file when the VPN stops. If the core crashes, a crash log and a copy of the config are kept under `sing-box/crash_reports/`. These files also contain node credentials; they stay in private storage and are not uploaded. ==Pending audit== (not yet confirmed on a device) |
| In-memory logs | The app log (up to 500 lines) and core log (up to 1000 lines) are kept in memory only; app log lines are redacted when written. “Export logs (redacted)” redacts both again and copies them to the clipboard: subscription URLs are reduced to the host name, and passwords, UUIDs, tokens, private keys and `Bearer` credentials are hidden |

# Network access {#network}

**Proxy or direct?** While the VPN is on, the app's own requests also enter the VPN tunnel and follow the current routing mode (in rule mode they go through the node unless the target is on your direct-domain list; in direct mode everything goes direct). While the VPN is off, they leave directly from your network.

| Destination | When | What is sent |
|---|---|---|
| Your node servers | While connected; and during latency tests with the VPN off | While connected: your traffic is relayed through the node. Tests with the VPN off: only a TCP connection to the node address, plus a TLS handshake for some nodes (which sends the SNI host name); no credentials |
| Subscription URLs you add | When you add a subscription or refresh it manually | One GET request (the full subscription URL, including any token in it) with User-Agent `WQsProxyVPN/1.3.0 (sing-box 1.14)`. The subscription provider sees your IP |
| Remote DNS: default `https://1.1.1.1/dns-query` (Cloudflare) | While the VPN is running, to resolve domains | The domains you visit (through the proxy, DNS over HTTPS). Configurable in Settings |
| Direct DNS: default `223.5.5.5` (AliDNS) | While the VPN is running, to resolve node server names and direct domains | Those domain names (direct, plain DNS). Configurable in Settings |
| `https://www.gstatic.com/generate_204` | Node latency tests with the VPN on (manual, or the “auto-test on the Nodes screen” setting, off by default) | sing-box requests this URL through the node under test; no personal data |
| `https://api.ip.sb/geoip`, falling back to `https://ipinfo.io/json` | When you look up your exit IP in diagnostics | One GET request with no parameters; the service sees your exit IP and returns its location and ISP |
| `https://api.abuseipdb.com/api/v2/check` | When you check IP reputation (or in the one-tap check after the exit-IP lookup succeeds) | Your exit IP (query parameter) and an API key (request header): your own key if set, otherwise the default key built into the APK. Results per IP are cached for 30 minutes |
| `https://www.cloudflare.com/cdn-cgi/trace` (default, configurable) | When you run the Cloudflare check | One GET request with no credentials or body. The response contains your exit IP and is stored in the local history |
| `https://api.anthropic.com/v1/messages` (default, configurable) | When you run the Claude check | One GET request **without** any API key, cookie or body, only to see whether the network path works |
| Custom check URL (default `https://www.google.com/generate_204`) | When you run a custom check | One GET request to the address you entered |
| `https://locate.measurementlab.net` and M-Lab ndt7 servers | When you start a speed test (M-Lab is one of the default options) | A locate request and ndt7 measurement traffic. **M-Lab retains and publishes test data, including your IP address and the time of the test** — see the [M-Lab privacy policy](https://www.measurementlab.net/privacy/) |
| `https://speed.cloudflare.com` | When you start a speed test | Download test data, and upload randomly generated filler data |
| Google ML Kit (via `com.google.android.datatransport`) | See below | See below ==Pending audit== |

The diagnostic, speed-test and IP lookup requests use User-Agents such as `WQsProxyVPN/1.3.0` and include no device identifier or account information. The generated sing-box config contains no remote rule sets or update URLs, and the app's code does not call libbox's built-in HTTP client or update-check functions.

How each third-party service handles the data it receives is governed by its own privacy policy.

# Google ML Kit {#mlkit}

QR scanning and “read QR code from gallery image” use **Google ML Kit Barcode Scanning** through mobile_scanner 7.4.2 (`com.google.mlkit:barcode-scanning:17.3.0`; the model is bundled in the APK and does not depend on Google Play services). Recognition runs on the device and the app itself does not upload camera frames or images.

However:

- ML Kit is a **proprietary Google component** governed by the [ML Kit terms](https://developers.google.com/ml-kit/terms).
- The merged manifest of 1.3.0 contains services and a broadcast receiver from `com.google.android.datatransport` (`TransportBackendDiscovery`, `CctBackendFactory`, `JobInfoSchedulerService` and others). This is the transport Google uses to send ML Kit usage logs.
- According to [Google's ML Kit Android data disclosure](https://developers.google.com/ml-kit/android-data-disclosure), ML Kit SDKs collect device information (manufacturer, model, OS version), app information (package name, version), per-installation identifiers not intended to identify a user or device, performance metrics, API configuration, event types and error codes for diagnostics and usage analytics, sent to Google over HTTPS; Google states it is not shared with third parties.

The app has no setting to turn this off. We have **not** yet confirmed by traffic capture when it is actually sent from this app and what it contains, so this item is marked ==Pending audit==. If you want to avoid it, do not use QR scanning or gallery recognition and import via pasted links or subscriptions instead (whether ML Kit sends anything when scanning is never used is also ==Pending audit==).

# Clipboard {#clipboard}

- **Read**: only once, when you open the “Import nodes” dialog; if the text contains `://` it is pre-filled into the input box and nothing is imported until you confirm.
- **Write**: only when you choose “Copy share links”, “Copy subscription” or “Export logs (redacted)”. Copied share links / subscriptions contain credentials, and the app warns you first.

# Camera, photos and files {#camera}

- **Camera** (`CAMERA` permission): requested and used only while the scanner screen is open; frames are processed on the device. If you decline, other import methods still work.
- **Photos**: the system photo picker (image_picker) lets you choose one image; only that image is read, and the QR code is recognised on the device.
- **File import / export**: the app has no feature that reads or writes arbitrary files in shared storage and requests no storage permission. Import works via pasted text, subscription URLs or QR codes; export via the clipboard, the share sheet or an on-screen QR code.

# Share sheet {#share}

Only when you choose “Share” does the app hand the node share links (including credentials) to the app you pick in Android's share sheet. What happens next is up to that app.

# Permissions {#permissions}

| Permission | Purpose |
|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE`, `CHANGE_NETWORK_STATE` | Network access and monitoring default-network changes |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE` | Running the VPN as a foreground service (subtype vpn) |
| `POST_NOTIFICATIONS` | VPN status notification (needs your consent on Android 13+) |
| `CAMERA` | QR import (from mobile_scanner, requested at run time) |
| `BIND_VPN_SERVICE` (protects the VPN service) | Only the system can bind the VPN service; starting a VPN also requires your consent in a system dialog |
| `…DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | Signature-level internal permission added automatically by AndroidX; no personal data |

The app does **not** request location, contacts, SMS, phone, microphone or storage permissions.

# Deleting data {#delete}

- Deleting a node or subscription removes its credentials from secure storage.
- Diagnostic history older than the retention period is pruned automatically.
- Uninstalling the app deletes all of the local data above.

# About this website {#website}

This website is static. It sets no cookies, loads no third-party analytics or fonts, and only stores your language choice in the browser's localStorage (key `wqvpn-lang`). It is hosted on Cloudflare, which as the host may process access logs under its own policies. Download buttons link directly to GitHub, whose policies apply to the download itself.

# Changes and contact {#contact}

If the way the app handles data changes, we will update this page and its “Last updated” date. If you have questions or find that this policy does not match what the app actually does, please open an issue on [GitHub Issues](https://github.com/WQQZachery/wq-s-vpn-proxy/issues).
