#!/usr/bin/env node
/**
 * 作业监控页「后台定时刷新」回归。
 *
 * 验的是五件事：
 *   1. 页面按头部声称的节拍自己打接口（不需要用户点任何东西），节奏随忙碌程度自适应
 *   2. 每一拍把 实例列表 / 节点 / 拓扑 三个接口一起拉（只刷列表的话节点进度和 DAG 状态是旧的）
 *   3. 「更新于 HH:MM:SS」跟着走；点「自动刷新」能暂停（停表后不再发请求），再点恢复
 *   4. 刷新不打断用户 —— 手动切走的实例不被下钻参数拽回、选中的节点不被重置、日志抽屉不关
 *   5. 标签页切到后台暂停、切回前台立即补刷
 *
 * 用法：
 *   NO_PROXY="*" NODE_PATH=C:/Users/yd236/.workbuddy/binaries/node/workspace/node_modules \
 *     node tools/verify-monitor-poll.mjs [base] [outDir]
 *
 * 默认 base = http://localhost:5173（vite dev）；截图输出 shots-monpoll/
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchPage } from './pw.mjs'

const base = process.argv[2] ?? 'http://localhost:5173'
const outDir = process.argv[3] ?? 'shots-monpoll'
mkdirSync(outDir, { recursive: true })

let browser
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

try {
  const { browser: b, page, errors } = await launchPage({ width: 1600, height: 1000, dsf: 1 })
  browser = b

  /**
   * 记录轮询请求。
   * ⚠ 只把「实例列表」端点当节拍证据：节点 /workflows/instances/{code}/nodes 与 /graph
   *   的 URL 同样含 /workflows/instances，用 includes 会把一次 tick 数成 3 次。
   */
  const LIST_RE = /\/api\/workflows\/instances(\?|$)/
  const hits = []      // 列表端点 = 一条轮询节拍的证据
  const allHits = []   // 列表 + 节点 + 拓扑 = 一次 refresh 是否全套拉齐
  page.on('request', (r) => {
    const u = r.url()
    if (!u.includes('/api/workflows/instances')) return
    allHits.push(u)
    if (LIST_RE.test(u)) hits.push(Date.now())
  })

  await page.goto(base, { waitUntil: 'load', timeout: 30000 })
  await page.locator('button:has-text("进入控制台")').first().click({ timeout: 15000 })
  await page.locator('.login-card .btn-primary').first().click({ timeout: 15000 })
  await page.waitForSelector('.app', { timeout: 20000 })
  await page.waitForTimeout(600)
  const wizard = page.locator('button:has-text("完成并进入控制台")')
  if (await wizard.count()) {
    await wizard.first().click()
    await page.waitForTimeout(600)
    console.log('[monpoll] 已关闭初始配置向导')
  }

  await page.locator('.nav-i', { hasText: '作业监控' }).first().click({ timeout: 15000 })
  await page.waitForTimeout(1500)

  const chipText = async () => (await page.locator('.mon-chip.mon-live').first().innerText()).trim()
  const refreshChipText = async () => (await page.locator('.mon-chip').nth(1).innerText()).trim()
  const selCode = async () => page.evaluate(() => document.querySelector('.mon-item.on .mi-code')?.textContent ?? null)

  console.log('\n[1] 后台自发刷新 + 节拍自适应')
  const label = await chipText()
  const cadence = Number((label.match(/(\d+)s/) ?? [])[1] ?? 0)
  check('自动刷新开关默认开启', label.includes('自动刷新') && cadence > 0, label)

  // 窗口取「两拍多」，让至少能观察到一次间隔
  const waitMs = Math.min(cadence * 2000 + 4000, 48000)
  hits.length = 0
  allHits.length = 0
  const t0 = Date.now()
  await page.waitForTimeout(waitMs)
  const stamps = hits.map((t) => `${((t - t0) / 1000).toFixed(1)}s`)
  check(`后台自发刷新（窗口 ${(waitMs / 1000).toFixed(0)}s · 声称节拍 ${cadence}s · 命中 ${hits.length} 拍）`,
    hits.length >= 1, stamps.join(', ') || '零请求')
  if (hits.length >= 2) {
    const gap = (hits[1] - hits[0]) / 1000
    check('实测间隔与声称节拍一致', Math.abs(gap - cadence) <= 2, `期望 ~${cadence}s，实测 ${gap.toFixed(1)}s`)
  }
  check('每拍拉齐 列表 + 节点 + 拓扑', allHits.length >= hits.length * 3, `${hits.length} 拍 / ${allHits.length} 请求`)
  await page.screenshot({ path: join(outDir, '01-live.png'), fullPage: false })

  console.log('\n[2] 更新时刻是否跟着走')
  const stamp1 = await refreshChipText()
  await page.waitForTimeout(cadence * 1000 + 1500)
  const stamp2 = await refreshChipText()
  check('「更新于」时间戳前进', stamp1 !== stamp2 && /更新于/.test(stamp2), `${stamp1} → ${stamp2}`)

  console.log('\n[3] 暂停 / 恢复')
  await page.locator('.mon-chip.mon-live').first().click()
  await page.waitForTimeout(400)
  check('点击后显示已暂停', (await chipText()).includes('已暂停'), await chipText())
  hits.length = 0
  await page.waitForTimeout(cadence * 1000 + 3000)
  check('暂停期间不再发请求', hits.length === 0, `${hits.length} 拍`)
  await page.screenshot({ path: join(outDir, '02-paused.png'), fullPage: false })

  await page.locator('.mon-chip.mon-live').first().click()
  await page.waitForTimeout(400)
  check('再点恢复自动刷新', (await chipText()).includes('自动刷新'), await chipText())

  console.log('\n[4] 刷新不打断用户操作')
  const items = page.locator('.mon-item')
  const n = await items.count()
  if (n >= 2) {
    const before = await selCode()
    await items.nth(1).click()
    await page.waitForTimeout(500)
    const picked = await selCode()
    check('可手动切换到另一个实例', !!picked, `${before} → ${picked}`)
    await page.waitForTimeout(cadence * 2000 + 2000) // 跨过两拍
    const after = await selCode()
    check('两拍刷新后仍停在手选的实例', after === picked, `期望 ${picked}，实际 ${after}`)
  } else {
    console.log(`  ⏭  只有 ${n} 个实例，跳过选择保持校验`)
  }

  const tl = page.locator('.tl.clickable').first()
  if (await tl.count()) {
    await tl.click()
    await page.waitForSelector('.drawer', { timeout: 8000 })
    await page.waitForTimeout(cadence * 2000 + 1000)
    check('日志抽屉在两拍刷新后仍打开', (await page.locator('.drawer').count()) > 0)
    await page.screenshot({ path: join(outDir, '03-drawer.png'), fullPage: false })
  }

  console.log('\n[5] 标签页切到后台的表现')
  // headless 里 document.hidden 恒为 false，这里只读属性打桩来模拟切后台
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  hits.length = 0
  await page.waitForTimeout(cadence * 1000 + 3000)
  check('后台期间不发请求（省掉看不见的刷新）', hits.length === 0, `${hits.length} 拍`)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(1500)
  check('切回前台立即补刷（不用等下一拍）', hits.length >= 1, `${hits.length} 拍`)

  console.log('\n[6] 控制台错误')
  check('无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | ') || '干净')
  await page.screenshot({ path: join(outDir, '04-final.png'), fullPage: false })
} catch (e) {
  console.error('[monpoll] 异常：', e)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
}

const bad = results.filter((r) => !r.ok)
console.log(`\n[monpoll] ${results.length - bad.length}/${results.length} 通过`)
if (bad.length) process.exitCode = 1
