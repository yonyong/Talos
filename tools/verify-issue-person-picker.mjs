#!/usr/bin/env node
/**
 * 新建 Issue 弹窗冒烟：提出人 / 责任人 必须为可下拉的自绘选择器（PersonSelect），
 * 且能搜索、选中回写；确认提交页为表单化回显（非 JSON）。
 *
 * 用法：
 *   NO_PROXY="*" NODE_PATH=C:/Users/yd236/.workbuddy/binaries/node/workspace/node_modules \
 *     node tools/verify-issue-person-picker.mjs [base] [outDir]
 *
 * 默认 base = http://localhost:5173（vite dev）；截图输出 shots-issuepick/
 */
import { mkdirSync } from 'node:fs'
import { launchPage, settle } from './pw.mjs'

const base = process.argv[2] ?? 'http://localhost:5173'
const outDir = process.argv[3] ?? 'shots-issuepick'
mkdirSync(outDir, { recursive: true })

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`) }
}

let browser
try {
  const { browser: b, page, errors, netErrors } = await launchPage({ width: 1600, height: 1000, dsf: 1 })
  browser = b

  await page.goto(`${base}/#/app/issues`, { waitUntil: 'load', timeout: 30000 })
  await settle(page, 800)
  const wizard = page.locator('button:has-text("完成并进入控制台")')
  if (await wizard.count()) { await wizard.first().click(); await page.waitForTimeout(500) }

  await page.locator('button:has-text("新建 Issue")').first().click({ timeout: 15000 })
  await page.waitForSelector('.modal', { timeout: 10000 })
  const modalW = await page.locator('.modal').first().evaluate((e) => Math.round(e.getBoundingClientRect().width))
  ok('弹窗宽度 ≥ 740', modalW >= 740, `${modalW}px`)

  // 走到第 3 步（指派时限）
  await page.locator('.modal-f button:has-text("下一步")').click()
  await page.waitForTimeout(200)
  await page.locator('.modal-f button:has-text("下一步")').click()
  await page.waitForTimeout(300)

  const ddCount = await page.locator('.modal .dd').count()
  ok('提出人/责任人均为自绘下拉（.dd ≥ 2）', ddCount >= 2, `${ddCount} 个`)
  const nativeSel = await page.locator('.modal select').count()
  ok('弹窗内无原生 select', nativeSel === 0, `${nativeSel} 个`)

  const reporterBtn = page.locator('.modal .dd').first().locator('.dd-btn')
  const initReporter = (await reporterBtn.locator('.dd-l').innerText()).trim()
  ok('提出人默认填充当前登录用户', initReporter.length > 0 && initReporter !== '请选择', initReporter)

  // 打开提出人下拉
  await reporterBtn.click()
  await page.waitForTimeout(250)
  const menuOpen = await page.locator('.modal .dd-menu.pick').count()
  ok('下拉菜单可展开', menuOpen === 1)
  const optCount = await page.locator('.modal .dd-menu.pick .dd-i.person').count()
  ok('候选人员 ≥ 1', optCount >= 1, `${optCount} 项`)
  await page.screenshot({ path: `${outDir}/01-reporter-open.png` })

  // 搜索过滤
  const firstOpt = (await page.locator('.modal .dd-menu.pick .dd-i.person .pn').first().innerText()).trim()
  await page.locator('.modal .dd-menu.pick .dd-search input').fill(firstOpt)
  await page.waitForTimeout(200)
  const filtered = await page.locator('.modal .dd-menu.pick .dd-i.person').count()
  ok('搜索过滤生效', filtered >= 1, `关键词「${firstOpt}」→ ${filtered} 项`)

  // 选中第一项
  await page.locator('.modal .dd-menu.pick .dd-i.person').first().click()
  await page.waitForTimeout(300)
  const picked = (await reporterBtn.locator('.dd-l').innerText()).trim()
  ok('选中后回写到触发按钮', picked === firstOpt, `${picked}`)
  const menuClosed = await page.locator('.modal .dd-menu.pick').count()
  ok('选中后菜单关闭', menuClosed === 0)
  await page.screenshot({ path: `${outDir}/02-reporter-picked.png` })

  // 确认提交页：表单化回显
  await page.locator('.modal-f button:has-text("下一步")').click()
  await page.waitForTimeout(300)
  const codeblk = await page.locator('.modal .codeblk').count()
  ok('确认页不再是 JSON 代码块', codeblk === 0)
  const rows = await page.locator('.modal .id-dl .r').count()
  ok('确认页表单行 ≥ 6', rows >= 6, `${rows} 行`)
  const rv = await page.locator('.modal .id-dl').innerText()
  ok('确认页含提出人', rv.includes('提出人'))
  await page.screenshot({ path: `${outDir}/03-confirm.png` })

  const http = netErrors.filter((e) => !e.includes('favicon'))
  ok('无 HTTP ≥400', http.length === 0, http.slice(0, 3).join(' | '))
  ok('无控制台错误', errors.length === 0, errors.slice(0, 3).join(' | '))

  console.log(`\n结果：${pass} 通过 / ${fail} 失败；截图 ${outDir}/`)
} catch (e) {
  fail++
  console.error('执行失败：', e.message)
} finally {
  await browser?.close()
}
process.exit(fail ? 1 : 0)
