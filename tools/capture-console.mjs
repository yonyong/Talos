#!/usr/bin/env node
/**
 * Talos 控制台批量截图（一次登录，逐页截图）
 *
 * 适用场景：改完前端后跑一遍，肉眼核对每个页面的渲染效果。
 *
 * 用法：
 *   node tools/capture-console.mjs [--base http://localhost:8080] [--out-dir shots] [--only dashboard,roles] [--no-full] [--width 1600] [--height 1000] [--wait 1500]
 *
 *   --only 可用 ASCII 键：dashboard issues admission workflow monitor clients agents logs docs kb users roles
 *          （也接受页面中文名，如 --only 总览,权限管理）
 *
 * 需要 NODE_PATH 指向包含 playwright-core 的目录。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchPage } from './pw.mjs'

const PAGES = [
  { key: 'dashboard', label: '总览', file: '01-dashboard.png' },
  { key: 'issues', label: 'Issue', file: '02-issues.png' },
  { key: 'admission', label: '准入判定', file: '03-admission.png' },
  { key: 'workflow', label: '工作流编排', file: '04-workflow.png' },
  { key: 'monitor', label: '作业监控', file: '05-monitor.png' },
  { key: 'clients', label: '客户端', file: '06-clients.png' },
  { key: 'agents', label: 'Coding Agent', file: '07-agents.png' },
  { key: 'logs', label: 'AI 调用日志', file: '08-logs.png' },
  { key: 'docs', label: '文档中心', file: '09-docs.png' },
  { key: 'kb', label: '知识库', file: '10-kb.png' },
  { key: 'users', label: '用户管理', file: '11-users.png' },
  { key: 'roles', label: '权限管理', file: '12-roles.png' },
]

const argv = process.argv.slice(2)
const opt = {
  base: 'http://localhost:8080',
  outDir: 'shots',
  only: null,
  full: true,
  width: 1600,
  height: 1000,
  wait: 1500,
}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--base') opt.base = argv[++i]
  else if (a === '--out-dir') opt.outDir = argv[++i]
  else if (a === '--only') opt.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean)
  else if (a === '--no-full') opt.full = false
  else if (a === '--width') opt.width = +argv[++i]
  else if (a === '--height') opt.height = +argv[++i]
  else if (a === '--wait') opt.wait = +argv[++i]
}

const targets = opt.only
  ? PAGES.filter((p) => opt.only.includes(p.label) || opt.only.includes(p.key))
  : PAGES
if (!targets.length) {
  console.error(`[cap] --only 没有匹配到页面。可用 ASCII 键：${PAGES.map((p) => p.key).join(' / ')}`)
  process.exit(2)
}
if (!existsSync(opt.outDir)) mkdirSync(opt.outDir, { recursive: true })

let browser
const failed = []
try {
  const { browser: b, page, errors, netErrors, chromiumPath } = await launchPage({ width: opt.width, height: opt.height })
  browser = b
  console.log(`[cap] chromium: ${chromiumPath}`)
  console.log(`[cap] base: ${opt.base}  ->  ${opt.outDir}`)

  // ---- 进入控制台：官网 -> 登录 -> 控制台 ----
  await page.goto(opt.base, { waitUntil: 'load', timeout: 30000 })
  await page.locator('button:has-text("进入控制台")').first().click({ timeout: 15000 })
  await page.locator('.login-card .btn-primary').first().click({ timeout: 15000 })
  await page.waitForSelector('.app', { timeout: 20000 })
  await page.waitForTimeout(800)
  console.log('[cap] 已进入控制台')

  const before = errors.length
  const beforeNet = netErrors.length
  for (const p of targets) {
    try {
      await page.locator('.nav-i', { hasText: p.label }).first().click({ timeout: 15000 })
      await page.waitForTimeout(opt.wait)
      const out = join(opt.outDir, p.file)
      await page.screenshot({ path: out, fullPage: opt.full })
      const active = await page.locator('.nav-i.active').first().innerText().catch(() => '?')
      console.log(`[cap] OK  ${p.label} (active=${active.trim()})  ->  ${out}`)
    } catch (e) {
      failed.push(p.label)
      console.error(`[cap] 失败 ${p.label}: ${e.message}`)
    }
  }

  const newNet = [...new Set(netErrors.slice(beforeNet))]
  if (newNet.length) {
    console.log(`[cap] 交互过程中 HTTP>=400 的请求 ${newNet.length} 条：`)
    for (const e of newNet.slice(0, 10)) console.log('   - ' + e.slice(0, 200))
  }
  const newErrors = errors.slice(before)
  if (newErrors.length) {
    console.log(`[cap] 交互过程中新增控制台错误 ${newErrors.length} 条：`)
    for (const e of newErrors.slice(0, 10)) console.log('   - ' + e.slice(0, 200))
  } else {
    console.log('[cap] 交互过程无新增控制台错误')
  }
} catch (e) {
  console.error('[cap] 致命错误: ' + (e && e.message ? e.message : e))
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
}
console.log(`[cap] 完成：成功 ${targets.length - failed.length}/${targets.length}${failed.length ? '，失败 ' + failed.join(',') : ''}`)
if (failed.length) process.exitCode = 1
