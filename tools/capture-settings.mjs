/** 验证设置面板：首次登录自动弹出 + 各 Tab 渲染。用法: node capture-settings.mjs <base> <outDir> */
import { mkdirSync } from 'node:fs'
import { launchPage, settle } from './pw.mjs'

const BASE = process.argv[2] || 'http://localhost:18080'
const OUT = process.argv[3] || 'shots-verify'
mkdirSync(OUT, { recursive: true })

const { browser, page, errors } = await launchPage({ width: 1600, height: 1000 })
await page.goto(BASE + '/#/app/dashboard', { waitUntil: 'domcontentloaded' })
await settle(page, 1500)

// 1) 首次登录（无 talos.profile storage）：设置面板应自动弹出
const maskCount = await page.locator('.mask').count()
const panelText = maskCount ? await page.locator('.mask').first().textContent().catch(() => '') : ''
console.log(`[t] 首次登录自动弹出: ${maskCount > 0 ? 'YES' : 'NO'}` +
  (maskCount ? ` · 面板含「Coding Agent」:${panelText.includes('Coding Agent')}` : ''))
if (maskCount) await page.screenshot({ path: `${OUT}/10-settings-auto.png` })

// 2) 关闭后从右上角齿轮重开，逐 Tab 截图
if (maskCount) {
  const closeBtn = page.locator('.mask .modal-x, .mask [class*=close]').first()
  if (await closeBtn.count()) await closeBtn.click()
  else await page.keyboard.press('Escape')
  await settle(page, 400)
}
// 右上角齿轮按钮：Console 头部
const gear = page.locator('button:has(.icon), .top-acts button').last()
let opened = false
for (const sel of ['button[title*="设置"]', '.gear', 'header button:has(svg)']) {
  const loc = page.locator(sel)
  const n = await loc.count()
  for (let i = n - 1; i >= 0; i--) {
    try {
      await loc.nth(i).click({ timeout: 2000 })
      if (await page.locator('.mask').count()) { opened = true; break }
    } catch { /* 试下一个 */ }
  }
  if (opened) break
}
console.log(`[t] 齿轮重开面板: ${opened ? 'YES' : 'NO'}`)

if (opened) {
  for (const [i, t] of [['0', '外观'], ['1', '通用'], ['2', 'Coding Agent'], ['3', 'Git 凭据'], ['4', '工具链']]) {
    const tab = page.locator('.mask [class*=seg-i], .mask [class*=tab-i], .mask button').filter({ hasText: t }).first()
    try { await tab.click({ timeout: 3000 }) } catch { console.log(`[t] 找不到 Tab「${t}」`) }
    await settle(page, 400)
    await page.screenshot({ path: `${OUT}/1${i}-settings-tab${i}.png` })
  }
}

console.log(`[t] 控制台错误: ${errors.length ? errors.join(' | ') : '无'}`)
await browser.close()
console.log('[t] done')
