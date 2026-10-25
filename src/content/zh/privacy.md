> **最后更新：2026-10-25**。本政策依据 1.3.0 源码（tag v1.3.0，提交 d6ed8a5）以及 1.3.0 构建的合并清单（AndroidManifest）逐项核对。核对方式是阅读源码，**不是**真机抓包；标注 ==待审计== 的条目尚未得到完整确认。

# 概述 {#summary}

- WQ's Proxy VPN **没有账号系统**，不需要注册或登录。
- 开发者**没有运营任何服务器**接收应用数据。应用的代码中没有开发者自己的统计、广告或崩溃上报服务。
- 应用访问的第三方服务都列在下文「网络访问」中，绝大多数只在你主动点击某个检测或测速功能时才会访问。
- 但应用内置了 **Google ML Kit 条码识别**（用于扫码导入）。根据 Google 的说明，ML Kit SDK 会收集设备与应用信息、性能指标等用于诊断和使用分析，见下文「Google ML Kit」。
- 作为 VPN 应用，开启 VPN 后你设备上的网络流量会经过你自己选择的节点服务器。节点由你自己提供，节点运营者能看到的内容取决于该节点及你访问的服务，本应用无法控制。

# 本地保存的数据 {#local}

所有数据都保存在应用的私有存储中，卸载应用时会被系统删除。应用在清单中设置了 `android:allowBackup="false"`，不参与 Android 系统备份。

| 位置 | 内容 |
|---|---|
| SQLite 数据库 `proxypilot.db` — `nodes` 表 | 节点名称、协议、服务器地址、端口、协议选项、TLS 与传输参数、是否启用、来源、所属订阅、创建时间（**不含**密码、UUID 等凭据） |
| `subscriptions` 表 | 订阅名称、更新时间、节点数量、最近一次错误（**不含**订阅地址） |
| `node_health` 表 | 各节点最近的延迟检测结果、次数与错误信息 |
| `probe_history` 表 | 检测中心、测速与 IP 信誉的结果：目标地址（scheme + 主机 + 路径）、每一步耗时与详情（如解析到的 IP、证书主体）、HTTP 状态码、部分响应头、最多 600 字符的响应片段。例如 Cloudflare trace 的响应片段和 IP 信誉结果中会包含你当时的出口 IP。默认保留 30 天，可在设置中调整 |
| `kv` 表 | 设置项：路由模式、DNS、直连 / 代理域名列表、检测目标、检测历史保留天数、是否自动检测、风险节点确认状态、分组与排序方式等 |
| 安全存储（flutter_secure_storage，由 Android Keystore 保护） | 节点凭据（密码、UUID 等）、订阅地址（订阅令牌通常在地址里）、你自己填写的 AbuseIPDB Key、VPN 运行会话（本机 Clash API 端口与随机密钥、节点标识映射、节点名称、路由模式） |
| 运行配置文件 `running-config.json` | VPN 启动时生成的 sing-box 配置，包含所选及所有已启用节点的凭据。VPN 停止后由应用删除 |
| sing-box 内核文件（`configuration.json`、`sing-box/` 工作目录） | 依据 sing-box 1.14.3 libbox 源码（`experimental/libbox/command_server.go`、`log.go`），内核启动时会把完整运行配置另存为应用私有目录下的 `configuration.json`；应用停止 VPN 时**没有删除**这个文件。内核若发生崩溃，崩溃日志和一份配置副本会保存在 `sing-box/crash_reports/`。这些文件同样包含节点凭据，只在本机私有目录中，不会被上传。==待审计==（尚未在真机上确认文件实际存在情况） |
| 内存中的日志 | 应用日志（最多 500 行）和内核日志（最多 1000 行）只保存在内存中，应用日志写入前会脱敏。「导出日志（已脱敏）」会把两者再次脱敏后复制到剪贴板：订阅地址只保留主机名，密码、UUID、令牌、私钥、`Bearer` 凭据会被隐藏 |

# 网络访问 {#network}

**关于是否经过代理**：VPN 开启时，应用自身发出的请求也会进入 VPN 隧道，按当前路由模式处理（自动分流下，除非目标在你的直连域名列表中，否则经节点发出；直连模式下全部直连）。VPN 未开启时，这些请求直接从你的网络发出。

| 目标 | 何时访问 | 发送的内容 |
|---|---|---|
| 你的节点服务器 | VPN 连接期间；以及 VPN 未开启时做延迟检测 | 连接期间：经节点转发你的网络流量。未开启时的检测：只与节点地址建立 TCP 连接，部分节点再做一次 TLS 握手（会发送 SNI 主机名），不发送凭据 |
| 你添加的订阅地址 | 添加订阅或你手动刷新订阅时 | 一次 GET 请求（完整订阅地址，含其中的令牌），User-Agent 为 `WQsProxyVPN/1.3.0 (sing-box 1.14)`。订阅服务方能看到你的 IP |
| 远程 DNS：默认 `https://1.1.1.1/dns-query`（Cloudflare） | VPN 运行期间解析域名时 | 你访问的域名（经代理、DNS over HTTPS）。可在设置中修改 |
| 直连 DNS：默认 `223.5.5.5`（阿里公共 DNS） | VPN 运行期间解析节点服务器域名和直连域名时 | 这些域名（直连、普通 DNS）。可在设置中修改 |
| `https://www.gstatic.com/generate_204` | VPN 开启后做节点延迟检测时（你手动检测，或开启了「进入节点页自动检测」，默认关闭） | sing-box 通过被测节点请求该地址，不带任何个人数据 |
| `https://api.ip.sb/geoip`，失败时 `https://ipinfo.io/json` | 你在检测中心查询出口 IP 时 | 一次不带参数的 GET 请求；服务方据此看到你的出口 IP 并返回其地理与运营商信息 |
| `https://api.abuseipdb.com/api/v2/check` | 你查询 IP 信誉时（或在「一键检测」中出口 IP 查询成功后） | 你的出口 IP（查询参数）和 API Key（请求头）。使用你自己的 Key，否则使用安装包内置的默认 Key。同一 IP 的结果缓存 30 分钟 |
| `https://www.cloudflare.com/cdn-cgi/trace`（默认，可修改） | 你运行 Cloudflare 检测时 | 一次 GET 请求，不带凭据或请求体。返回内容包含你的出口 IP，会保存在本机检测历史中 |
| `https://api.anthropic.com/v1/messages`（默认，可修改） | 你运行 Claude 检测时 | 一次 GET 请求，**不带** API Key、Cookie 或请求体，只用来判断网络是否可达 |
| 自定义检测 URL（默认 `https://www.google.com/generate_204`） | 你运行自定义检测时 | 一次 GET 请求到你填写的地址 |
| `https://locate.measurementlab.net` 与 M-Lab ndt7 服务器 | 你开始测速时（M-Lab 是默认选项之一） | 定位请求和 ndt7 测速数据。**M-Lab 会长期保存并公开测试数据，包括你的 IP 地址和测试时间**，见 [M-Lab 隐私政策](https://www.measurementlab.net/privacy/) |
| `https://speed.cloudflare.com` | 你开始测速时 | 下载测试数据，并上传随机生成的填充数据 |
| Google ML Kit（经 `com.google.android.datatransport`） | 见下文 | 见下文 ==待审计== |

上述检测、测速和 IP 查询的请求都使用 `WQsProxyVPN/1.3.0` 一类的 User-Agent，不包含设备标识或账号信息。生成的 sing-box 配置不包含远程规则集或自动更新地址；应用代码中也没有调用 libbox 自带的 HTTP 客户端或更新检查功能。

各第三方服务如何处理收到的数据，以其自身的隐私政策为准。

# Google ML Kit {#mlkit}

扫码与「从相册图片识别」功能通过 mobile_scanner 7.4.2 使用 **Google ML Kit Barcode Scanning**（`com.google.mlkit:barcode-scanning:17.3.0`，模型内置在 APK 中，不依赖 Google Play 服务下载模型）。图像识别在设备上完成，应用本身不会上传相机画面或图片。

但是：

- ML Kit 是 Google 的**专有组件**，受 [ML Kit 条款](https://developers.google.com/ml-kit/terms) 约束。
- 1.3.0 的合并清单中包含 `com.google.android.datatransport` 的服务与广播接收器（`TransportBackendDiscovery`、`CctBackendFactory`、`JobInfoSchedulerService` 等）。这是 Google 用来发送 ML Kit 使用日志的传输组件。
- 根据 [Google 的 ML Kit Android 数据披露](https://developers.google.com/ml-kit/android-data-disclosure)，ML Kit SDK 会收集设备信息（厂商、型号、系统版本）、应用信息（包名、版本）、不用于识别用户或设备的每安装标识、性能指标、API 配置、事件类型和错误码等，用于诊断和使用分析，经 HTTPS 发送给 Google，Google 表示不会转交第三方。

本应用没有关闭这一行为的设置。我们**尚未**通过抓包确认它在本应用中实际何时发送、发送哪些内容，因此此项标记为 ==待审计==。如果你不希望产生这类数据，可以不使用扫码和相册识别功能，改用粘贴链接或订阅导入（不使用扫码时 ML Kit 是否仍会发送数据，同样 ==待审计==）。

# 剪贴板 {#clipboard}

- **读取**：只在你打开「导入节点」对话框时读取一次剪贴板文本；如果其中包含 `://`，会预填进输入框，由你确认后才导入。
- **写入**：只在你选择「复制分享链接」「复制订阅」或「导出日志（已脱敏）」时写入。复制的分享链接 / 订阅包含凭据，应用会事先提示。

# 相机、相册与文件 {#camera}

- **相机**（`CAMERA` 权限）：只在扫码界面打开时请求和使用，画面在设备上识别。拒绝后仍可使用其他导入方式。
- **相册**：通过系统照片选择器（image_picker）让你挑选一张图片，只读取你选中的那张，在设备上识别二维码。
- **文件导入 / 导出**：应用没有读取或写入共享存储中任意文件的功能，也没有申请存储权限。导入通过粘贴文本、订阅地址或二维码完成；导出通过剪贴板、系统分享或屏幕上的二维码完成。

# 系统分享 {#share}

只有你选择「系统分享」时，应用才会把节点分享链接（含凭据）交给你在系统分享面板中选中的应用。之后如何处理由该应用决定。

# 权限 {#permissions}

| 权限 | 用途 |
|---|---|
| `INTERNET`、`ACCESS_NETWORK_STATE`、`CHANGE_NETWORK_STATE` | 网络访问、监测默认网络变化 |
| `FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_SPECIAL_USE` | 以前台服务运行 VPN（子类型 vpn） |
| `POST_NOTIFICATIONS` | 显示 VPN 状态通知（Android 13 及以上需要你授权） |
| `CAMERA` | 扫码导入（来自 mobile_scanner，运行时请求） |
| `BIND_VPN_SERVICE`（保护 VPN 服务） | 只有系统能绑定应用的 VPN 服务；建立 VPN 还需要你在系统对话框中同意 |
| `…DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | AndroidX 库自动添加的签名级内部权限，不涉及个人数据 |

应用**没有**申请定位、通讯录、短信、电话、麦克风或存储权限。

# 数据删除 {#delete}

- 删除节点、订阅时，对应的凭据会从安全存储中删除。
- 检测历史超过保留天数后自动清理。
- 卸载应用会删除以上所有本地数据。

# 关于本网站 {#website}

本网站是静态网站，不使用 Cookie、不加载第三方统计或字体，只在浏览器的 localStorage 中保存你选择的语言（键名 `wqvpn-lang`）。网站托管在 Cloudflare 上，Cloudflare 作为托管方可能按其政策处理访问日志。下载按钮直接链接到 GitHub，下载过程中的数据处理遵循 GitHub 的政策。

# 政策变更与联系方式 {#contact}

应用的数据处理方式发生变化时，我们会更新本页并修改「最后更新」日期。如有疑问或发现本政策与应用实际行为不符，请在 [GitHub Issues](https://github.com/WQQZachery/wq-s-vpn-proxy/issues) 提交。
