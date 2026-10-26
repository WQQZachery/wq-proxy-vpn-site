#!/usr/bin/env node
// Headless scroll-performance probe (emulated, NOT a real device).
//   CHROMIUM_PATH=... node scripts/perf-scroll.mjs [distDir=dist] [label] [--out file.json]
// Serves distDir with a tiny static server (pretty URLs → .html), opens each route at 360×800 DPR 3 as a
// touch device (Android UA) and measures two things:
//  A. Frame render cost (GPU/compositor side, where backdrop-filter work lands). Headless Chromium does not
//     draw frames to a display during a scroll, so every 400 px down the page a frame is forced with
//     Page.captureScreenshot and the trace sums the GPU-process work (SkiaOutputSurfaceImplOnGpu::SwapBuffers,
//     which on SwiftShader includes executing the render passes and filters) plus wall time per frame.
//     GPU = ANGLE/SwiftShader (software Vulkan) — absolute numbers are NOT a phone's; compare before/after only.
//  B. Main thread during a real synthetic touch scroll (Input.synthesizeScrollGesture top→bottom→top) with
//     Emulation.setCPUThrottlingRate (CPU_THROTTLE, default 4): rAF intervals, long tasks (>50 ms),
//     renderer main busy ms, scroll-event listener ms.
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUTFILE = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
const DIST = path.resolve(args[0] || 'dist');
const LABEL = args[1] || path.basename(DIST);
const THROTTLE = Number(process.env.CPU_THROTTLE || 4);
const ROUTES = (process.env.ROUTES || '/,/download,/docs,/privacy').split(',');
const RUNS = Number(process.env.RUNS || 3); // run 0 = cold (shader compile / first decode), runs 1.. = warm
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const cands = p.endsWith('/') ? [p + 'index.html'] : [p, p + '.html'];
  for (const c of cands) {
    const f = path.join(DIST, c);
    try { if ((await stat(f)).isFile()) { res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(await readFile(f)); return; } } catch {}
  }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-gpu'] });
const CATS = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'cc', 'viz', 'gpu', 'benchmark', 'blink', 'toplevel'];

function analyse(trace) {
  const ev = trace.traceEvents;
  // thread names
  const tname = new Map();
  for (const e of ev) if (e.ph === 'M' && e.name === 'thread_name') tname.set(`${e.pid}:${e.tid}`, e.args.name);
  // renderer main = thread that has the most 'Layout'/'Paint' events named CrRendererMain
  const sum = {}; const add = (k, v) => { sum[k] = (sum[k] || 0) + v; };
  let longTasks = 0, longTaskMs = 0;
  const frames = { presented: 0, dropped: 0, partial: 0 };
  const busy = {};
  for (const e of ev) {
    const tn = tname.get(`${e.pid}:${e.tid}`) || '';
    if (e.ph === 'X' && typeof e.dur === 'number') {
      const ms = e.dur / 1000;
      if (tn === 'CrRendererMain') {
        if (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') { if (ms > 50) { longTasks++; longTaskMs += ms; } add('main.taskMs', ms); }
        if (['Layout', 'Paint', 'UpdateLayerTree', 'PrePaint', 'Layerize', 'Commit', 'UpdateLayoutTree', 'ParseHTML', 'FunctionCall', 'EventDispatch', 'HitTest'].includes(e.name)) add('main.' + e.name, ms);
        if (e.name === 'EventDispatch' && e.args?.data?.type === 'scroll') add('main.scrollListener', ms);
      }
      if (/Compositor$/.test(tn) && (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask')) add('compositor.busyMs', ms);
      if (/CompositorTileWorker|RasterWorker/.test(tn) && (e.name === 'RasterTask' || e.name === 'TaskGraphRunner::RunTask')) add('raster.busyMs', ms);
      if ((tn === 'VizCompositorThread' || tn === 'CrGpuMain') && (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask')) add(tn === 'CrGpuMain' ? 'gpu.busyMs' : 'viz.busyMs', ms);
      if (e.name === 'SkiaRenderer::DrawRenderPass' || e.name === 'DirectRenderer::DrawFrame' || e.name === 'Display::DrawAndSwap') add('viz.' + e.name.split('::').pop(), ms);
    }
    if (e.name === 'PipelineReporter' && e.ph === 'b') {
      const st = e.args?.chrome_frame_reporter?.state;
      if (st === 'STATE_PRESENTED_ALL') frames.presented++;
      else if (st === 'STATE_PRESENTED_PARTIAL') frames.partial++;
      else if (st === 'STATE_DROPPED') frames.dropped++;
    }
  }
  for (const k of Object.keys(sum)) sum[k] = Math.round(sum[k] * 10) / 10;
  return { frames, longTasks, longTaskMs: Math.round(longTaskMs), ...sum };
}

const results = [];
for (const route of ROUTES) {
  for (let run = 0; run < RUNS; run++) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'zh-CN',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36' });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await page.goto(BASE + route, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    const info = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, lg: document.querySelectorAll('.lg').length, lens: document.querySelectorAll('.lens').length,
      bf: [...document.querySelectorAll('*')].filter((e) => { const c = getComputedStyle(e); return c.backdropFilter && c.backdropFilter !== 'none'; }).length }));
    // ---- A. forced frames down the page
    const maxY = Math.min(info.h - 800, 6000);
    await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 10, clip: { x: 0, y: 0, width: 360, height: 800, scale: 0.25 } }); // warm-up
    await browser.startTracing(page, { categories: ['viz', 'gpu', 'cc', 'skia'] });
    let nfr = 0; const tA = performance.now();
    for (let y = 0; y <= maxY; y += 400) {
      await page.evaluate((y) => window.scrollTo(0, y), y);
      await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 10, clip: { x: 0, y, width: 360, height: 800, scale: 0.25 } });
      nfr++;
    }
    const wallA = performance.now() - tA;
    const evA = JSON.parse((await browser.stopTracing()).toString()).traceEvents;
    const sumA = (re) => evA.filter((e) => e.ph === 'X' && re.test(e.name)).reduce((a, e) => a + (e.dur || 0) / 1000, 0);
    const frameCost = { frames: nfr, wallPerFrameMs: +(wallA / nfr).toFixed(1), gpuSwapPerFrameMs: +(sumA(/^SkiaOutputSurfaceImplOnGpu::SwapBuffers$/) / nfr).toFixed(1), gpuFlushPerFrameMs: +(sumA(/^GrDrawingManager::flush$/) / nfr).toFixed(1) };
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    // ---- B. main thread during a touch scroll gesture
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    await page.evaluate(() => { window.__lt = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: 'longtask' }); } catch (e) {} window.__fi = []; let last = performance.now(); const f = (t) => { window.__fi.push(t - last); last = t; window.__raf = requestAnimationFrame(f); }; window.__raf = requestAnimationFrame(f); });
    await browser.startTracing(page, { categories: CATS });
    const dist = Math.min(info.h - 800, Number(process.env.GESTURE_PX || 3000));
    const t0 = Date.now();
    await cdp.send('Input.synthesizeScrollGesture', { x: 180, y: 600, yDistance: -dist, speed: 1600, gestureSourceType: 'touch', repeatCount: 1 });
    await cdp.send('Input.synthesizeScrollGesture', { x: 180, y: 200, yDistance: dist, speed: 1600, gestureSourceType: 'touch', repeatCount: 1 });
    const wall = Date.now() - t0;
    const buf = await browser.stopTracing();
    const { fi, lt } = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return { fi: window.__fi.slice(2), lt: window.__lt }; });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const a = analyse(JSON.parse(buf.toString()));
    const sorted = [...fi].sort((x, y) => x - y);
    const raf = { n: fi.length, over25: fi.filter((x) => x > 25).length, over50: fi.filter((x) => x > 50).length, p50: +(sorted[Math.floor(sorted.length * 0.5)] || 0).toFixed(1), p95: +(sorted[Math.floor(sorted.length * 0.95)] || 0).toFixed(1), max: +(sorted[sorted.length - 1] || 0).toFixed(1) };
    const r = { label: LABEL, route, run, page: info, frameCost, gesture: { scrollPx: dist * 2, wallMs: wall, raf, longTasks: lt.length, longTaskMs: Math.round(lt.reduce((x, y) => x + y, 0)), mainTaskMs: a['main.taskMs'], scrollListenerMs: a['main.scrollListener'] || 0, functionCallMs: a['main.FunctionCall'] || 0, commitMs: a['main.Commit'] || 0, prePaintMs: a['main.PrePaint'] || 0 } };
    results.push(r);
    console.log(JSON.stringify(r));
    await ctx.close();
  }
}
await browser.close();
server.close();
if (OUTFILE) await writeFile(OUTFILE, JSON.stringify({ label: LABEL, throttle: THROTTLE, ua: 'headless chromium 156, SwiftShader/software GL, 360x800 DPR3 touch emulation', results }, null, 2));
