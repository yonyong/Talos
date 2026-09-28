#!/usr/bin/env node
/**
 * Talos 控制台批量截图（一次登录，逐页截图）
 *
 * 适用场景：改完前端后跑一遍，肉眼核对每个页面的渲染效果。
 *
 * 用法：
 *   node tools/capture-console.mjs [--base http://localhost:8080] [--out-dir shots] [--only dashboard,roles] [--no-full] [--width 1600] [--height 1000] [--wait 1500] [--template 缺陷]
 *
 *   --only 可用 ASCII 键：dashboard issues admission workflow monitor clients agents logs docs kb biz repos users roles
 *          （也接受页面中文名，如 --only 总览,权限管理）
 *   --template 仅对工作流编排页生效，切换模板后再截图（文件名追加模板后缀）
 *   --token  直接注入已有会话 token（登录改版后控制台需要「邮箱 + 邮件授权码」，
 *           自动化拿不到邮件里的码，所以脚本化截图走这条通道）：
 *             TALOS_TOKEN=$(curl -s ... /api/auth/verify ... | jq -r .token) node tools/capture-console.mjs
 *           也可用环境变量 TALOS_TOKEN。联调时更省事的办法是给服务端开 talos.auth.expose-code=true，
 *           让 /api/auth/send-code 直接把 devCode 回传，再换 token。
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
  { key: 'guide', label: '接入指南', file: '07-guide.png' },
  { key: 'agents', label: 'Coding Agent', file: '08-agents.png' },
  { key: 'prompts', label: 'Prompt 模板', file: '08b-prompts.png' },
  { key: 'models', label: '模型配置', file: '08c-models.png' },
  { key: 'logs', label: '调用日志', file: '09-logs.png' },
  { key: 'docs', label: '文档中心', file: '10-docs.png' },
  { key: 'kb', label: '知识库', file: '11-kb.png' },
  { key: 'biz', label: '业务域', file: '12-biz.png' },
  { key: 'repos', label: '仓库管理', file: '13-repos.png' },
  { key: 'users', label: '用户管理', file: '14-users.png' },
  { key: 'roles', label: '权限管理', file: '15-roles.png' },
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
  template: null,
  token: process.env.TALOS_TOKEN || null,
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
  else if (a === '--template') opt.template = argv[++i]
  else if (a === '--token') opt.token = argv[++i]
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
  if (opt.token) {
    // 有 token 就直通控制台：登录已改为「邮箱 + 邮件授权码」，脚本读不到邮件里的码
    await page.evaluate((t) => {
      localStorage.setItem('talos.token', t)
      localStorage.setItem('talos.onboarded', '1') // 跳过首次进入的初始配置向导
    }, opt.token)
    await page.goto(`${opt.base}/#/app/dashboard`, { waitUntil: 'load', timeout: 30000 })
    await page.reload({ waitUntil: 'load' }) // hash-only 跳转不重跑启动校验，必须真加载一次
    await page.waitForSelector('.app', { timeout: 20000 })
  } else {
    await page.locator('button:has-text("进入控制台")').first().click({ timeout: 15000 })
    // 老路径：两步式登录（填邮箱 -> 发授权码 -> 填码 -> 登录）。自动化没有收信能力，
    // 只有人工/联调（expose-code）时能走通；否则请用 --token / TALOS_TOKEN。
    await page.locator('.login-card input').first().fill(process.env.TALOS_EMAIL || '')
    await page.locator('.login-card .btn-primary').first().click({ timeout: 15000 })
    await page.waitForSelector('.code-input', { timeout: 20000 })
    if (process.env.TALOS_CODE) {
      await page.locator('.code-input').fill(process.env.TALOS_CODE)
      await page.locator('.login-card .btn-primary').first().click()
      await page.waitForSelector('.app', { timeout: 20000 })
    } else {
      throw new Error('登录需要邮箱授权码：请改用 --token/TALOS_TOKEN，或同时给出 TALOS_EMAIL 与 TALOS_CODE')
    }
  }
  // 隔离实例首次进入会弹「初始配置」向导（.mask 挡所有点击）→ 先完成进入控制台
  const wizardDone = page.locator('button:has-text("完成并进入控制台")').first()
  if (await wizardDone.isVisible({ timeout: 2000 }).catch(() => false)) {
    await wizardDone.click()
    await page.waitForTimeout(600)
  }
  await page.waitForTimeout(800)
  console.log('[cap] 已进入控制台')

  const before = errors.length
  const beforeNet = netErrors.length
  for (const p of targets) {
    try {
      await page.locator('.nav-i', { hasText: p.label }).first().click({ timeout: 15000 })
      await page.waitForTimeout(opt.wait)
      // 工作流页可指定模板（REQ / BUG），切换后再截图
      let file = p.file
      if (opt.template && p.key === 'workflow') {
        await page.locator(`button:has-text("${opt.template}模板")`).first().click({ timeout: 10000 })
        await page.waitForTimeout(700)
        file = p.file.replace(/\.png$/, `-${opt.template}.png`)
      }
      const out = join(opt.outDir, file)
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
