#!/usr/bin/env node
/** 验证 Coding Agent 配置弹窗：模型 / execPath 可编辑（修复 transport 大小写 bug 后） */
import { launchPage } from './pw.mjs'

const { browser, page } = await launchPage({ width: 1600, height: 1000 })
await page.goto('http://localhost:8080/#/app/agents', { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(2000)

// 首次进入会自动弹「初始配置」向导，先关掉再操作
const wizard = page.locator('button:has-text("完成并进入控制台")')
if (await wizard.count()) await wizard.click()

await page.locator('tr', { hasText: 'claude' }).first().locator('button:has-text("配置")').click()
await page.waitForTimeout(500)

const inputs = page.locator('.modal input')
const modelRo = (await inputs.nth(0).getAttribute('readonly')) !== null
const execDisabled = await inputs.nth(1).isDisabled()
console.log('model readOnly =', modelRo, '| value =', await inputs.nth(0).inputValue())
console.log('execPath disabled =', execDisabled, '| value =', await inputs.nth(1).inputValue())
await inputs.nth(0).fill('claude-sonnet-4-5')
await inputs.nth(1).fill('D:/tools/claude.exe')
await page.screenshot({ path: '../shots-fix/08-agents-modal.png' })
console.log('screenshot saved')
await browser.close()
process.exit(0)
