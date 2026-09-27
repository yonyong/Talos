#!/usr/bin/env node
/**
 * 客户端「查看日志」面板尺寸回归：切换 服务端事件 / 客户端日志 / AI 调用 三个 Tab 时，
 * 弹框与日志区高度必须保持不变（不得跳动）。
 *
 * 用法：
 *   NO_PROXY="*" NODE_PATH=C:/Users/yd236/.workbuddy/binaries/node/workspace/node_modules \
 *     node tools/verify-log-panel.mjs [base] [outDir]
 *
 * 默认 base = http://localhost:5173（vite dev）；截图输出 shots-logpanel/
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchPage } from './pw.mjs'

const base = process.argv[2] ?? 'http://localhost:5173'
const outDir = process.argv[3] ?? 'shots-logpanel'
mkdirSync(outDir, { recursive: true })

const TABS = ['服务端事件', 'AI 调用', '客户端日志', '服务端事件']
let browser
let pass = 0
let fail = 0

try {
  const { browser: b, page, errors } = await launchPage({ width: 1600, height: 1000, dsf: 1 })
  browser = b

  await page.goto(base, { waitUntil: 'load', timeout: 30000 })
  await page.locator('button:has-text("进入控制台")').first().click({ timeout: 15000 })
  await page.locator('.login-card .btn-primary').first().click({ timeout: 15000 })
  await page.waitForSelector('.app', { timeout: 20000 })
  await page.waitForTimeout(600)
  // 首次进入会弹「初始配置」向导，.mask 会拦截所有点击，必须先关掉
  const wizard = page.locator('button:has-text("完成并进入控制台")')
  if (await wizard.count()) {
    await wizard.first().click()
    await page.waitForTimeout(600)
    console.log('[logpanel] 已关闭初始配置向导')
  }

  await page.locator('.nav-i', { hasText: '客户端' }).first().click({ timeout: 15000 })
  await page.waitForTimeout(1200)

  const openBtn = page.locator('button:has-text("查看日志")').first()
  if (!(await openBtn.count())) {
    console.error('[logpanel] 客户端页没有「查看日志」按钮（可能没有接入的客户端），无法验证')
    process.exitCode = 1
  } else {
    await openBtn.click()
    await page.waitForSelector('.modal', { timeout: 10000 })
    await page.waitForTimeout(700)

    const measure = async () => page.evaluate(() => {
      const m = document.querySelector('.modal')
      const body = m.querySelector('.modal-b')
      const kids = [...body.children]
      const r = (el) => (el ? Math.round(el.getBoundingClientRect().height) : -1)
      return {
        modal: r(m),
        body: r(body),
        seg: r(kids[0]),
        box: r(kids[1]),
        hint: r(kids[2]),
      }
    })

    const seen = []
    for (const t of TABS) {
      await page.locator(`.modal .seg button:has-text("${t}")`).first().click()
      await page.waitForTimeout(500)
      const m = await measure()
      seen.push({ tab: t, ...m })
      const file = join(outDir, `logpanel-${TABS.indexOf(t)}-${t}.png`)
      await page.screenshot({ path: file })
      console.log(`[logpanel] ${t.padEnd(6)} modal=${m.modal} body=${m.body} seg=${m.seg} 日志区=${m.box} 提示行=${m.hint}  -> ${file}`)
    }

    const modals = [...new Set(seen.map((s) => s.modal))]
    const boxes = [...new Set(seen.map((s) => s.box))]
    const check = (name, arr) => {
      if (arr.length === 1) { pass++; console.log(`[logpanel] ✓ ${name}在 Tab 切换时保持不变（${arr[0]}px）`) }
      else { fail++; console.error(`[logpanel] ✗ ${name}随 Tab 变化：${arr.join(' / ')}px`) }
    }
    check('弹框高度', modals)
    check('日志区高度', boxes)

    // 空态与有内容态也不能撑爆
    const overflow = seen.filter((s) => s.modal > 940)
    if (overflow.length) { fail++; console.error('[logpanel] ✗ 弹框高度超出 94vh 上限') }
    else { pass++; console.log('[logpanel] ✓ 弹框未超出视口上限') }

    if (errors.length) console.log(`[logpanel] 控制台错误 ${errors.length} 条：${errors.slice(0, 5).join(' | ')}`)
  }
} catch (e) {
  fail++
  console.error('[logpanel] 致命错误: ' + (e?.message ?? e))
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
}
console.log(`[logpanel] 完成：通过 ${pass} / 失败 ${fail}`)
if (fail) process.exitCode = 1
