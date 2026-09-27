/**
 * 一次性验证脚本：隔离实例监控页截图（含「初始配置」向导处理 + 启动前阶段条）
 * 用法: NODE_PATH=... node tools/shot-prephase.mjs [base] [outfile]
 */
import { launchPage, settle } from './pw.mjs'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const base = process.argv[2] ?? 'http://localhost:18080'
const out = process.argv[3] ?? 'shots-prephase/monitor-prephase.png'
mkdirSync(dirname(out), { recursive: true })

const { browser, page, errors } = await launchPage({ width: 1600, height: 1000 })
try {
  await page.goto(base, { waitUntil: 'load', timeout: 30000 })
  await page.locator('button:has-text("进入控制台")').first().click({ timeout: 15000 })
  await page.locator('.login-card .btn-primary').first().click({ timeout: 15000 })
  await page.waitForSelector('.app', { timeout: 20000 })

  // 首次进入会弹「初始配置」向导，挡住所有点击 → 直接完成
  const doneBtn = page.locator('button:has-text("完成并进入控制台")').first()
  if (await doneBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await doneBtn.click()
    console.log('[shot] 已完成初始配置向导')
  }
  await settle(page, 600)

  // 直接走 hash 路由到作业监控
  await page.goto(`${base}/#/app/monitor`, { waitUntil: 'load' })
  await settle(page, 1500)

  // 可选：点名要看的实例（左侧列表按实例号点击）
  const inst = process.argv[4]
  if (inst) {
    await page.locator(`.mon-item:has-text("${inst}")`).first().click({ timeout: 10000 })
    await settle(page, 1200)
  }

  await page.screenshot({ path: out, fullPage: false })
  console.log('[shot] saved:', out)
  if (errors.length) console.log('[shot] console errors:', errors.slice(0, 5))
} finally {
  await browser.close()
}
