#!/usr/bin/env node
/**
 * 工作流 DAG 几何体检：实测节点框与条件标签的 DOM 坐标，检测重叠。
 *
 *   node tools/measure-wf.mjs [baseUrl] [--page 工作流编排]
 *
 * 检测项：
 *   1. 节点框之间是否重叠
 *   2. 条件标签是否压到节点框（z 序上节点在后，会盖住标签）
 *   3. 标签是否越出画布边界
 *   4. 画布是否横向溢出（需要滚动）
 *   5. 节点卡内文字是否被裁切（卡高不足 / overflow:hidden 吃内容）
 */
import { launchPage } from './pw.mjs'

const argv = process.argv.slice(2)
const base = argv.find((a) => a.startsWith('http')) ?? 'http://localhost:18080'
const pageName = (() => {
  const i = argv.indexOf('--page')
  return i >= 0 ? argv[i + 1] : '工作流编排'
})()
/** 工作流页可切换模板：REQ / BUG */
const template = (() => {
  const i = argv.indexOf('--template')
  return i >= 0 ? argv[i + 1] : null
})()

const rect = (r) => ({ x: r.x, y: r.y, w: r.width, h: r.height, r: r.x + r.width, b: r.y + r.height })
const overlap = (a, b) => {
  const dx = Math.min(a.r, b.r) - Math.max(a.x, b.x)
  const dy = Math.min(a.b, b.b) - Math.max(a.y, b.y)
  return dx > 0.5 && dy > 0.5 ? { dx: +dx.toFixed(1), dy: +dy.toFixed(1) } : null
}

let browser
let failures = 0
const fail = (m) => { failures++; console.log('  ✗ ' + m) }
const pass = (m) => console.log('  ✓ ' + m)

try {
  const { browser: b, page } = await launchPage({ width: 1600, height: 1000, dsf: 1 })
  browser = b

  // 新浏览器上下文首次进控制台会弹「初始配置」向导（.mask 挡住所有点击）。
  // 标记落 localStorage 即可跳过，无需真去点「完成并进入控制台」（避免误写配置）。
  await page.addInitScript(() => localStorage.setItem('talos.onboarded', '1'))

  await page.goto(base, { waitUntil: 'load', timeout: 30000 })
  await page.locator('button:has-text("进入控制台")').first().click({ timeout: 15000 })
  await page.locator('.login-card .btn-primary').first().click({ timeout: 15000 })
  await page.waitForSelector('.app', { timeout: 20000 })
  await page.locator('.nav-i', { hasText: pageName }).first().click({ timeout: 15000 })
  await page.waitForTimeout(1400)

  // 监控页的 DAG 藏在「实例详情 → 拓扑图」Tab 下：先选中左侧第一个实例再切 Tab，
  // 否则画布压根不渲染（表现为 no [data-wf-canvas]）
  if (!(await page.locator('[data-wf-canvas]').count())) {
    const first = page.locator('.mon-list .mon-item').first()
    if (await first.count()) {
      await first.click({ timeout: 10000 }).catch(() => {})
      await page.waitForTimeout(1200)
    }
    const tab = page.locator('button:has-text("拓扑图")').first()
    if (await tab.count()) {
      await tab.click({ timeout: 10000 }).catch(() => {})
      await page.waitForTimeout(1200)
    }
  }

  if (template) {
    await page.locator(`button:has-text("${template}模板")`).first().click({ timeout: 10000 })
    await page.waitForTimeout(1200)
    console.log(`[measure] 已切换模板：${template}`)
  }

  const info = await page.evaluate(() => {
    const canvas = document.querySelector('[data-wf-canvas]')
    if (!canvas) return { err: 'no [data-wf-canvas]' }
    const inner = canvas.firstElementChild
    const cr = canvas.getBoundingClientRect()
    const nodes = [...canvas.querySelectorAll('[data-wf-node]')].map((el) => {
      const r = el.getBoundingClientRect()
      const cr = { x: r.x, y: r.y, r: r.right, b: r.bottom }
      const cardCs = getComputedStyle(el)
      // 画布可能整体 transform:scale(zoom)，computed 的 padding 是缩放前值，需换算
      const zoom = r.height / (parseFloat(cardCs.height) || r.height)
      const innerLimit = cr.b - (parseFloat(cardCs.paddingBottom) + parseFloat(cardCs.borderBottomWidth)) * zoom
      let padHit = 0
      for (const k of el.children) {
        if (k.hasAttribute('data-wf-node-action')) continue
        padHit = Math.max(padHit, k.getBoundingClientRect().bottom - innerLimit)
      }
      // 卡内所有文字节点：越出卡框 = 被节点边框裁掉
      const clipped = []
      for (const leaf of el.querySelectorAll('span, svg')) {
        // 角标动作按钮（节点右上角 ⟲）本就悬在卡框外，属设计内，忽略
        if (leaf.closest('[data-wf-node-action]')) continue
        const lr = leaf.getBoundingClientRect()
        if (!lr.width && !lr.height) continue
        const overB = lr.bottom - cr.b
        const overT = cr.y - lr.top
        // 垂直方向的内容裁切才致命（横向是设计内的 ellipsis）
        if (overB > 0.5 || overT > 0.5) {
          clipped.push({
            text: leaf.textContent.trim().slice(0, 18), tag: leaf.tagName.toLowerCase(),
            overTop: +overT.toFixed(1), overBottom: +overB.toFixed(1),
          })
        }
        // overflow:hidden 自身吃内容（scrollHeight 大于可视高度）
        const cs = getComputedStyle(leaf)
        if (cs.overflowY === 'hidden' && leaf.scrollHeight > Math.ceil(lr.height) + 1) {
          clipped.push({ text: leaf.textContent.trim().slice(0, 18), tag: leaf.tagName.toLowerCase(), selfClip: leaf.scrollHeight - Math.ceil(lr.height) })
        }
      }
      return { step: el.getAttribute('data-wf-node'), x: r.x, y: r.y, w: r.width, h: r.height, clipped, padHit: +padHit.toFixed(1) }
    })
    const labels = [...canvas.querySelectorAll('div[title]')].map((el) => {
      const r = el.getBoundingClientRect()
      return { text: el.textContent.trim(), title: el.getAttribute('title'), x: r.x, y: r.y, w: r.width, h: r.height }
    })
    return {
      nodes, labels,
      innerW: inner.scrollWidth, innerH: inner.scrollHeight,
      viewW: cr.width, viewH: cr.height,
      scrollW: canvas.scrollWidth, clientW: canvas.clientWidth,
    }
  })

  if (info.err) throw new Error(info.err)

  console.log(`\n画布内容 ${info.innerW}×${info.innerH} · 可视 ${Math.round(info.viewW)}×${Math.round(info.viewH)}`)
  console.log(`横向滚动：scrollW=${info.scrollW} clientW=${info.clientW} 溢出 ${info.scrollW - info.clientW}px`)
  console.log(`节点 ${info.nodes.length} 个 · 条件标签 ${info.labels.length} 个\n`)

  // 1. 节点两两重叠
  console.log('[1] 节点框重叠检测')
  const N = info.nodes.map((n) => ({ ...rect({ x: n.x, y: n.y, width: n.w, height: n.h }), step: n.step }))
  let nHit = 0
  for (let i = 0; i < N.length; i++) {
    for (let j = i + 1; j < N.length; j++) {
      const o = overlap(N[i], N[j])
      if (o) { fail(`STEP ${N[i].step} 与 STEP ${N[j].step} 重叠 ${o.dx}×${o.dy}px`); nHit++ }
    }
  }
  if (!nHit) pass(`${N.length} 个节点两两不重叠`)

  // 2. 标签压节点
  console.log('\n[2] 条件标签压节点检测')
  let lHit = 0
  for (const l of info.labels) {
    const L = rect({ x: l.x, y: l.y, width: l.w, height: l.h })
    for (const n of N) {
      const o = overlap(L, n)
      if (o) { fail(`标签「${l.text}」压住 STEP ${n.step} ${o.dx}×${o.dy}px`); lHit++ }
    }
  }
  if (!lHit) pass(`${info.labels.length} 个标签均未压到节点`)

  // 3. 标签越界
  console.log('\n[3] 标签越界与标签间重叠')
  const left = Math.min(...info.nodes.map((n) => n.x))
  const right = Math.max(...info.nodes.map((n) => n.x + n.w))
  let oob = 0
  for (const l of info.labels) {
    if (l.x < left - 0.5 || l.x + l.w > right + 0.5) {
      // 允许轻微越界，仅记录
      console.log(`  · 标签「${l.text}」超出节点区 [${Math.round(left)}, ${Math.round(right)}]`)
    }
    if (l.y < 0) { fail(`标签「${l.text}」上沿被裁 y=${l.y.toFixed(1)}`); oob++ }
  }
  if (!oob) pass('标签未被画布上沿裁切')

  const L2 = info.labels.map((l) => ({ ...rect({ x: l.x, y: l.y, width: l.w, height: l.h }), text: l.text }))
  let lcHit = 0
  for (let i = 0; i < L2.length; i++) {
    for (let j = i + 1; j < L2.length; j++) {
      const o = overlap(L2[i], L2[j])
      if (o) { fail(`标签「${L2[i].text}」与「${L2[j].text}」互相重叠 ${o.dx}×${o.dy}px`); lcHit++ }
    }
  }
  if (!lcHit) pass('标签之间不重叠')

  console.log('\n[4] 节点卡内文字裁切检测')
  let cHit = 0
  for (const n of info.nodes) {
    if (n.padHit > 0.5) {
      cHit++
      fail(`STEP ${n.step} 末行侵占底部内边距 ${n.padHit}px（卡高 ${Math.round(n.h)}，文字贴边/被切）`)
    }
    for (const c of n.clipped) {
      cHit++
      if (c.selfClip) fail(`STEP ${n.step} 卡内「${c.text}」被 overflow 裁掉 ${c.selfClip}px（卡高 ${Math.round(n.h)}）`)
      else fail(`STEP ${n.step} 卡内「${c.text}」越出节点框 上${c.overTop} 下${c.overBottom}px（卡高 ${Math.round(n.h)}）`)
    }
  }
  if (!cHit) pass(`${info.nodes.length} 个节点卡内文字完整显示，无裁切/贴边`)

  console.log('\n[5] 标签明细（按 y 分行）')
  const rowsSeen = []
  for (const l of [...info.labels].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let r = rowsSeen.find((s) => Math.abs(s.y - l.y) < 6)
    if (!r) { r = { y: l.y, items: [] }; rowsSeen.push(r) }
    r.items.push(l)
  }
  rowsSeen.forEach((r, i) => {
    console.log(`  行${i + 1} y=${r.y.toFixed(1)}  ${r.items.map((l) => `「${l.text}」@${Math.round(l.x)}(w${Math.round(l.w)})`).join('  ')}`)
  })
  console.log(`  节点 y=${info.nodes.map((n) => n.y.toFixed(0)).join('/')} 高=${info.nodes[0]?.h}`)
  console.log(`  → 标签共 ${rowsSeen.length} 行`)

  console.log(`\n${'='.repeat(48)}`)
  console.log(failures === 0 ? '结果：几何体检全部通过' : `结果：发现 ${failures} 处问题`)
} catch (e) {
  console.error('致命错误: ' + (e && e.message ? e.message : e))
  failures++
} finally {
  if (browser) await browser.close().catch(() => {})
}
process.exitCode = failures ? 1 : 0
