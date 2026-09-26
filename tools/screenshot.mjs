#!/usr/bin/env node
/**
 * Talos 前端截图工具（单页）
 *
 * 用本机已缓存的 Chromium（executablePath 指定），不下载 Playwright 自带浏览器。
 *
 * 用法：
 *   node tools/screenshot.mjs <url> <out.png> [options]
 *
 * 选项：
 *   --full              整页截图（默认只截视口）
 *   --width  <n>        视口宽（默认 1600）
 *   --height <n>        视口高（默认 1000）
 *   --wait   <ms>       截图前额外等待毫秒（默认 1200）
 *   --selector <css>    额外等待该选择器出现
 *   --click  <css>      截图前点击某元素（可重复，按顺序执行；支持 text=文案）
 *   --timeout <ms>      导航超时（默认 30000）
 *
 * 需要 NODE_PATH 指向包含 playwright-core 的目录，例如：
 *   NODE_PATH="C:/Users/yd236/.workbuddy/binaries/node/workspace/node_modules"
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { launchPage } from './pw.mjs'

const argv = process.argv.slice(2)
if (argv.length < 2) {
  console.error('用法: node tools/screenshot.mjs <url> <out.png> [--full] [--width n] [--height n] [--wait ms] [--selector css] [--click css] [--timeout ms]')
  process.exit(2)
}
const url = argv[0]
const out = argv[1]
const opt = { full: false, width: 1600, height: 1000, wait: 1200, timeout: 30000, selector: null, clicks: [] }
for (let i = 2; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--full') opt.full = true
  else if (a === '--width') opt.width = +argv[++i]
  else if (a === '--height') opt.height = +argv[++i]
  else if (a === '--wait') opt.wait = +argv[++i]
  else if (a === '--selector') opt.selector = argv[++i]
  else if (a === '--click') opt.clicks.push(argv[++i])
  else if (a === '--timeout') opt.timeout = +argv[++i]
}

const outDir = dirname(out)
if (outDir && !existsSync(outDir)) mkdirSync(outDir, { recursive: true })

let browser
try {
  const { browser: b, page, errors, netErrors, chromiumPath, playwrightPath } = await launchPage({ width: opt.width, height: opt.height })
  browser = b
  console.log(`[shot] playwright-core: ${playwrightPath}`)
  console.log(`[shot] chromium: ${chromiumPath}`)

  const resp = await page.goto(url, { waitUntil: 'load', timeout: opt.timeout })
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }) } catch { /* SPA 可能永不 idle */ }

  if (opt.selector) await page.waitForSelector(opt.selector, { timeout: opt.timeout })
  for (const c of opt.clicks) {
    await page.click(c, { timeout: opt.timeout })
    await page.waitForTimeout(400)
  }
  if (opt.wait) await page.waitForTimeout(opt.wait)

  await page.screenshot({ path: out, fullPage: opt.full })

  console.log(`[shot] OK  ${url}  ->  ${out}  (HTTP ${resp ? resp.status() : 'n/a'})`)
  if (netErrors.length) {
    console.log(`[shot] HTTP >=400 的请求 ${netErrors.length} 条：`)
    for (const e of [...new Set(netErrors)].slice(0, 10)) console.log('   - ' + e.slice(0, 200))
  }
  if (errors.length) {
    console.log(`[shot] 页面控制台错误 ${errors.length} 条：`)
    for (const e of errors.slice(0, 10)) console.log('   - ' + e.slice(0, 200))
  } else {
    console.log('[shot] 无控制台错误')
  }
} catch (e) {
  console.error('[shot] 失败: ' + (e && e.message ? e.message : e))
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
}
