#!/usr/bin/env node
/**
 * 回归验证：节点日志抽屉的「空态」提示是否说清了下一步
 *
 * 背景：节点卡在「已下发」时，抽屉里原来只有一句「该节点尚未回传日志」，
 * 客户端卡死 8 小时也照旧显示「进行中」，用户无法区分「正常在跑」和「已经失联」。
 * 现在空态按状态分词：waiting / dispatched（未超时、已超时）/ 机械节点各自不同。
 *
 * 用法：node tools/verify-node-empty-hint.mjs [base] [issueCode]
 *   base 默认 http://localhost:5173
 *
 * 手法：拦截 /api/workflows/instances/<code>/nodes，把「拉取 Git」改成不同状态与开始时间，
 * 直接读抽屉里的文案 —— 不用真把客户端搞挂。
 */
import { mkdirSync } from 'node:fs'
import { launchPage, settle } from './pw.mjs'

const BASE = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '')
const ISSUE = process.argv[3] || 'REQ-2251'
const OUT = 'shots-hint'
mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${extra ? `  — ${extra}` : ''}`)
}

const { browser, page, errors } = await launchPage({ width: 1500, height: 1000, dsf: 1 })
try {
  await page.addInitScript(() => localStorage.setItem('talos.onboarded', '1'))

  let patch = (nodes) => nodes
  await page.route('**/api/workflows/instances/*/nodes*', async (route) => {
    const resp = await route.fetch()
    const body = await resp.json()
    // 只改 step 1（拉取 Git），其余保持真实数据，抽屉靠 step 导航
    body.forEach((n) => {
      if (n.step === 1) Object.assign(n, patch())
    })
    await route.fulfill({ response: resp, json: body })
  })

  const open = async (step) => {
    // 同一个 hash 的 goto 不会重新挂载组件（数据是挂载时拉的），必须真 reload 才能吃到新的 mock
    await page.reload({ waitUntil: 'load', timeout: 30000 })
    await page.waitForSelector('.app', { timeout: 15000 })
    await settle(page, 900)
    const onboard = page.locator('.modal-h .iconbtn').first()
    if (await onboard.isVisible().catch(() => false)) { await onboard.click(); await settle(page, 300) }
    await page.locator('.timeline .tl', { hasText: step }).first().click()
    await settle(page, 600)
    return (await page.locator('pre.nodelog').first().innerText()).replace(/\s+/g, ' ').trim()
  }

  // 首次进入（登录 / 关向导 / 落到监控页），后续各例只 reload
  await page.goto(`${BASE}/#/app/monitor?issueCode=${ISSUE}`, { waitUntil: 'load', timeout: 30000 })
  await settle(page, 1000)
  if (await page.locator('.login-card').first().isVisible().catch(() => false)) {
    await page.locator('.login-card .btn-primary').first().click()
    await settle(page, 1200)
  }
  await page.waitForSelector('.app', { timeout: 15000 })
  await settle(page, 900)

  // 服务端下发的时间是「无时区的本地时间」（LocalDateTime.toString()），mock 必须同格式，
  // 否则 new Date() 按本地解析会凭空多出时区差（写 UTC 会算成 8 小时前）
  const mins = (m) => {
    const d = new Date(Date.now() - m * 60_000)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.000000`
  }

  // 1) waiting：讲清楚是在等前序节点
  patch = () => ({ status: 'waiting', execLog: null, startedAt: null, finishedAt: null, kind: 'doc' })
  const waiting = await open('拉取 Git')
  check('waiting：提示等待前序节点，不是笼统一句「尚未回传」',
    waiting.includes('尚未开始') && waiting.includes('前序节点'), waiting.slice(0, 90))

  // 2) dispatched 2 分钟（AI 节点阈值 25 分钟以内）：正常等待，不制造焦虑
  patch = () => ({ status: 'dispatched', execLog: null, startedAt: mins(2), finishedAt: null, kind: 'doc' })
  const fresh = await open('拉取 Git')
  check('dispatched 未超时：说明会自动刷新，不误报卡死',
    fresh.includes('已下发客户端执行') && fresh.includes('自动刷新') && !fresh.includes('⚠'), fresh.slice(0, 90))

  // 3) dispatched 40 分钟：给警告 + 两条可执行的处理路径
  patch = () => ({ status: 'dispatched', execLog: null, startedAt: mins(40), finishedAt: null, kind: 'doc' })
  const stuck = await open('拉取 Git')
  check('dispatched 超时：给出「取消实例→重新执行」的具体处理路径',
    stuck.includes('⚠') && stuck.includes('取消实例') && stuck.includes('客户端') && stuck.includes('不会自动重发'),
    stuck.slice(0, 140))
  await page.screenshot({ path: `${OUT}/01-stuck-hint.png` })

  // 4) 机械节点：不能再写「本地 CLI 的完整输出」（机械节点根本不调 CLI）
  patch = () => ({ status: 'dispatched', execLog: null, startedAt: mins(40), finishedAt: null, kind: 'git' })
  const mech = await open('拉取 Git')
  check('机械节点：文案讲仓库准备 trace，不提 CLI / 模型',
    mech.includes('不调用模型') && mech.includes('git 命令') && !mech.includes('CLI 的完整输出'),
    mech.slice(-90))

  await page.screenshot({ path: `${OUT}/02-mech-hint.png` })
  check('无控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

const bad = results.filter((x) => !x).length
console.log(`\n${results.length - bad}/${results.length} 通过`)
process.exit(bad === 0 ? 0 : 1)
