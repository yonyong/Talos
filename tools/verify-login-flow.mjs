/**
 * 登录（邮箱 + 邮件授权码）流程回归 —— 三段式，任一段可单独跑。
 *
 * 控制台登录需要「邮箱 + 邮件里的授权码」，脚本读不到收件箱，所以拆成两段：
 *
 *   PHASE=send  EMAIL=<邮箱> node tools/verify-login-flow.mjs <base>
 *       走官网 -> 登录页，填邮箱 -> 发授权码 -> 进第二步；截图 01/02，并打印 send-code 响应。
 *
 *   PHASE=verify EMAIL=<邮箱> CODE=<从邮箱取到的码> [WRONG_CODE=xxxxxxxx] node tools/verify-login-flow.mjs <base>
 *       填码登录：先验「粘贴整封邮件自动取数字」，再验错误码就地报错且留在第二步，
 *       然后正确码登录 -> 断言进控制台 + 左下角是真实登录身份 + localStorage 凭据落盘
 *       -> 点「退出登录」走二次确认 -> 断言回登录页且凭据清空。
 *
 *   PHASE=guard node tools/verify-login-flow.mjs <base>
 *       冷加载守卫（不需要邮箱）：① 无 token 深链 #/app/dashboard 应退回登录页；
 *       ② 本地有失效 token 时应打一次 /api/auth/me 拿到 401、清掉凭据并退回登录页。
 *
 * 需要 NODE_PATH 指向含 playwright-core 的目录；取授权码可用 qq-email skill 的 receive.js。
 */
import { mkdirSync } from 'node:fs'
import { launchPage, settle } from './pw.mjs'

const BASE = process.argv[2] || 'http://127.0.0.1:28080'
const OUT = 'shots-auth'
const PHASE = process.env.PHASE || 'send'
const CODE = process.env.CODE || ''
const EMAIL = process.env.EMAIL || ''

mkdirSync(OUT, { recursive: true })

const { browser, ctx, page, errors, netErrors, chromiumPath } = await launchPage({ width: 1440, height: 900 })
// 跳过控制台首次进入的「初始配置」向导：它只在隔离实例首次进控制台时弹，遮罩会挡住后续断言
await page.addInitScript(() => localStorage.setItem('talos.onboarded', '1'))
console.log(`[ui] chromium: ${chromiumPath}`)
console.log(`[ui] base: ${BASE}  phase: ${PHASE}`)

let sendResponse = null
page.on('response', async (r) => {
  if (r.url().includes('/api/auth/send-code') || r.url().includes('/api/auth/verify')) {
    try { sendResponse = { url: r.url().split('/api')[1], status: r.status(), body: await r.json() } } catch { /* ignore */ }
  }
})

/** 走官网 -> 登录页（与真实用户路径一致） */
async function gotoLogin() {
  await page.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await page.locator('button:has-text("进入控制台")').first().click({ timeout: 15000 })
  await page.waitForSelector('.login-card', { timeout: 15000 })
  await settle(page, 400)
}

if (PHASE === 'send') {
  await gotoLogin()
  await page.screenshot({ path: `${OUT}/01-login-email.png` })
  console.log('[ui] 步骤一截图完成')

  await page.locator('.login-card input').first().fill(EMAIL)
  await page.locator('.login-card .btn-primary').first().click()
  await page.waitForSelector('.code-input', { timeout: 20000 })
  await settle(page, 600)
  await page.screenshot({ path: `${OUT}/02-login-code.png` })
  console.log('[ui] 步骤二截图完成')
  console.log('[ui] send-code 响应:', JSON.stringify(sendResponse))
  const sub = await page.locator('.login-card .sub').first().innerText()
  const btn = await page.locator('.login-card .btn-outline').first().innerText()
  console.log('[ui] 提示文案:', sub.replace(/\s+/g, ' '))
  console.log('[ui] 重发按钮:', btn.trim())
  const max = await page.locator('.code-input').getAttribute('maxlength')
  console.log('[ui] 授权码输入框 maxlength =', max)
} else if (PHASE === 'verify') {
  await gotoLogin()
  await page.locator('.login-card input').first().fill(EMAIL)
  await page.locator('.login-card .btn-primary').first().click()
  await page.waitForSelector('.code-input', { timeout: 20000 })
  console.log('[ui] send-code 响应:', JSON.stringify(sendResponse))

  // 顺带验「粘贴整封邮件自动取数字」
  await page.locator('.code-input').fill('')
  await page.locator('.code-input').focus()
  await page.evaluate((code) => {
    const el = document.querySelector('.code-input')
    const dt = new DataTransfer()
    dt.setData('text', `你好，你的 Talos 登录授权码是 ${code}，3 分钟内有效。`)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, CODE)
  const pasted = await page.locator('.code-input').inputValue()
  console.log(`[ui] 粘贴整封邮件 -> 输入框内容 "${pasted}" (期望 ${CODE})`)

  // 先验错误码被拒（不清空邮箱、留在第二步）
  if (process.env.WRONG_CODE) {
    await page.locator('.code-input').fill(process.env.WRONG_CODE)
    await page.locator('.login-card .btn-primary').first().click()
    await page.waitForSelector('.field-err', { timeout: 15000 })
    console.log('[ui] 错误码提示:', (await page.locator('.field-err').innerText()).trim())
    await page.screenshot({ path: `${OUT}/03-login-wrong-code.png` })
    console.log('[ui] 仍在第二步:', await page.locator('.code-input').isVisible())
  }

  await page.locator('.code-input').fill(CODE)
  await page.locator('.login-card .btn-primary').first().click()
  await page.waitForSelector('.app', { timeout: 25000 })
  await settle(page, 1200)
  console.log('[ui] 登录成功，hash =', await page.evaluate(() => location.hash))
  console.log('[ui] verify 响应:', JSON.stringify(sendResponse))
  const who = await page.locator('.userchip .un, .userchip .ur').allInnerTexts().catch(() => [])
  console.log('[ui] 左下角用户:', who.join(' / '))
  const store = await page.evaluate(() => ({
    token: !!localStorage.getItem('talos.token'),
    user: localStorage.getItem('talos.user'),
    profile: localStorage.getItem('talos.profile'),
  }))
  console.log('[ui] localStorage:', JSON.stringify(store))
  await page.screenshot({ path: `${OUT}/04-console-after-login.png` })

  // 退出登录：左下角 ↪ -> 二次确认 -> 服务端注销会话 + 回登录页 + 清本地凭据
  const beforeLogout = netErrors.length
  await page.locator('.side-user-acts .side-ic.danger').first().click()
  await page.waitForSelector('.modal', { timeout: 10000 })
  await page.screenshot({ path: `${OUT}/04b-logout-confirm.png` })
  await page.locator('.modal .logout-cta').first().click()
  await page.waitForSelector('.login-card', { timeout: 15000 })
  await settle(page, 500)
  console.log('[ui] 退出登录 -> hash =', await page.evaluate(() => location.hash))
  const after = await page.evaluate(() => ({
    token: localStorage.getItem('talos.token'),
    user: localStorage.getItem('talos.user'),
  }))
  console.log('[ui] 退出后本地凭据已清空:', after.token === null && after.user === null)
  console.log(`[ui] 退出阶段 HTTP>=400 = ${netErrors.length - beforeLogout}（预期 0）`)
  await page.screenshot({ path: `${OUT}/04c-after-logout.png` })
}

// 未登录/令牌失效时的冷加载守卫（不需要邮箱，独立成 phase）
if (PHASE === 'guard') {
  // ① 从未登录过：冷加载深链控制台（先落同源首页，再经 about:blank 触发真正的文档加载 ——
  //    goto 只改 hash 是 same-document 导航，不会重跑启动校验）
  await page.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await page.goto('about:blank')
  await page.goto(`${BASE}/#/app/dashboard`, { waitUntil: 'load', timeout: 30000 })
  await page.waitForSelector('.login-card', { timeout: 15000 })
  console.log('[ui] ① 无 token 冷加载 #/app/dashboard -> hash =', await page.evaluate(() => location.hash))
  await settle(page, 300)
  await page.screenshot({ path: `${OUT}/05-guard-no-token.png` })

  // ② 本地有 token 但服务端已失效（服务端重启 / 会话过期后的真实状态）
  await page.evaluate(() => {
    localStorage.setItem('talos.token', 'stale-token-for-guard-test')
    localStorage.setItem('talos.user', JSON.stringify({ empNo: '24988', name: '杨德', role: 'admin', email: '' }))
  })
  const before = netErrors.length
  await page.goto('about:blank')
  await page.goto(`${BASE}/#/app/dashboard`, { waitUntil: 'load', timeout: 30000 })
  await page.waitForSelector('.login-card', { timeout: 15000 })
  console.log('[ui] ② 失效 token 冷加载控制台 -> hash =', await page.evaluate(() => location.hash))
  console.log(`[ui] ② 期间 HTTP>=400 = ${netErrors.length - before}（预期 1：/api/auth/me 401）`)
  console.log('[ui] ② 失效 token 是否已被清掉:', (await page.evaluate(() => localStorage.getItem('talos.token'))) === null)
  await settle(page, 300)
  await page.screenshot({ path: `${OUT}/06-guard-stale-token.png` })
}

const unexpected = netErrors.filter((e) => {
  // 守卫阶段那条 /api/auth/me 的 401 是刻意造出来的
  if (PHASE !== 'send' && e.startsWith('401') && e.includes('/api/auth/me')) return false
  return true
})
console.log(`[ui] 控制台错误 ${errors.length} 条；HTTP>=400 共 ${netErrors.length} 条，其中非预期 ${unexpected.length} 条`)
if (errors.length) console.log('[ui] 错误明细:', errors.slice(0, 5))
if (unexpected.length) console.log('[ui] 非预期请求:', unexpected.slice(0, 5))

await ctx.close()
await browser.close()
