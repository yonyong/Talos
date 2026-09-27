#!/usr/bin/env node
/**
 * 回归验证：URL 路由 + 作业监控布局 + 节点执行日志
 *
 * 覆盖三块：
 *  1. hash 路由：刷新 / 深链 / 前进后退保持当前页
 *  2. 作业监控主从布局：左实例列表可切换、页头状态条、节点视图与日志同屏可见
 *  3. 节点执行日志：点节点右侧滑出面板、面板内切换节点、无日志节点提示、Issue 详情就地展开
 *
 * 用法：node tools/verify-route-log.mjs [base]      默认 http://127.0.0.1:28080
 * 前置：目标实例需有 Issue + 工作流实例（DataInitializer 不造），先跑 tools/seed-monitor-demo.mjs
 */
import { mkdirSync } from 'node:fs'
import { launchPage, settle } from './pw.mjs'

const BASE = process.argv[2] || 'http://127.0.0.1:28080'
const OUT = 'shots-verify'
mkdirSync(OUT, { recursive: true })
const VH = 1000
const VW = 1500

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok })
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${extra ? `  — ${extra}` : ''}`)
}
const brief = (s, n = 90) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

const { browser, ctx, page, errors, netErrors } = await launchPage({ width: VW, height: VH, dsf: 1 })
try {
  const hash = () => page.evaluate(() => location.hash)

  /* ================= 1. 路由 ================= */
  await page.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await settle(page)
  check('初始进入品牌官网', await page.locator('button:has-text("进入控制台")').first().isVisible(), `hash=${(await hash()) || '(空)'}`)

  await page.locator('button:has-text("进入控制台")').first().click()
  await settle(page, 400)
  check('「进入控制台」写入 #/login', (await hash()) === '#/login', await hash())

  await page.locator('.login-card .btn-primary').first().click()
  await page.waitForSelector('.app', { timeout: 15000 })
  await settle(page, 600)
  // 新浏览器环境首次进控制台会自动弹「初始配置」向导，先关掉再继续（标记落 localStorage，刷新不再弹）
  const onboardClose = page.locator('.modal-h .iconbtn').first()
  if (await onboardClose.isVisible().catch(() => false)) { await onboardClose.click(); await settle(page, 300) }
  check('登录后 URL 落到 #/app/dashboard', (await hash()) === '#/app/dashboard', await hash())

  await page.locator('.side .nav-i', { hasText: '作业监控' }).first().click()
  await settle(page, 1000)
  check('切页写入 #/app/monitor', (await hash()) === '#/app/monitor', await hash())

  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.app', { timeout: 15000 })
  await settle(page, 1100)
  const activeAfterReload = (await page.locator('.side .nav-i.active').first().innerText()).trim()
  check('刷新后仍在作业监控（未回官网）', activeAfterReload === '作业监控', `active=${activeAfterReload} · hash=${await hash()}`)

  /* ================= 2. 主从布局 ================= */
  const items = page.locator('.mon-item')
  const itemN = await items.count()
  check('左侧实例列表常驻渲染', itemN >= 2, `${itemN} 个实例`)

  const listTop = await page.locator('.mon-list').first().boundingBox()
  check('实例切换入口在首屏内（不再埋到页底）', !!listTop && listTop.y < VH, `top≈${Math.round(listTop?.y ?? -1)}px`)

  const headText = brief(await page.locator('.mon-head').first().innerText().catch(() => ''))
  check('实例头聚合状态 / 责任人 / 客户端', /执行中|已完成|阻塞/.test(headText) && /责任人/.test(headText), headText)

  const chips = brief(await page.locator('.page-h .acts').first().innerText().catch(() => ''))
  check('页头一行全局状态（实例 / 阻塞 / 客户端）', /运行中/.test(chips) && /阻塞/.test(chips) && /客户端/.test(chips), chips)

  // 底部日志区已撤（AI 调用明细整合进日志页），节点进度面板吃满右栏
  const nodesBox = await page.locator('.mon-sec-nodes').first().boundingBox()
  check('底部日志面板已移除，节点进度面板在首屏内',
    (await page.locator('.mon-sec-log').count()) === 0 && !!nodesBox && nodesBox.y + nodesBox.height <= VH + 4,
    `bottom≈${Math.round((nodesBox?.y ?? 0) + (nodesBox?.height ?? 0))}px / 视口 ${VH}px`)

  // 切换实例
  const selREQ = items.filter({ hasText: 'REQ-' }).first()
  const selBUG = items.filter({ hasText: 'BUG-' }).first()
  const codeREQ = brief(await selREQ.locator('.mi-code').innerText(), 20)
  const codeBUG = brief(await selBUG.locator('.mi-code').innerText(), 20)
  await selREQ.click()
  await settle(page, 700)
  const titleREQ = brief(await page.locator('.mh-title').first().innerText(), 40)
  await selBUG.click()
  await settle(page, 700)
  const titleBUG = brief(await page.locator('.mh-title').first().innerText(), 40)
  check('切换实例后右侧详情随之切换', titleREQ.includes('REQ-') && titleBUG.includes('BUG-'),
    `${codeREQ} → ${codeBUG}`)
  await selREQ.click()
  await settle(page, 700)

  /* ================= 3. 节点执行日志（右侧滑出面板） ================= */
  const drawer = page.locator('.drawer').first()
  const drawerVisible = () => drawer.isVisible().catch(() => false)
  const logOf = () => drawer.locator('.nodelog').first().innerText().then((s) => s.trim())

  await page.locator('.timeline .tl', { hasText: '拉取 Git' }).first().click()
  await settle(page, 500)
  check('点击节点从右侧弹出日志面板', await drawerVisible())

  const log1 = await logOf()
  check('侧边面板展示完整执行日志', log1.length > 200 && log1.includes('git clone'),
    `${log1.length} 字符 · 首行「${log1.split('\n')[0]}」`)

  const meta = brief(await drawer.locator('.logmeta').first().innerText().catch(() => ''))
  check('面板给出行数 / 字符数元信息', /\d+\s*行/.test(meta), meta)

  const barText = brief(await drawer.locator('.logbar').first().innerText().catch(() => ''))
  check('面板头部显示状态与起止耗时', /已完成/.test(barText) && /\d{2}:\d{2}:\d{2}/.test(barText), barText)

  // 面板内「下一个节点」切换 → 需求分析
  await drawer.locator('.drawer-nav .dn-btn').nth(1).click()
  await settle(page, 400)
  const log2 = await logOf()
  check('面板内可切换到下一节点日志', log2.includes('claude -p') && !log2.includes('git clone'), `${log2.length} 字符`)

  // 一直「下一个」直到翻到未回传日志的节点（造数会灌前几个节点的日志）
  let log3 = ''
  for (let i = 0; i < 12; i++) {
    const nxt = drawer.locator('.drawer-nav .dn-btn').nth(1)
    if (await nxt.isDisabled()) break
    await nxt.click()
    await settle(page, 250)
    log3 = await logOf()
    if (log3.includes('尚未回传日志')) break
  }
  check('未回传日志的节点给出明确说明', log3.includes('尚未回传日志'), log3.split('\n')[0])

  // 关闭面板（右上角 ×）
  await drawer.locator('.drawer-h .iconbtn').first().click()
  await settle(page, 300)
  check('侧边面板可关闭', !(await drawerVisible()))

  // AI 调用明细整合：监控页只留入口，深链日志页按 Issue 过滤
  await page.locator('.mh-acts button', { hasText: 'AI 调用明细' }).first().click()
  await settle(page, 900)
  const logsHash = await hash()
  const logRows = await page.locator('table tbody tr').count()
  check('「AI 调用明细」深链日志页并按 Issue 预过滤',
    logsHash.includes('#/app/logs?issueCode=') && logRows >= 1,
    `${logsHash} · ${logRows} 行 · ${brief(await page.locator('.panel-h .sub').last().innerText().catch(() => ''), 50)}`)
  await page.goBack()
  await settle(page, 900)
  check('返回后回到作业监控', (await hash()).includes('#/app/monitor'), await hash())

  // 拓扑图视图
  await page.locator('.panel-h .seg button', { hasText: '拓扑图' }).first().click()
  await settle(page, 600)
  const wfNodes = await page.locator('[data-wf-canvas] [data-wf-node]').count()
  check('节点视图可切到拓扑图（同一份数据的另一个视角）', wfNodes >= 5, `${wfNodes} 个节点`)

  await page.locator('[data-wf-canvas] [data-wf-node]').nth(1).click()
  await settle(page, 400)
  const topoLog = await logOf()
  check('点拓扑图节点同样弹出侧边日志面板', topoLog.includes('claude -p'), `${topoLog.length} 字符`)

  await page.screenshot({ path: `${OUT}/monitor-topo.png`, fullPage: true })

  // 回到时间线，重开面板截图留档
  await page.keyboard.press('Escape')
  await settle(page, 300)
  await page.locator('.panel-h .seg button', { hasText: '时间线' }).first().click()
  await settle(page, 500)
  await page.locator('.timeline .tl', { hasText: '拉取 Git' }).first().click()
  await settle(page, 500)
  await page.screenshot({ path: `${OUT}/monitor-node-log.png` })
  await page.screenshot({ path: `${OUT}/monitor.png`, fullPage: true })
  // 关掉面板，别让 mask 挡住后续的导航点击
  await page.keyboard.press('Escape')
  await settle(page, 300)

  /* ================= 深链 + 后退 ================= */
  const page2 = await ctx.newPage()
  page2.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page2.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page2.on('response', (r) => { if (r.status() >= 400) netErrors.push(`${r.status()} ${r.url()}`) })
  await page2.goto(`${BASE}/#/app/issues`, { waitUntil: 'load', timeout: 30000 })
  await page2.waitForSelector('.app', { timeout: 15000 })
  await settle(page2, 900)
  const activeIssues = (await page2.locator('.side .nav-i.active').first().innerText()).trim()
  check('深链 #/app/issues 冷启动直接落到 Issue 页', activeIssues === 'Issue',
    `active=${activeIssues} · hash=${await page2.evaluate(() => location.hash)}`)

  // 点「执行中」的行（未启动的 Issue 详情里没有节点时间线）
  await page2.locator('tbody tr', { hasText: '执行中' }).first().click()
  await page2.waitForSelector('.modal', { timeout: 10000 })
  await page2.addStyleTag({ content: '.modal{max-height:none !important}' })
  await settle(page2, 700)
  await page2.locator('.modal .timeline .tl').first().click()
  await settle(page2, 400)
  const detailLog = (await page2.locator('.modal .nodelog').first().innerText()).trim()
  check('Issue 详情可就地展开节点完整日志', detailLog.length > 200, `${detailLog.length} 字符`)
  await page2.screenshot({ path: `${OUT}/issue-node-log.png`, fullPage: true })

  /* ---------- Issue 详情 →「查看进度」下钻，监控页应定位到该实例 ---------- */
  const rowCode = brief(await page2.locator('tbody tr', { hasText: '执行中' }).first().locator('td').first().innerText(), 20)
  await page2.locator('.modal button', { hasText: '查看进度' }).first().click()
  await settle(page2, 1200)
  const drillHash = await page2.evaluate(() => location.hash)
  const drillTitle = brief(await page2.locator('.mh-title').first().innerText().catch(() => ''), 40)
  check('Issue 详情「查看进度」下钻并在监控页定位该实例',
    drillHash.includes(`issueCode=${rowCode}`) && drillTitle.includes(rowCode),
    `${rowCode} · hash=${drillHash} · 详情=${drillTitle}`)

  await page.locator('.side .nav-i', { hasText: '总览' }).first().click()
  await settle(page, 800)
  const activeDash = (await page.locator('.side .nav-i.active').first().innerText()).trim()
  await page.goBack()
  await settle(page, 900)
  const activeBack = (await page.locator('.side .nav-i.active').first().innerText().catch(() => '?')).trim()
  check('浏览器后退回到上一页（作业监控）', activeDash === '总览' && activeBack === '作业监控',
    `前进=${activeDash} → 后退后=${activeBack}`)

  /* ================= 干扰项 ================= */
  const realNet = netErrors.filter((e) => !/favicon|fonts\.g/.test(e))
  console.log(`\n[net] HTTP>=400：${realNet.length} 条`)
  realNet.slice(0, 6).forEach((e) => console.log('   - ' + e.slice(0, 180)))
  console.log(`[js ] 控制台错误：${errors.length} 条`)
  errors.slice(0, 6).forEach((e) => console.log('   - ' + e.slice(0, 180)))
  check('无网络错误（HTTP>=400）', realNet.length === 0)
  check('无控制台 JS 错误', errors.length === 0)
} catch (e) {
  console.error('[FAIL] 脚本异常: ' + (e && e.message ? e.message : e))
  results.push({ name: '脚本异常', ok: false })
} finally {
  const pass = results.filter((r) => r.ok).length
  console.log(`\n===== 通过 ${pass}/${results.length} =====`)
  results.filter((r) => !r.ok).forEach((r) => console.log('  未通过: ' + r.name))
  await browser.close().catch(() => {})
  if (pass !== results.length) process.exitCode = 1
}
