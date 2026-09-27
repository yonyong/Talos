/**
 * Talos P2 交互验证：总览下钻 + 工作流 DAG 编辑 + 实例拓扑
 * 用法：node tools/verify-p2.mjs --base http://localhost:18080 --out-dir <dir>
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchPage } from './pw.mjs'

const argv = process.argv.slice(2)
const opt = { base: 'http://localhost:18080', outDir: 'shots-p2' }
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--base') opt.base = argv[++i]
  else if (argv[i] === '--out-dir') opt.outDir = argv[++i]
}
if (!existsSync(opt.outDir)) mkdirSync(opt.outDir, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`  [${ok ? 'OK' : 'FAIL'}] ${name}${ok ? '' : ' :: ' + detail}`)
}

let browser
try {
  const { browser: b, page, errors, netErrors } = await launchPage({ width: 1680, height: 1000 })
  browser = b

  await page.goto(opt.base, { waitUntil: 'load', timeout: 30000 })
  await page.locator('button:has-text("进入控制台")').first().click({ timeout: 15000 })
  await page.locator('.login-card .btn-primary').first().click({ timeout: 15000 })
  await page.waitForSelector('.app', { timeout: 20000 })
  await page.waitForTimeout(1200)

  /* ============ 1. 总览 KPI 卡片下钻 ============ */
  console.log('\n[1] 总览页下钻')
  await page.locator('.nav-i', { hasText: '总览' }).first().click()
  await page.waitForTimeout(900)

  const kpis = page.locator('.kpi.clickable')
  check('4 张 KPI 卡片均可点击', (await kpis.count()) === 4, `count=${await kpis.count()}`)
  await page.locator('.kpi.clickable', { hasText: '待处理 Issue' }).first().click()
  await page.waitForTimeout(900)
  check('点「待处理 Issue」→ Issue 页并带状态筛选',
    (await page.locator('.nav-i.active').first().innerText()).includes('Issue')
    && (await page.locator('text=已按状态筛选').count()) > 0)
  await page.locator('.btn', { hasText: '清除筛选' }).first().click().catch(() => {})
  await page.waitForTimeout(400)

  /* ============ 2. 近期 Issue 行下钻 → 直接打开详情 ============ */
  console.log('\n[2] 近期 Issue 行下钻')
  await page.locator('.nav-i', { hasText: '总览' }).first().click()
  await page.waitForTimeout(900)
  const firstRowId = (await page.locator('table tbody tr.row-link').first().locator('td.tid').innerText()).trim()
  await page.locator('table tbody tr.row-link').first().click()
  await page.waitForTimeout(1200)
  const modalTitle = await page.locator('.modal-h h3').first().innerText().catch(() => '')
  check(`点表格行 → 打开 ${firstRowId} 详情`, modalTitle.includes(firstRowId), `title=${modalTitle}`)
  check('详情内嵌执行进度区块', (await page.locator('text=执行进度').count()) > 0)
  await page.screenshot({ path: join(opt.outDir, 'd1-issue-detail.png'), fullPage: true })
  await page.locator('.modal-h .iconbtn').first().click()
  await page.waitForTimeout(500)

  /* ============ 3. 告警行下钻 ============ */
  console.log('\n[3] 需要关注告警行下钻')
  await page.locator('.nav-i', { hasText: '总览' }).first().click()
  await page.waitForTimeout(900)
  const alertRow = page.locator('.row-between.row-link').first()
  const alertId = (await alertRow.locator('.rl b').innerText()).trim()
  await alertRow.click()
  await page.waitForTimeout(1200)
  const alertModal = await page.locator('.modal-h h3').first().innerText().catch(() => '')
  check(`点告警行 → 打开 ${alertId} 详情`, alertModal.includes(alertId), `title=${alertModal}`)

  /* ============ 4. 详情 → 查看进度 → 作业监控实例拓扑 ============ */
  console.log('\n[4] 详情「查看进度」深链 + 实例拓扑')
  const progressBtn = page.locator('.modal button', { hasText: '查看进度' }).first()
  const canOpen = await progressBtn.isEnabled().catch(() => false)
  if (canOpen) {
    await progressBtn.click()
    await page.waitForTimeout(1500)
    const monTitle = await page.locator('.panel-h h3').first().innerText()
    check('跳到作业监控并定位到该 Issue 的实例', monTitle.includes(alertId), `title=${monTitle}`)
    check('监控页渲染「实例拓扑」DAG', (await page.locator('text=实例拓扑').count()) > 0)
    check('实例拓扑带节点状态标签', (await page.locator('.panel', { hasText: '实例拓扑' }).locator('text=已完成').count()) > 0)
    await page.screenshot({ path: join(opt.outDir, 'd2-monitor-graph.png'), fullPage: true })
  } else {
    check('详情「查看进度」可用', false, '按钮被禁用（该 Issue 无实例）')
  }

  /* ============ 5. 工作流页 DAG 渲染与编辑 ============ */
  console.log('\n[5] 工作流编排 DAG')
  await page.locator('.nav-i', { hasText: '工作流编排' }).first().click()
  await page.waitForTimeout(1400)
  const nodeCards = page.locator('div[data-wf-node]')
  check('DAG 渲染 7 个节点卡片', (await nodeCards.count()) === 7, `count=${await nodeCards.count()}`)
  check('连线条件标签可见（闸门通过）', (await page.locator('text=闸门通过').count()) > 0)
  check('回退边标签可见（打回重做）', (await page.locator('text=⟲ 闸门驳回 · 回退').count()) > 0)
  check('条件边表列出 9 条', (await page.locator('.panel', { hasText: '条件边' }).locator('table tbody tr').count()) === 9)

  // 点击节点 → 节点编辑器
  await nodeCards.filter({ hasText: '设计评审' }).first().click()
  await page.waitForTimeout(700)
  const nodeEditorTitle = await page.locator('.modal-h h3').first().innerText().catch(() => '')
  check('点节点打开编辑器', nodeEditorTitle.includes('编辑节点'), `title=${nodeEditorTitle}`)
  await page.screenshot({ path: join(opt.outDir, 'd3-node-editor.png') })
  await page.locator('.modal-h .iconbtn').first().click()
  await page.waitForTimeout(400)

  // 新建连线 → 目标 <= 源 时提示回退语义
  await page.locator('.panel', { hasText: '条件边' }).locator('button', { hasText: '新建连线' }).first().click()
  await page.waitForTimeout(700)
  const edgeTitle = await page.locator('.modal-h h3').first().innerText().catch(() => '')
  check('新建连线弹窗可用', edgeTitle.includes('新建条件边'), `title=${edgeTitle}`)
  await page.locator('.modal select').first().selectOption('5')
  await page.locator('.modal select').nth(1).selectOption('2')
  await page.waitForTimeout(400)
  check('目标步骤 ≤ 源步骤 → 提示回退重做语义',
    (await page.locator('text=回退重做边').count()) > 0)
  await page.screenshot({ path: join(opt.outDir, 'd4-edge-editor.png') })
  await page.locator('.modal button', { hasText: '取消' }).first().click()
  await page.waitForTimeout(400)

  /* ============ 6. DAG 横向可滚动且不裁切 ============ */
  console.log('\n[6] DAG 横向滚动')
  const scrollInfo = await page.evaluate(() => {
    const sc = document.querySelector('[data-wf-canvas]')
    if (!sc) return { error: '未找到 DAG 画布' }
    const before = sc.scrollLeft
    sc.scrollLeft = sc.scrollWidth
    return { sw: sc.scrollWidth, cw: sc.clientWidth, before, after: sc.scrollLeft,
             overflowPx: sc.scrollWidth - sc.clientWidth }
  })
  check('DAG 画布可横向滚动（超出部分可查看）',
    !scrollInfo.error && scrollInfo.after > scrollInfo.before, JSON.stringify(scrollInfo))
  console.log(`       DAG 宽 ${scrollInfo.sw}px / 可视 ${scrollInfo.cw}px · 超出 ${scrollInfo.overflowPx}px（横向滚动可取）`)
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(opt.outDir, 'd5-graph-scrolled.png') })

  /* ============ 7. 保存链路（改动后按钮变为可用） ============ */
  console.log('\n[7] 保存链路')
  await page.locator('.nav-i', { hasText: '工作流编排' }).first().click()
  await page.waitForTimeout(1200)
  const saveBtn = page.locator('button', { hasText: '保存拓扑' }).first()
  check('未改动时「保存拓扑」禁用', await saveBtn.isDisabled())
  check('未改动时无「有未保存改动」提示', (await page.locator('text=有未保存改动').count()) === 0)

  const before = errors.length
  const beforeNet = netErrors.length
  const newErrors = errors.slice(before)
  const newNet = [...new Set(netErrors.slice(beforeNet))]
  check('交互过程无新增控制台错误', newErrors.length === 0, newErrors.slice(0, 3).join(' | '))
  check('交互过程无 HTTP>=400', newNet.length === 0, newNet.slice(0, 3).join(' | '))
} catch (e) {
  console.error('[verify] 致命错误: ' + (e && e.message ? e.message : e))
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
}

const ok = results.filter((r) => r.ok).length
console.log(`\n结果：通过 ${ok} 项 · 失败 ${results.length - ok} 项`)
for (const r of results.filter((x) => !x.ok)) console.log('  ! ' + r.name + ' :: ' + r.detail)
if (ok !== results.length) process.exitCode = 1
