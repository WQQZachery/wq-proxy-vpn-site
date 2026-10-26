# 布局与移动端滚动性能审计（perf/layout-scroll）

日期：2026-10-26（Asia/Shanghai）· 基线：`main` @ `582c572` · 工作分支：`perf/layout-scroll`（只推分支，不合并、不部署）

## 1. 部署链确认

| 项 | 值 | 依据 |
|---|---|---|
| 线上域名 | `https://vpn.wqzachery.dpdns.org` | `wrangler.jsonc` → `routes: [{ pattern: "vpn.wqzachery.dpdns.org", custom_domain: true }]` |
| Worker | `wq-proxy-vpn-site`（仅静态资源，无脚本/绑定） | `wrangler.jsonc` `name` + `assets.directory: ./dist` |
| 预览 | `workers_dev: true`、`preview_urls: true` | `wrangler.jsonc` |
| 构建 | Cloudflare Workers Builds ← GitHub `WQQZachery/wq-proxy-vpn-site`，生产分支 `main`；`npm ci && npm run build:prod`，部署 `npx wrangler deploy` | 任务书 / 仓库 `package.json` 脚本 |
| 与个人站关系 | 独立仓库、独立 Worker，**不是** `wqzachery` 个人站仓库 | `wrangler.jsonc` 注释 |

本分支只推送 `perf/layout-scroll`；非生产分支在 Workers Builds 中最多产生预览版本，不会影响 `vpn.wqzachery.dpdns.org`。

## 2. 发现的问题（带证据）

### 2.1 布局：基线提交意外删掉了基础规则（真实 bug）
`582c572` 重写 `site.css` 时删掉了 `.container`、`.sr-only`、`.skip-link`、`.muted`、`.small`、`a`/`a:hover`、`:focus-visible`、`.site-main:focus`、`.card > *` 等规则（与 `22387b1` 的选择器差集对比得出）。headless 实测（`/tmp/layoutprobe.mjs`，Chromium 156，http 服务 dist）：

| 视口 | header-inner left/width | 正文 h1 left/width | 首个 card left/width | footer |
|---|---|---|---|---|
| 360 | 0 / 332（左贴边、未居中） | 0 / 360（文字贴屏幕边） | 0 / 360 | 0 / 360 |
| 1440 | 0 / 820（左贴边） | 0 / 880 | 0 / **1440**（整屏宽卡片） | 0 / 1440 |

另：`.skip-link` 常驻可见（top 4px），`.sr-only` 文本（"在新标签页打开"等）在首页可见 2 处；链接颜色/焦点环回落为浏览器默认（蓝色下划线、无 2px 焦点环）；`--a3`（紫色光球）未定义 → `.o3` 无效。

### 2.2 性能（待第 4 节测量确认）
1. **SVG 透镜（lens）**：`site.js` 给 **所有** `.lg`（首页 25 个：10 张功能卡、5 个手机框、notice、2 张 kv 卡、CTA 卡、3 个次级按钮、语言条、header）生成 canvas 位移图 → `feImage` + 3×`feDisplacementMap` + 3×`feColorMatrix` + 2×`feBlend`，作为 `backdrop-filter` 使用；IntersectionObserver 只是在可见时加/去 `.lens`，可见的每个都在每帧重新对背景采样过滤。canvas 位移图逐像素在主线程 JS 中计算（最大 600 000 px/个）并 `toDataURL()`。
2. **16 处 backdrop-filter 声明 / 每页 6–26 个元素真正带 backdrop-filter**；docs / privacy / licenses 的整篇正文 `.doc.prose.card` 高达数千 px，超过 MAX_AREA 不走透镜，但仍是 `blur(7px) saturate(170%) brightness(1.06)` 的超大模糊层。
3. **`.ambient` 固定层**：3 个 36–60vmax 的多段 `color-mix` 径向渐变光球 + 暗角 + 点阵 mask，位于所有模糊层之下；每个 backdrop-filter 都要读它。
4. **header**：`.header-glass` 也是透镜；scroll 监听每次事件都 `classList.toggle`（passive，但无 rAF 合并、无状态判断），`.solid` 触发 `transform: scale(.97)` 过渡，过渡期间 header 透镜每帧重算。

## 3. 计划修改的文件及原因

| 文件 | 改什么 | 为什么 |
|---|---|---|
| `public/assets/css/site.css` | 恢复丢失的基础规则；新增布局 token（`.container` 1160 / `.reading-container` 820 / ≤600px `100% - 32px`）、间距/字号/卡片 token；卡片改为“实色半透明填充 + 渐变描边”（无 backdrop-filter），仅 header、语言条、移动菜单保留小面积磨砂；`.lens` 只用于 header 胶囊与 CTA；`.ambient` 降成本；`content-visibility` 用于首页折叠以下区块；减弱动效 / 减弱透明度回退 | 修布局 bug + 去掉大面积背景过滤 |
| `public/assets/js/site.js` | 透镜只作用于 `[data-lens]`（header + 主 CTA），触屏/低端设备（`(hover:none) and (pointer:coarse)`、`hardwareConcurrency ≤ 4`、`deviceMemory ≤ 4`）默认关闭；页面隐藏时断开观察者；scroll 改为 rAF 合并且状态变化才写 class | 透镜是测得的最大开销 |
| `src/templates/layout.html` | header / footer 使用统一 `.container`；header 玻璃加 `data-lens` | 导航/页脚与内容同宽 |
| `scripts/build.mjs` | `glassify()` 不再给卡片加 `.lg`（卡片用 `.surface` 样式）；文档类页面使用 `.reading-container`；下载页卡片网格；主 CTA 标记 `data-lens` | 结构与容器统一 |
| `scripts/perf-scroll.mjs`（新增） | headless 滚动性能探针 | 前后对比数据 |
| `scripts/screenshots.mjs` / `style-checks.mjs` | 宽度改为 360/390/600/768/1024/1440；回退检查的选择器随结构调整 | 只在结构有意改变处更新 |
| `docs/LAYOUT_PERF_REPORT.md`（新增） | 报告 | 交付物 |
