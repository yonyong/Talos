#!/usr/bin/env node
/** 验证：个人信息弹框新增「绑定客户端」（截图 + 绑定回读） */
import { mkdirSync } from 'node:fs'
import { launchPage, settle } from './pw.mjs'

const BASE = process.argv[2] || 'http://localhost:18080'
const OUT = 'shots-profile'
mkdirSync(OUT, { recursive: true })

const { browser, page, errors, netErrors } = await launchPage({ width: 1600, height: 1000 })

await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.setItem('talos.onboarded', '1'))
await settle(page, 1200)
// 登录（若在登录页）
const btn = page.locator('button:has-text("进入"), button:has-text("登录")').first()
if (await btn.count()) { await btn.click(); await settle(page, 1500) }
await settle(page, 800)

// 点左下角头像
await page.locator('.userchip').first().click()
await settle(page, 1500)
await page.screenshot({ path: `${OUT}/01-profile-modal.png`, fullPage: false })

// 断言：弹框里有「绑定客户端」字段
const label = await page.locator('.modal label:has-text("绑定客户端")').count()
console.log('绑定客户端字段存在:', label > 0 ? 'YES' : 'NO')

// 若有下拉，换选一个候选值再保存绑定（验证保存链路）
const sel = page.locator('.modal select').last()
if (await sel.count()) {
  const cur = await sel.inputValue()
  const opts = await sel.locator('option').allTextContents()
  console.log('候选客户端:', JSON.stringify(opts))
  // 选一个与当前不同的值（优先在线客户端，否则换「不绑定」）
  const values = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value))
  const pairs = opts.map((o, i) => ({ text: o, value: values[i] }))
  const online = pairs.find((p) => p.text.includes('在线') && p.value !== cur)
  const newVal = online ? online.value : (cur ? '' : null)
  if (newVal !== null && newVal !== undefined) {
    await sel.selectOption(newVal)
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${OUT}/02-selected.png` })
    await page.locator('.modal button:has-text("保存绑定")').click()
    await settle(page, 1500)
    await page.screenshot({ path: `${OUT}/03-after-save.png` })
    console.log('已换选并保存:', newVal === '' ? '（不绑定）' : newVal)
  } else {
    console.log('无可换选的候选值，跳过保存')
  }
}
console.log('页面错误:', errors.length ? errors.join(' | ') : '无')
console.log('接口错误:', netErrors.length ? netErrors.join(' | ') : '无')
await browser.close()
