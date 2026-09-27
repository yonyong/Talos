#!/usr/bin/env node
/**
 * 截图留档：作业监控里机械节点（kind=git）的执行日志面板
 *
 * 用来肉眼核对「拉取 Git」这类机械节点的产出：仓库准备 trace（每条命令 + 输出），
 * 而不是以前那句误导人的通用 Prompt / AI 调用。
 *
 * 用法：node tools/shot-mech-node.mjs [base] [issueCode] [nodeName]
 *   base      默认 http://localhost:5173
 *   issueCode 默认 REQ-2251
 *   nodeName  默认 拉取 Git
 *
 * 前置：NO_PROXY="*" （Playwright 走本机回环，别被 sandbox 代理拦）
 */
import { mkdirSync } from 'node:fs'
import { launchPage, settle } from './pw.mjs'

const BASE = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '')
const ISSUE = process.argv[3] || 'REQ-2251'
const NODE = process.argv[4] || '拉取 Git'
const OUT = 'shots-mech'
mkdirSync(OUT, { recursive: true })

const { browser, page, errors, netErrors } = await launchPage({ width: 1500, height: 1000, dsf: 1 })
try {
  // 隔离实例首进控制台会弹「初始配置」向导（.mask 挡点击），先标记已引导
  await page.addInitScript(() => localStorage.setItem('talos.onboarded', '1'))

  // 深链直达监控页，focus 里带 issueCode → 页面自动选中对应实例
  await page.goto(`${BASE}/#/app/monitor?issueCode=${ISSUE}`, { waitUntil: 'load', timeout: 30000 })
  await settle(page, 1200)

  // 未登录会落回登录页
  if (await page.locator('.login-card').first().isVisible().catch(() => false)) {
    await page.locator('.login-card .btn-primary').first().click()
    await settle(page, 1200)
  }
  await page.waitForSelector('.app', { timeout: 15000 })
  await settle(page, 1000)

  const onboardClose = page.locator('.modal-h .iconbtn').first()
  if (await onboardClose.isVisible().catch(() => false)) { await onboardClose.click(); await settle(page, 300) }

  // 兜底：深链没选中就在左栏点含 issueCode 的实例卡
  const head = await page.locator('.mon-head').first().innerText().catch(() => '')
  if (!head.includes(ISSUE)) {
    await page.locator('.mon-item', { hasText: ISSUE }).first().click()
    await settle(page, 800)
  }
  console.log('[shot] 实例头：', head.replace(/\s+/g, ' ').trim().slice(0, 120))

  // 点时间线上的机械节点 → 右侧滑出日志面板
  const tl = page.locator('.timeline .tl', { hasText: NODE }).first()
  await tl.click()
  await settle(page, 700)

  const panelText = await page.locator('.drawer .logbar').first().innerText().catch(() => '')
  console.log('[shot] 节点面板：', panelText.replace(/\s+/g, ' ').trim().slice(0, 400))

  await page.screenshot({ path: `${OUT}/01-node-log.png` })
  await page.screenshot({ path: `${OUT}/02-monitor-full.png`, fullPage: true })

  console.log('[shot] 控制台错误:', errors.length, '接口错误:', netErrors.length)
  if (errors.length) console.log(errors.slice(0, 5).join('\n'))
  if (netErrors.length) console.log(netErrors.slice(0, 5).join('\n'))
} finally {
  await browser.close()
}
