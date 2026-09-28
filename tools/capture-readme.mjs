/**
 * README 素材采集：登录隔离实例(5174)拍控制台静态图 + 录制 3 段视频(转 GIF 用)。
 * 用法：NODE_PATH=... node tools/capture-readme.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { loadPlaywright, findChromium, settle } from './pw.mjs'

const CONSOLE = 'http://localhost:5174'   // 控制台（隔离实例 18080）
const SITE = process.env.SITE || 'http://localhost:5175'      // 官网（最新源码）
const OUT = 'D:/tmp/talos-readme/cap'
const EMAIL = '2365878736@qq.com'

mkdirSync(OUT, { recursive: true })

/* ---------- 1) API 登录拿 token（expose-code 直接回码） ---------- */
const send = await fetch(CONSOLE + '/api/auth/send-code', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL }),
}).then((r) => r.json())
if (!send.devCode) throw new Error('send-code 未回码: ' + JSON.stringify(send))
const login = await fetch(CONSOLE + '/api/auth/verify', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, code: send.devCode }),
}).then((r) => r.json())
if (!login.token) throw new Error('verify 失败: ' + JSON.stringify(login))
console.log('login ok, user =', login.user?.name, 'role =', login.user?.role)

const { chromium } = await loadPlaywright()
const exe = findChromium()
const browser = await chromium.launch({
  executablePath: exe, headless: true, chromiumSandbox: false,
  args: ['--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars'],
})

/** 视频上下文：注入登录态 */
async function videoCtx(dir) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
    recordVideo: { dir, size: { width: 1280, height: 800 } },
  })
  await ctx.addInitScript(([t, u]) => {
    localStorage.setItem('talos.token', t)
    localStorage.setItem('talos.user', JSON.stringify(u))
    localStorage.setItem('talos.onboarded', '1') // 跳过「初始配置」向导，别挡住演示
  }, [login.token, JSON.stringify(login.user)])
  return ctx
}

/** 静态图上下文 */
async function shotCtx(dsf = 2) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: dsf, ignoreHTTPSErrors: true,
  })
  await ctx.addInitScript(([t, u]) => {
    localStorage.setItem('talos.token', t)
    localStorage.setItem('talos.user', JSON.stringify(u))
    localStorage.setItem('talos.onboarded', '1')
  }, [login.token, JSON.stringify(login.user)])
  return ctx
}

/** 平滑滚动到底，逐步触发 reveal 动画 */
async function scrollThrough(page, step = 560, pause = 620, maxSteps = 30) {
  for (let i = 0; i < maxSteps; i++) {
    const done = await page.evaluate((s) => {
      window.scrollBy({ top: s, behavior: 'smooth' })
      return window.innerHeight + window.scrollY >= document.body.scrollHeight - 4
    }, step)
    await page.waitForTimeout(pause)
    if (done) break
  }
}

/* ---------- 2) 控制台静态图 ---------- */
const ONLY_V3 = !!process.env.ONLY_V3
if (!ONLY_V3) {
  const ctx = await shotCtx(2)
  const page = await ctx.newPage()
  const shots = [
    ['dashboard', 2600], ['issues', 1800], ['workflow', 2000], ['monitor', 3200],
    ['clients', 2000], ['agents', 1800], ['logs', 1800], ['kb', 1600], ['users', 1600],
  ]
  for (const [p, wait] of shots) {
    await page.goto(`${CONSOLE}/#/app/${p}`)
    await settle(page, wait)
    await page.screenshot({ path: `${OUT}/console-${p}.png` })
    console.log('shot', p)
  }
  await page.goto(`${CONSOLE}/#/app/monitor`)
  await settle(page, 2600)
  // 打开实例抽屉看实时日志
  const row = page.locator('text=W1-8753').first()
  if (await row.isVisible().catch(() => false)) {
    await row.click()
    await page.waitForTimeout(1800)
    await page.screenshot({ path: `${OUT}/console-monitor-drawer.png` })
    console.log('shot monitor-drawer')
  }
  await ctx.close()

/* ---------- 3) 官网静态图 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true })
  const page = await ctx.newPage()
  await page.goto(`${SITE}/#/`)
  await settle(page, 2600)
  await page.screenshot({ path: `${OUT}/site-hero.png` })
  await page.evaluate(() => document.getElementById('arch')?.scrollIntoView({ behavior: 'instant', block: 'center' }))
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/site-arch.png` })
  await page.goto(`${SITE}/#/docs`)
  await settle(page, 1800)
  await page.screenshot({ path: `${OUT}/site-docs.png` })
  await page.goto(`${SITE}/#/download`)
  await settle(page, 1800)
  await page.screenshot({ path: `${OUT}/site-download.png` })
  await ctx.close()
}

/* ---------- 4) GIF 1：官网滚动 ---------- */
{
  // 预热 vite（首访编译慢，别把白屏录进 GIF）
  const warm = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const wp = await warm.newPage()
  await wp.goto(`${SITE}/#/`).catch(() => {})
  await settle(wp, 2500)
  await warm.close()

  const ctx = await videoCtx(`${OUT}/v1`)
  const page = await ctx.newPage()
  await page.goto(`${SITE}/#/`)
  await settle(page, 3000)
  await scrollThrough(page, 480, 950)
  await page.waitForTimeout(1400)
  const v = await page.video()
  await ctx.close()
  console.log('video landing ->', v ? await v.path() : '?')
}

/* ---------- 5) GIF 2：控制台漫游 ---------- */
{
  const warm = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const wp = await warm.newPage()
  await wp.goto(`${CONSOLE}/#/app/dashboard`).catch(() => {})
  await settle(wp, 2500)
  await warm.close()

  const ctx = await videoCtx(`${OUT}/v2`)
  const page = await ctx.newPage()
  await page.goto(`${CONSOLE}/#/app/dashboard`)
  await settle(page, 3200)
  const walk = [['issues', 2100], ['workflow', 2400], ['monitor', 3200], ['logs', 2100], ['clients', 2200], ['users', 1700]]
  for (const [p, wait] of walk) {
    await page.goto(`${CONSOLE}/#/app/${p}`)
    await settle(page, wait)
  }
  const v = await page.video()
  await ctx.close()
  console.log('video console ->', v ? await v.path() : '?')
}
} // end if (!ONLY_V3)

/* ---------- 6) GIF 3：作业监控 · 实例拓扑图 ---------- */
{
  const ctx = await videoCtx(`${OUT}/v3`)
  const page = await ctx.newPage()
  await page.goto(`${CONSOLE}/#/app/monitor`)
  await settle(page, 3200)
  // 切到「实例」tab，选中一个实例，右侧出现阶段条 / 时间线 / 拓扑图
  const tabInst = page.locator('button', { hasText: '实例' }).first()
  if (await tabInst.isVisible().catch(() => false)) {
    await tabInst.click()
    await page.waitForTimeout(1200)
  }
  const item = page.locator('.mon-item').first()
  if (await item.isVisible().catch(() => false)) {
    await item.click()
    await page.waitForTimeout(2600)
  }
  // 切到「拓扑图」视图看 DAG
  const tabGraph = page.locator('button', { hasText: '拓扑图' }).first()
  if (await tabGraph.isVisible().catch(() => false)) {
    await tabGraph.click()
    await page.waitForTimeout(2600)
  }
  await page.waitForTimeout(1000)
  const v = await page.video()
  await ctx.close()
  console.log('video monitor ->', v ? await v.path() : '?')
}

await browser.close()
console.log('ALL DONE')
