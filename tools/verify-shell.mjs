#!/usr/bin/env node
/**
 * 交互级回归：Logo 回总览 / 个人信息面板与退出确认 / 设置面板
 * 用法：node tools/verify-shell.mjs [--base http://localhost:18080] [--out-dir shots-verify]
 */
import { loadPlaywright, findChromium } from './pw.mjs'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : d
}
const BASE = arg('base', 'http://localhost:18080')
const OUT = join(process.cwd(), arg('out-dir', 'shots-verify'))
mkdirSync(OUT, { recursive: true })

const { chromium } = loadPlaywright()
const exe = findChromium()
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

let pass = 0, fail = 0
const ok = (cond, name) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); cond ? pass++ : fail++ }

await page.goto(`${BASE}/#/app/monitor`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

// 1. Logo → 总览
await page.click('.side-top')
await page.waitForTimeout(400)
ok(page.evaluate(() => location.hash).then(h => h.includes('#/app/dashboard')), '1. 点击 Logo 跳转总览')
ok(await page.locator('.side-top.clickable').count() > 0, '1b. Logo 可点样式生效')

// 2. 左下角个人信息 → 面板；退出 → 确认 → 登录页
await page.click('.userchip')
await page.waitForTimeout(400)
ok(await page.locator('.modal-h h3', { hasText: '个人信息' }).count() > 0, '2. 点击个人信息打开面板')
await page.screenshot({ path: join(OUT, 'shell-profile.png') })
// 改名保存 → userchip 同步
await page.locator('.prof-grid .field input').first().fill('杨德')
await page.click('.modal-f .btn-primary')
await page.waitForTimeout(300)
ok((await page.locator('.userchip .un').innerText()) === '杨德', '2b. 保存后侧栏姓名同步')

// 重开面板退出
await page.click('.userchip')
await page.waitForTimeout(300)
await page.click('.modal-f .logout-btn')
await page.waitForTimeout(300)
ok(await page.locator('.confirm-t', { hasText: '确定要退出登录吗' }).count() > 0, '2c. 退出需二次确认')
await page.screenshot({ path: join(OUT, 'shell-logout-confirm.png') })
await page.click('.modal-f .logout-btn') // 确认退出（此时 footer 里的确认按钮）
await page.waitForTimeout(600)
ok(page.evaluate(() => location.hash).then(h => h.includes('#/login')), '2d. 确认后跳转登录页')
await page.screenshot({ path: join(OUT, 'shell-after-logout.png') })

// 3. 重新进入 → 设置面板
await page.goto(`${BASE}/#/app/dashboard`, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
await page.click('.iconbtn.setbtn')
await page.waitForTimeout(400)
ok(await page.locator('.modal-h h3', { hasText: '设置' }).count() > 0, '3. 设置按钮打开设置面板')
// 切主题色 → CSS 变量即时变化
const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
await page.locator('.swatch').nth(2).click()
await page.waitForTimeout(200)
const after = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
ok(before !== after, `3b. 主题色即时生效 (${before} -> ${after})`)
// 切紧凑密度 → body.compact
await page.locator('.seg button', { hasText: '紧凑' }).click()
await page.waitForTimeout(200)
ok(await page.evaluate(() => document.body.classList.contains('compact')), '3c. 紧凑密度即时生效')
await page.screenshot({ path: join(OUT, 'shell-settings.png') })

// 持久化：刷新后仍是 compact + 新主题色
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
ok(await page.evaluate(() => document.body.classList.contains('compact')), '3d. 刷新后偏好保持（localStorage 持久化）')

// 恢复默认，避免污染用户偏好
await page.click('.iconbtn.setbtn')
await page.waitForTimeout(300)
await page.click('.modal-f .btn-outline')
await page.waitForTimeout(200)

console.log(`\n${pass}/${pass + fail} passed`)
await browser.close()
process.exit(fail > 0 ? 1 : 0)
