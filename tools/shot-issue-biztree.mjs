#!/usr/bin/env node
/**
 * 新建 Issue · 业务域树形选择器截图
 *
 * 用法：
 *   NO_PROXY="*" NODE_PATH=<含 playwright-core 的 node_modules> \
 *     node tools/shot-issue-biztree.mjs [--base http://localhost:5173] [--out shots-biztree]
 *
 * 输出两张：01-picker-open.png（面板展开）、02-picker-picked.png（选中某业务域后）
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchPage, settle } from './pw.mjs'

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const base = arg('base', 'http://localhost:5173')
const out = arg('out', 'shots-biztree')
mkdirSync(out, { recursive: true })

const { browser, page, errors } = await launchPage({ width: 1440, height: 900 })
await page.addInitScript(() => localStorage.setItem('talos.onboarded', '1'))
await page.goto(`${base}/#/app/issues`, { waitUntil: 'domcontentloaded' })
await settle(page, 1500)

await page.getByRole('button', { name: /新建 Issue/ }).click()
await page.waitForTimeout(600)

// 业务域触发器（未选时显示「自动分拣（按标题与描述判定）」）
const trigger = page.locator('[data-picker="biz"]')
await trigger.click()
await page.waitForTimeout(500)
await page.screenshot({ path: join(out, '01-picker-open.png') })

// 选中第 2 个业务域节点（默认全展开，无需先点展开箭头）
const rows = page.locator('[data-biz]:not([data-biz=""])')
console.log('业务域节点行数:', await rows.count())
await rows.nth(1).click()
await page.waitForTimeout(500)
await trigger.click()  // 重新展开，便于看选中态
await page.waitForTimeout(400)
await page.screenshot({ path: join(out, '02-picker-picked.png') })

console.log('console errors:', errors.length ? errors : 'none')
await browser.close()
