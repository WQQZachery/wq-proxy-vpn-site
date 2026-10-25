# Project license: GPL-3.0-or-later {#gpl}

WQ's Proxy VPN (formerly ProxyPilot Mobile), Copyright (C) 2026 Qian Wu. The app is released under the **GNU General Public License version 3 or (at your option) any later version** (GPL-3.0-or-later). In short:

- You may run, study, modify and redistribute the program.
- If you redistribute it — modified or not, including as an APK — you must license it under GPL-3.0-or-later as well and give recipients the **Corresponding Source**, including the scripts needed to build it.
- The program comes with **no warranty**.

This is only a summary; the license text itself is what is legally binding:

- [LICENSE](https://github.com/WQQZachery/wq-s-vpn-proxy/blob/main/LICENSE) (copyright and license notice)
- [COPYING](https://github.com/WQQZachery/wq-s-vpn-proxy/blob/main/COPYING) (full GPL v3 text)
- [THIRD_PARTY_NOTICES.md](https://github.com/WQQZachery/wq-s-vpn-proxy/blob/main/THIRD_PARTY_NOTICES.md) (third-party notices)

In the app, Settings → About → Licenses opens Flutter's built-in license page, which lists the dependency licenses the Flutter toolchain packages into the APK.

# Main components bundled in the APK {#components}

| Component | Version | License | Source |
|---|---|---|---|
| sing-box (libbox, gomobile binding) | 1.14.3 | GPL-3.0-or-later | https://github.com/SagerNet/sing-box/tree/v1.14.3 |
| Go modules used by sing-box (sing, sing-tun, gVisor, quic-go, wireguard-go, uTLS, …) | see `go.mod` of sing-box v1.14.3 | their own licenses (GPL / MIT / BSD-3-Clause / Apache-2.0, …) | https://github.com/SagerNet/sing-box/blob/v1.14.3/go.mod |
| Go runtime (to compile libbox) | go1.27.3 | BSD-3-Clause | https://go.dev |
| gomobile (SagerNet fork, with this project's patch) | v0.1.13 | BSD-3-Clause | https://github.com/SagerNet/gomobile |
| Flutter engine and framework | 3.47.8 | BSD-3-Clause | https://github.com/flutter/flutter |
| Google ML Kit Barcode Scanning (via mobile_scanner, bundled model) | 17.3.0 | **Proprietary** ([ML Kit terms](https://developers.google.com/ml-kit/terms)) | https://developers.google.com/ml-kit/vision/barcode-scanning |
| Google datatransport (pulled in by ML Kit) | — | distributed with the Google components ==Pending audit== | — |
| AndroidX CameraX (via mobile_scanner) | 1.6.1 | Apache-2.0 | https://developer.android.com/jetpack/androidx/releases/camera |
| Flutter / Dart packages | see table below | see table below | pub.dev |

Parts of the TUN setup, interface enumeration and default-network monitoring in `android/app/src/main/kotlin/.../vpn/ProxyVpnService.kt` follow sing-box-for-android (SFA, GPL-3.0-or-later): https://github.com/SagerNet/sing-box-for-android

# sing-box corresponding source and build material {#singbox}

The `libbox.so` inside the APK is compiled from sing-box **v1.14.3**:

- sing-box source: https://github.com/SagerNet/sing-box/tree/v1.14.3
- Build script: [scripts/build-libbox.sh](https://github.com/WQQZachery/wq-s-vpn-proxy/blob/v1.3.0/scripts/build-libbox.sh) (app repository, v1.3.0)
- Build parameters: target `android/arm64`, `-androidapi 24`, tags `with_gvisor,with_quic,with_wireguard,with_utls,with_clash_api,badlinkname,tfogo_checklinkname0`; naive, tailscale, usbip, openvpn and openconnect are not included.
- **gomobile v0.1.13 patch**: upstream gomobile aborts on linux/arm64 hosts because it cannot find a matching NDK prebuilt directory. The build script copies the `github.com/sagernet/gomobile@v0.1.13` source and changes `if runtime.GOOS == "darwin" {` in `cmd/gomobile/env.go` to also match `linux`, so Linux hosts use the NDK's `linux-x86_64` directory; in the original build environment the clang / lld in that directory had been replaced with Debian llvm-19 wrappers by the environment script `scripts/setup-system.sh`. The patch only affects the build tool, not the sing-box source.

# Source for each version {#sources}

@@SOURCES@@

# Flutter / Dart dependencies {#deps}

@@DEPS@@

# Open gaps {#gaps}

The following issues are **not resolved**; this site does not claim that the app currently meets all of its license obligations:

1. **Google ML Kit is proprietary and its GPL compatibility is unresolved**: QR scanning bundles Google ML Kit Barcode Scanning (proprietary, ML Kit terms) and `com.google.android.datatransport` (used by Google to send ML Kit usage logs) through mobile_scanner. Whether distributing them together with a GPL-3.0-or-later app is compatible has not been settled; it remains an open question.
2. **libbox.aar is not committed and the build script uses host-specific paths**: `android/app/libs/*.aar` is excluded by `.gitignore`; `scripts/build-libbox.sh` refers to build-machine paths such as `/workspace/tools/env.sh`, `/workspace/tools/sing-box-src` and `/workspace/tools/gomobile-src`, and relies on `setup-system.sh` replacing NDK tools. No checksum of libbox.aar is published either. A third party trying to reproduce an identical binary still lacks portable build instructions.
3. **No tags for 1.1.1, 1.2.0 and 1.2.1**: these development builds only exist as commits, without a tag or Release (commits listed above).
4. **Debug signing**: every published APK is signed with an Android debug certificate, and the certificate has changed twice (1.0.0, 1.1.0 and 1.1.1+ all differ). This is not a license-term issue, but it makes it harder for users to verify where an APK came from.
5. **Incomplete third-party notices**: `THIRD_PARTY_NOTICES.md` lists only some Flutter dependencies and does not name the Apache-2.0 transitive dependencies (such as clock and material_color_utilities) or the MIT-licensed sqlite3, among others; whether the full license texts of sing-box's Go dependencies are provided with the APK is ==Pending audit==.
6. **Old download links in release notes**: the v1.0.0 and v1.1.0 release notes still link to files of the same name on the `apk` branch; this site only links to Release assets.
