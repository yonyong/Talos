// 验证 Issue 页「新建 Issue」按钮在空列表下能弹出向导弹窗
// 用法：node tools/verify-issue-new-btn.mjs [base] [shot]
import { loadPlaywright, findChromium } from './pw.mjs'

const base = process.argv[2] || 'http://localhost:18080'
const shot = process.argv[3] || 'shots-verify/issue-new-btn.png'

const { chromium } = loadPlaywright()
const browser = await chromium.launch({ executablePath: findChromium() })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

// 在任何页面脚本执行前预置 onboarding 标记，避免首次访问的设置面板遮罩干扰
await page.addInitScript(() => localStorage.setItem('talos.onboarded', '1'))
await page.goto(`${base}/#/app/issues`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

const btn = page.locator('button:has-text("新建 Issue")')
console.log('button visible:', await btn.isVisible())

await btn.click()
await page.waitForTimeout(500)

const modal = page.locator('.modal:has-text("新建 Issue")')
const modalVisible = await modal.isVisible()
const wizSteps = await page.locator('.wiz-steps .ws').count()
console.log('modal visible:', modalVisible)
console.log('wizard steps:', wizSteps)

await page.screenshot({ path: shot })

console.log('page errors:', errors.length ? errors : 'none')
await browser.close()
process.exit(modalVisible && wizSteps === 4 ? 0 : 1)
