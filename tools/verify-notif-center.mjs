#!/usr/bin/env node
/**
 * 通知中心回归：右上角铃铛角标 / 面板台账 / 已读未读 / 点击跳转 / 全部已读 / 清空。
 *
 * 用法：
 *   NO_PROXY="*" node tools/verify-notif-center.mjs [--base http://localhost:5173] [--out-dir shots-notif]
 *
 * 前置：需要 vite dev server（5173）或已注入新产物的服务端。
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchPage, settle } from './pw.mjs'

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const BASE = arg('base', 'http://localhost:5173')
const OUT = arg('out-dir', 'shots-notif')

const now = Date.now()
const SEED = [
  { id: 'n1', kind: 'jobFailed', title: '作业失败 · BUG-102', body: 'BUG-102 当前状态：failed', ts: now - 4 * 60_000, read: false, ref: 'BUG-102', page: 'monitor', focus: { issueCode: 'BUG-102' } },
  { id: 'n2', kind: 'jobDone', title: '作业完成 · REQ-88', body: 'REQ-88 已跑完全部节点', ts: now - 52 * 60_000, read: false, ref: 'REQ-88', page: 'monitor', focus: { issueCode: 'REQ-88' } },
  { id: 'n3', kind: 'newIssue', title: '新 Issue 待处理 · BUG-105', body: 'BUG-105 已录入，等待准入判定', ts: now - 5 * 3600_000, read: true, ref: 'BUG-105', page: 'issues', focus: { issueCode: 'BUG-105' } },
  { id: 'n4', kind: 'system', title: '通知测试', body: '这是一条来自 Talos 设置面板的测试通知', ts: now - 30 * 3600_000, read: true },
]

mkdirSync(OUT, { recursive: true })
const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, name) })
  console.log(`  · shot ${name}`)
}

let fail = 0
const ok = (cond, label) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}`)
  if (!cond) fail++
}

const { browser, page, errors } = await launchPage({ width: 1600, height: 1000 })
try {
  // 只在首个页面注入种子数据（reload 时保留真实台账，才能验证持久化）
  await page.addInitScript((seed) => {
    localStorage.setItem('talos.onboarded', '1')
    if (!localStorage.getItem('notif.seed.done')) {
      localStorage.setItem('notif.seed.done', '1')
      localStorage.setItem('talos.notifications', JSON.stringify(seed))
    }
  }, SEED)

  console.log(`[1] 打开控制台 ${BASE}`)
  await page.goto(`${BASE}/#/app/dashboard`, { waitUntil: 'domcontentloaded' })
  await settle(page, 1200)

  const badge = page.locator('.notif-badge')
  ok(await badge.count() === 1, '铃铛出现未读角标')
  ok((await badge.textContent())?.trim() === '2', `角标数字为 2（实际 ${(await badge.textContent())?.trim()}）`)

  console.log('[2] 展开通知面板')
  await page.click('.notif-btn')
  await page.waitForSelector('.notif-panel', { timeout: 3000 })
  await page.waitForTimeout(300)
  ok(await page.locator('.notif-i').count() === 4, '台账列出 4 条通知')
  ok(await page.locator('.notif-i.unread').count() === 2, '其中 2 条标记为未读')
  ok((await page.locator('.notif-unread').textContent())?.includes('2'), '头部显示「2 条未读」')
  await shot(page, '01-panel-all.png')

  console.log('[3] 未读筛选')
  await page.click('.notif-tabs button:nth-child(2)')
  await page.waitForTimeout(200)
  ok(await page.locator('.notif-i').count() === 2, '切到「未读」只剩 2 条')
  await shot(page, '02-panel-unread.png')
  await page.click('.notif-tabs button:nth-child(1)')
  await page.waitForTimeout(200)

  console.log('[4] 点击未读条目 → 标记已读 + 跳转')
  await page.click('.notif-i.unread >> nth=0')
  await page.waitForTimeout(600)
  const hash = await page.evaluate(() => location.hash)
  ok(hash.includes('/app/monitor') && hash.includes('issueCode=BUG-102'), `跳转到监控页并定位（${hash}）`)
  ok(await page.locator('.notif-panel').count() === 0, '跳转后面板自动关闭')
  const badge2 = page.locator('.notif-badge')
  ok((await badge2.textContent())?.trim() === '1', `角标降到 1（实际 ${(await badge2.textContent())?.trim()}）`)

  console.log('[5] 全部已读')
  await page.click('.notif-btn')
  await page.waitForSelector('.notif-panel')
  await page.click('.notif-act')
  await page.waitForTimeout(300)
  ok(await page.locator('.notif-badge').count() === 0, '全部已读后角标消失')
  ok(await page.locator('.notif-i.unread').count() === 0, '列表内无未读样式')
  await shot(page, '03-all-read.png')

  console.log('[6] 删除单条 + 清空')
  await page.hover('.notif-i >> nth=0')
  await page.click('.notif-i >> nth=0 >> .notif-del')
  await page.waitForTimeout(250)
  ok(await page.locator('.notif-i').count() === 3, '删除一条后剩 3 条')
  await page.click('.notif-act-ic')
  await page.waitForTimeout(250)
  ok(await page.locator('.notif-i').count() === 0, '清空后为空')
  ok(await page.locator('.notif-empty').count() === 1, '显示空状态')
  await shot(page, '04-empty.png')

  console.log('[7] 刷新后台账持久化')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await settle(page, 900)
  ok(await page.locator('.notif-badge').count() === 0, '刷新后保持已清空状态')

  const real = errors.filter((e) => !/favicon|404/.test(e))
  if (real.length) { console.log('  ✗ 控制台报错：'); real.slice(0, 5).forEach((e) => console.log(`      ${e}`)); fail++ }
  else console.log('  ✓ 无控制台报错')
} finally {
  await browser.close()
}

console.log(fail === 0 ? '\n全部断言通过' : `\n${fail} 项断言失败`)
process.exit(fail === 0 ? 0 : 1)
