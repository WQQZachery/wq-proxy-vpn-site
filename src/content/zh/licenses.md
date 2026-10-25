# 项目许可证：GPL-3.0-or-later {#gpl}

WQ's Proxy VPN（原名 ProxyPilot Mobile），Copyright (C) 2026 Qian Wu。应用以 **GNU 通用公共许可证第 3 版或（由你选择）任何更高版本**（GPL-3.0-or-later）发布。简单来说：

- 你可以自由运行、研究、修改和再分发本程序。
- 再分发本程序（无论是否修改，包括分发 APK）时，必须同样以 GPL-3.0-or-later 授权，并向接收者提供**对应源码**（Corresponding Source），包括构建所需的脚本。
- 本程序**不提供任何担保**。

以上只是概括，具有法律效力的是许可证原文：

- [LICENSE](https://github.com/WQQZachery/wq-s-vpn-proxy/blob/main/LICENSE)（版权与授权声明）
- [COPYING](https://github.com/WQQZachery/wq-s-vpn-proxy/blob/main/COPYING)（GPL v3 全文）
- [THIRD_PARTY_NOTICES.md](https://github.com/WQQZachery/wq-s-vpn-proxy/blob/main/THIRD_PARTY_NOTICES.md)（第三方组件声明）

应用内「设置 → 关于 → 许可证」使用 Flutter 自带的许可证页面，列出 Flutter 工具链打包进 APK 的依赖许可证。

# 内置于 APK 的主要组件 {#components}

| 组件 | 版本 | 许可证 | 来源 |
|---|---|---|---|
| sing-box（libbox，gomobile 绑定） | 1.14.3 | GPL-3.0-or-later | https://github.com/SagerNet/sing-box/tree/v1.14.3 |
| sing-box 依赖的 Go 模块（sing、sing-tun、gVisor、quic-go、wireguard-go、uTLS 等） | 见 sing-box v1.14.3 的 `go.mod` | 各自许可证（GPL / MIT / BSD-3-Clause / Apache-2.0 等） | https://github.com/SagerNet/sing-box/blob/v1.14.3/go.mod |
| Go 运行时（编译 libbox） | go1.27.3 | BSD-3-Clause | https://go.dev |
| gomobile（SagerNet 分支，带本项目补丁） | v0.1.13 | BSD-3-Clause | https://github.com/SagerNet/gomobile |
| Flutter 引擎与框架 | 3.47.8 | BSD-3-Clause | https://github.com/flutter/flutter |
| Google ML Kit Barcode Scanning（经 mobile_scanner 引入，模型内置） | 17.3.0 | **专有**（[ML Kit 条款](https://developers.google.com/ml-kit/terms)） | https://developers.google.com/ml-kit/vision/barcode-scanning |
| Google datatransport（随 ML Kit 引入） | — | 随 Google 组件分发 ==待审计== | — |
| AndroidX CameraX（经 mobile_scanner 引入） | 1.6.1 | Apache-2.0 | https://developer.android.com/jetpack/androidx/releases/camera |
| Flutter / Dart 包 | 见下表 | 见下表 | pub.dev |

`android/app/src/main/kotlin/.../vpn/ProxyVpnService.kt` 中 TUN 建立、网络接口枚举、默认网络监控的部分逻辑参考了 sing-box-for-android（SFA，GPL-3.0-or-later）：https://github.com/SagerNet/sing-box-for-android

# sing-box 对应源码与构建材料 {#singbox}

APK 内的 `libbox.so` 由 sing-box **v1.14.3** 源码编译：

- sing-box 源码：https://github.com/SagerNet/sing-box/tree/v1.14.3
- 构建脚本：[scripts/build-libbox.sh](https://github.com/WQQZachery/wq-s-vpn-proxy/blob/v1.3.0/scripts/build-libbox.sh)（应用仓库，v1.3.0）
- 构建参数：目标 `android/arm64`，`-androidapi 24`，tags `with_gvisor,with_quic,with_wireguard,with_utls,with_clash_api,badlinkname,tfogo_checklinkname0`；未编入 naive、tailscale、usbip、openvpn、openconnect。
- **gomobile v0.1.13 补丁说明**：上游 gomobile 在 linux/arm64 主机上会因找不到对应的 NDK 预编译目录而中止。构建脚本复制 `github.com/sagernet/gomobile@v0.1.13` 源码，把 `cmd/gomobile/env.go` 中 `if runtime.GOOS == "darwin" {` 改为同时匹配 `linux`，让 linux 主机也使用 NDK 的 `linux-x86_64` 目录；在原构建环境中，该目录内的 clang / lld 已被环境脚本 `scripts/setup-system.sh` 替换为 Debian llvm-19 的包装程序。这一补丁只影响构建工具，不改变 sing-box 源码。

# 各版本对应源码 {#sources}

@@SOURCES@@

# Flutter / Dart 依赖 {#deps}

@@DEPS@@

# 当前缺口 {#gaps}

以下问题**尚未解决**，本站不声称应用目前已满足全部许可证义务：

1. **Google ML Kit 专有组件与 GPL 的兼容性未解决**：扫码功能通过 mobile_scanner 内置了 Google ML Kit Barcode Scanning（专有，ML Kit 条款）以及 `com.google.android.datatransport`（Google 用于发送 ML Kit 使用日志）。它们与 GPL-3.0-or-later 整体分发是否兼容，尚无结论，属于开放问题。
2. **libbox.aar 未提交到仓库，构建脚本依赖本机路径**：`android/app/libs/*.aar` 被 `.gitignore` 排除；`scripts/build-libbox.sh` 引用 `/workspace/tools/env.sh`、`/workspace/tools/sing-box-src`、`/workspace/tools/gomobile-src` 等构建机专用路径，并依赖 `setup-system.sh` 对 NDK 工具链的替换。目前也没有公开 libbox.aar 的校验值。第三方想复现完全一致的二进制，还缺少可移植的构建说明。
3. **1.1.1、1.2.0、1.2.1 没有 tag**：这几个开发构建只有提交记录，没有 tag 或 Release（对应提交见上表）。
4. **debug 签名**：所有已发布 APK 都使用 Android debug 证书签名，并且证书已更换过两次（1.0.0、1.1.0、1.1.1+ 各不相同）。这不是许可证条款问题，但影响用户核实安装包来源。
5. **第三方声明不完整**：`THIRD_PARTY_NOTICES.md` 只列出了部分 Flutter 依赖，没有逐个列出 Apache-2.0 许可的传递依赖（如 clock、material_color_utilities）和 MIT 许可的 sqlite3 等；sing-box 各 Go 依赖的许可证全文是否随 APK 提供 ==待审计==。
6. **发布说明中的旧下载链接**：v1.0.0、v1.1.0 的发布说明还链接到 `apk` 分支中的同名文件；本站只链接 Release 附件。
