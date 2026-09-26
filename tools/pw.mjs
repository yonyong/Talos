/**
 * Playwright 加载与 Chromium 定位的公共模块（Talos 截图工具共用）
 *
 * 本机 ms-playwright 缓存里的 Chromium 版本与全局 playwright-core 期望的
 * revision 不一致（缓存 1223/1234，playwright-core 1.63 期望 1243）。
 * 用 executablePath 显式指定即可跳过版本校验，无需再下载浏览器。
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

const PW_CANDIDATES = [
  process.env.NODE_PATH,
  'C:/Users/yd236/.workbuddy/binaries/node/workspace/node_modules',
  'C:/Users/yd236/.workbuddy/binaries/node/versions/22.22.2-3/node_modules',
]

const CHROMIUM_CANDIDATES = [
  'C:/Users/yd236/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  'C:/Users/yd236/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
]

/** 解析 playwright-core，返回 { chromium, via } */
export function loadPlaywright() {
  for (const base of PW_CANDIDATES) {
    if (!base) continue
    try {
      const mod = require(join(base, 'playwright-core'))
      return { chromium: mod.chromium, via: join(base, 'playwright-core') }
    } catch { /* 试下一个 */ }
  }
  throw new Error('找不到 playwright-core，请设置 NODE_PATH 指向含它的 node_modules')
}

/** 定位本机已缓存的 Chromium */
export function findChromium() {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) return process.env.CHROMIUM_EXECUTABLE_PATH
  for (const p of CHROMIUM_CANDIDATES) if (existsSync(p)) return p
  return undefined
}

/** 启动一个 headless 浏览器 + 页面上下文，返回 { browser, ctx, page, errors } */
export async function launchPage({ width = 1600, height = 1000, dsf = 2 } = {}) {
  const { chromium, via } = loadPlaywright()
  const exe = findChromium()
  if (!exe) throw new Error('未找到 Chromium，可用 CHROMIUM_EXECUTABLE_PATH 指定')
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    chromiumSandbox: false,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars'],
  })
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dsf,
    ignoreHTTPSErrors: true,
  })
  const page = await ctx.newPage()
  const errors = []
  const netErrors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('response', (r) => { if (r.status() >= 400) netErrors.push(`${r.status()} ${r.url()}`) })
  return { browser, ctx, page, errors, netErrors, chromiumPath: exe, playwrightPath: via }
}

/** 等待页面尽量静态（SPA 可能永不 networkidle，超时就放行） */
export async function settle(page, ms = 800) {
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }) } catch { /* ignore */ }
  if (ms) await page.waitForTimeout(ms)
}
