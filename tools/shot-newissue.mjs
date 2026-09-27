#!/usr/bin/env node
// 新建 Issue 向导截图：step0 业务域说明间距 + step2 期望完成时间快速选择
import { launchPage } from './pw.mjs'

const base = process.argv[2] ?? 'http://localhost:5173'

const { browser, page } = await launchPage()
await page.setViewportSize({ width: 1440, height: 900 })
// 跳过「初始配置」向导（标记落 localStorage），比点按钮更安全：不触碰服务端配置
await page.addInitScript(() => localStorage.setItem('talos.onboarded', '1'))
await page.goto(base + '/#/app/issues', { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(1500)

await page.getByText('新建 Issue', { exact: true }).first().click()
await page.waitForTimeout(800)
await page.screenshot({ path: 'shots-newissue/step0-biz.png', fullPage: false })

// 到第 3 步：指派时限
await page.getByRole('button', { name: '下一步' }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: '下一步' }).click()
await page.waitForTimeout(800)
await page.screenshot({ path: 'shots-newissue/step2-due.png', fullPage: false })
console.log('[shot] shots-newissue/step0-biz.png shots-newissue/step2-due.png')
await browser.close()
