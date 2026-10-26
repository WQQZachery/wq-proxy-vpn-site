# 布局与移动端滚动性能报告（perf/layout-scroll）

日期：2026-10-26（Asia/Shanghai）

## 1. 仓库 / 分支 / 基线

- 仓库：`WQQZachery/wq-proxy-vpn-site`（独立产品站，不是个人站仓库）
- 基线：`main` @ `582c572`（当前线上 `vpn.wqzachery.dpdns.org`，Workers Builds 构建 #4 / 版本 `947a1a53`）
- 分支：`perf/layout-scroll`（只推送分支；未合并、未 `wrangler deploy`、未改任何 Cloudflare 设置）
- 部署链：见 `docs/AUDIT_LAYOUT_PERF.md` §1

## 2. 根因（附证据）

| # | 假设 | 结论 | 证据 |
|---|---|---|---|
| 1 | 卡片 + header 上的 SVG 位移 backdrop-filter（lens）非常昂贵 | **成立，最大单项** | 首页同一进程 A/B：仅给 header 加回 lens，每帧中位数 45.7 → 118.6 ms（约 2.6×）；方法验证时把 lens 换成普通 blur，14 帧 GPU SwapBuffers 2047 → 191 ms |
| 2 | 固定 `.ambient` 大光球在模糊层下反复重绘 | **未能单独证实**（改动后已无可测差异） | 改动后再 A/B「有/无 ambient」：151 vs 367 ms，方向相反、处于噪声范围内 → 结论：在少量 backdrop-filter 的前提下 ambient 本身不是瓶颈。仍按 lvh 固定尺寸重写（Android 地址栏伸缩时不再因 vmax 变化而重新栅格化——此点为原理推断，未在真机验证） |
| 3 | 16 处 backdrop-filter，含 docs/privacy 超长卡片 | **成立，长页最严重** | docs/privacy 整篇正文 `.doc.prose.card` 数千 px 高、超出 lens 面积上限，但仍是整块 `blur(7px) saturate(170%)`：每帧中位数 docs 764 → 169 ms，privacy 935 → 74 ms |
| 4 | header backdrop + scroll 监听频繁 toggle class | **监听本身不是瓶颈** | trace 中 scroll 事件监听总耗时改动前后均 ≈ 0 ms；已改为 rAF 合并 + 状态变化才写 class，属于防御性改进 |
| 额外 | 布局 bug | **成立**：`582c572` 误删 `.container`、`.sr-only`、`.skip-link`、`.muted`、`.small`、链接色、`:focus-visible` 等规则 | 360px：header/正文/卡片 left=0 贴屏幕边；1440px：首个卡片宽 1440、header 胶囊左贴边；跳转链接常驻可见；"在新标签页打开"等读屏文本可见；`--a3` 未定义 |

主线程方面（CPU 4× 降速触控滚动）：改动前各页 rAF 间隔 > 50 ms 的帧每次 3–7 个、最长 100–783 ms；改动后 0–1 个、最长 16.8–116.7 ms；renderer 主线程忙碌时间约 1.0–4.3 s → 0.83–1.06 s。两者都没有 > 50 ms 的 JS 长任务（改动前 docs/privacy 各有 1 个），说明卡顿主要来自合成/GPU 过滤开销拖慢帧，而非 JS。

## 3. 逐文件改动

| 文件 | 改动 | 视觉影响 | 预期性能影响 |
|---|---|---|---|
| `public/assets/css/site.css` | 恢复被误删的基础规则；新增布局 token（`.container` = `min(100% - 40px, 1160px)`，`.reading-container` = `min(…, 820px)`，≤600px 边距 16px，兼顾 safe-area）、字号 token（clamp）、行高、区块间距、卡片圆角/内边距/填充/阴影 token | 内容不再贴边；导航/页脚/正文同宽对齐；桌面最宽 1160 | — |
| 同上 | **卡片、次级按钮、手机框不再使用 backdrop-filter**：改为半透明渐变填充 + 原 1px 渐变描边 + 原内高光阴影 | 纯黑背景上几乎无差别；卡片背后的光球不再被模糊（本来就很暗） | 每页实际绘制的 backdrop-filter 元素 26/14/6/6 → 1（只剩 header；语言条和移动菜单只在显示时） |
| 同上 | `.ambient`：3 个 orb div + grain → 单个伪元素的多层渐变，尺寸用 `100lvh`/百分比，`contain: strict` | 光斑位置/颜色接近原样，亮度略降 | 少 4 个图层；地址栏伸缩不重绘（推断） |
| 同上 | 网格：功能卡 1/2/3 列（≥1024 时孤卡占满一行）；下载页「已知问题 + 其他平台」双列、历史版本 `auto-fill minmax(440px)` | 宽屏不再一列长条 | — |
| 同上 | docs/privacy/licenses：TOC 240px + 正文最宽 820px 居中；changelog 用阅读容器 | 长文行宽可读 | — |
| 同上 | 评估过 `content-visibility:auto`，**未采用** | — | 360px 首页初始 scrollHeight 4670 而实际约 7200，滚动中滚动条会跳 |
| 同上 | `prefers-reduced-transparency` / `prefers-contrast` 下卡片与手机框改为实色 | 无障碍 | — |
| `public/assets/js/site.js` | lens 只作用于 `.lg[data-lens]`（header 胶囊）；触屏优先（`(hover:none) and (pointer:coarse)`）或低端（`hardwareConcurrency ≤ 4` / `deviceMemory ≤ 4`）设备不启用，保留磨砂；`<html data-lens="force">` 可强制开启；页面隐藏时停止 Resize/IntersectionObserver；scroll 改为 rAF 合并 + 状态变化才写 class | 手机上 header 只有磨砂、没有折射；桌面（≥5 核）保留主站同款折射（已验证 header 获得 `url(#lgl0)` 滤镜） | 手机端每帧去掉 3×feDisplacementMap；canvas 位移图生成从 25 个元素降到 0–1 个 |
| `src/templates/layout.html` | ambient 简化为单个 div；header 玻璃加 `data-lens` | — | — |
| `scripts/build.mjs` | `glassify()` 只给语言条加 `.lg`；手机框去掉 `.lg`；`pageHeader()` 支持 container/reading/doc 三种宽度；下载页网格结构；changelog 用阅读容器 | 所有文字、链接不变（7 个页面链接集合逐一比对：完全一致） | — |
| `scripts/perf-scroll.mjs`、`scripts/perf-ab.mjs`（新增） | 无头性能探针（见 §4） | — | — |
| `scripts/screenshots.mjs` | 默认宽度改为 360/390/600/768/1024/1440 | — | — |
| `scripts/style-checks.mjs` | 回退检查改为：卡片/按钮在任何情况下都无 backdrop-filter，header 玻璃在无 backdrop-filter 时为不透明 `rgb(20,20,24)`（结构有意改变） | — | — |
| `docs/AUDIT_LAYOUT_PERF.md`、本文件、`docs/perf-data/*.json` | 审计、报告、原始数据 | — | — |

## 4. 前后数据（无头模拟，非真机）

**环境**：Debian 13 arm64 沙箱（2 vCPU 虚拟机），Chromium 156.0.8078.47（Debian 包，`dpkg -x` 到 `/workspace/tools/chromium-root`），playwright 1.64.1，GPU = ANGLE/SwiftShader（软件 Vulkan），视口 360×800、DPR 3、触控 + Android UA。**绝对数值不代表任何手机，只能做前后对比**；该虚拟机噪声很大（同一构建两次运行中位数可差 3×），所以采用同进程交替 A/B 并取中位数。

**A. 帧渲染成本**（`scripts/perf-ab.mjs`：每 400px 强制出一帧，计时；先预热，再交替 3–4 轮）

| 页面 | 基线 backdrop-filter 元素 | 改后 | 基线每帧中位数 | 改后中位数 | p90 基线 → 改后 |
|---|---|---|---|---|---|
| `/` 第 1 次 | 26（其中 lens 最多 4–5 个同时可见） | 3（可见仅 header） | 147.3 ms | **45.7 ms** | 730.6 → 707.8 |
| `/` 第 2 次（复测） | 26 | 3 | 172.3 ms | **54.5 ms** | 867.4 → 651.9 |
| `/` header 强制 lens | — | 3 + lens 1 | — | 118.6 ms | 668.3 |
| `/download` | 14 | 3 | 173.9 ms | **31.3 ms** | 619.8 → 372.4 |
| `/docs` | 6 | 3 | 764.3 ms | **169.1 ms** | 1288.9 → 1193.3 |
| `/privacy` | 6 | 3 | 934.6 ms | **73.8 ms** | 1191.6 → 856.4 |

p90 主要是虚拟机抖动（各变体都有 600–1200 ms 尖峰），参考价值低。

**B. 触控滚动时主线程**（`scripts/perf-scroll.mjs`：`Input.synthesizeScrollGesture` 上下各 3000px、1600 px/s，CPU 4× 降速；基线与改后为不同时段分别运行，噪声更大）

| 页面 | rAF>50ms 帧（基线各次） | 改后各次 | rAF 最长 基线 → 改后 | 主线程忙碌 ms 基线 → 改后 | 手势耗时 ms 基线 → 改后 |
|---|---|---|---|---|---|
| `/` | 5, 7（早前一轮 2, 3） | 0, 0 | 316–483 → 33–50 | 3061–4306（早前 1080–1114）→ 889–1062 | 10459–10810 → 8717–9075 |
| `/download` | 3, 4, 7 | 0, 0 | 100–317 → 16.8 | 1054–1341 → 924–986 | 9634–9827 → 8743–8747 |
| `/docs` | 7, 7 | 1, 0 | 317–367 → 33–117 | 2774–3650 → 892–915 | 12167–12456 → 9083–10067 |
| `/privacy` | 6, 7 | 0, 0 | 333–783 → 16.8 | 3665–3729 → 834–939 | 11875–14304 → 8717–8720 |

scroll 监听耗时：改动前后均 ≈ 0 ms。原始数据：`docs/perf-data/`（docs/privacy 基线手势数据在运行中断时未写入 JSON，以上数字取自运行时输出）。

## 5. 构建 / 测试结果（本次真实运行）

| 测试 | 结果 |
|---|---|
| `npm run build:prod` | 通过：`[build] 14 files → dist/ (SITE_URL=https://vpn.wqzachery.dpdns.org; og.png=true)` |
| `npm run check` | 通过：`13 HTML files, 726 links/resources (430 external), 3 release assets` → `OK — all checks passed` |
| `scripts/test-routes.sh` | 通过：27 PASS、0 FAIL，`ROUTES: ALL PASS`（第一次 wrangler 启动失败一次，重跑正常） |
| 截图 6 宽度 × 13 页 | 360/390 全部 26 张完成；600/768/1024 全部完成；1440 只完成中文 6 页（英文 1440 因 120s 超时未生成） |
| 水平溢出 | 截图脚本 360/390：none；另用快速检查覆盖 13 页 × 6 宽度：**0 页溢出**；header / 主容器 / footer 左边与宽度一致（360: 16/328 … 1440: 140/1160） |
| 控制台 / CSP 错误 | none |
| axe WCAG 2 A/AA（13 页 × 1280/360） | 0 违规 |
| 交互（19 项） | 19/19 PASS：菜单开关、Escape、复制按钮、语言建议/偏好/切换、历史返回、跳转链接、无 JS、320px |
| 菜单动画（不减弱动效） | 打开 60ms 时 opacity 0.36 / `opening` → `open`、opacity 1；Escape 后 80ms opacity 0.29 / `closing` → `closed`、hidden、inert、焦点回到按钮 |
| header `.solid` | 滚到 300px 为 true，回到 0 为 false |
| 下载/外部链接 | 7 个页面的链接集合与基线逐一比对：完全一致 |
| `scripts/style-checks.mjs` | ALL PASS（31 项：20 组对比度、3 页回退 + axe、焦点环、导航点、减弱动效、移动菜单） |

## 6. 未解决 / 未测试

- **真机未测试**：所有性能数据都是无头 + 软件 GPU 模拟；Android 真机（尤其中低端 Mali/Adreno）的实际帧率「未测试」。建议合并前用 Chrome 远程调试在真机上看 Performance 面板。
- 手机上 header 不再有折射（只有磨砂）。若真机测试后认为可接受，可放开（改 `site.js` 中 `touchFirst` 判断，或给 `<html>` 加 `data-lens="force"`）。
- `hardwareConcurrency ≤ 4` 会让 4 线程的旧笔记本也关闭 lens（按任务书建议的阈值，偏保守）。
- ambient 改为 lvh 尺寸对地址栏伸缩的收益是原理推断，未在真机证实；单独 A/B 在噪声范围内。
- 英文页 1440 宽度截图未生成（超时）；溢出检查已覆盖。
- `content-visibility` 评估后未采用（会造成滚动条跳动）。
- 预览：Workers Builds 目前只有 `main` 一个触发器（`branch_includes: ["main"]`），**分支没有产生预览版本**；未改 Cloudflare 设置。本地预览：`npm ci && npm run dev`（wrangler dev，`http://127.0.0.1:8787`）。
