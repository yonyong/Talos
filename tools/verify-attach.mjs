#!/usr/bin/env node
/**
 * 附件（原始文件）/ 过程文件 端到端验证
 *
 * 覆盖：
 *   1) 新建向导第 2 步：模拟 Ctrl+V 粘贴多个文件（含图片）落到待上传列表
 *   2) 提交后附件归档，详情页「原始文件」可见
 *   3) 注入一条过程文档，详情页「过程文件」分组正确
 *   4) 点击文档打开预览弹窗（文本 / 图片）
 *
 * 用法：node tools/verify-attach.mjs http://localhost:18180
 */
import { mkdirSync } from 'node:fs'
import { launchPage } from './pw.mjs'

const base = process.argv[2] ?? 'http://localhost:18180'
const OUT = 'shots-attach'
mkdirSync(OUT, { recursive: true })

const { browser, page, errors, netErrors } = await launchPage()
await page.setViewportSize({ width: 1512, height: 950 })
await page.addInitScript(() => localStorage.setItem('talos.onboarded', '1'))
await page.goto(`${base}/#/app/issues`, { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(1500)

const pass = []
const fail = []
const check = (ok, msg) => (ok ? pass : fail).push(msg)

/* ---------- 1. 新建向导：粘贴多文件 ---------- */
await page.getByText('新建 Issue', { exact: true }).first().click()
await page.waitForTimeout(600)
await page.locator('.modal-b input').first().fill('粘贴上传验证 · 自动化')
await page.getByRole('button', { name: '下一步' }).click() // -> step1 诉求详情
await page.waitForTimeout(500)
await page.locator('.modal-b textarea').fill('验证 Ctrl+V 一次性粘多个文件后能否随 Issue 归档。')
check(await page.locator('.atch-drop').count() === 1, '第2步出现附件投放区')

// 模拟剪贴板：两张截图 + 一个日志
await page.evaluate(() => {
  const dt = new DataTransfer()
  dt.items.add(new File(['fake-png-bytes'], 'image.png', { type: 'image/png' }))
  dt.items.add(new File(['2026-09-27 ERROR xxx at Foo.java:42'], 'error.log', { type: 'text/plain' }))
  dt.items.add(new File(['# 需求背景\n附件随 Issue 归档'], '需求稿.md', { type: 'text/markdown' }))
  document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(600)

const items = await page.locator('.atch-item').count()
check(items === 3, `粘贴 3 个文件后待上传列表有 3 条（实际 ${items}）`)
const renamed = await page.locator('.atch-item .at-name').first().innerText()
check(/^截图 \d{4}-\d{6}\.png$/.test(renamed), `粘贴的 image.png 被重命名为「${renamed}」`)
check(await page.locator('.atch-item img.at-thumb').count() === 1, '图片附件显示缩略图')
await page.screenshot({ path: `${OUT}/01-new-attach.png` })

/* ---------- 2. 提交并归档 ---------- */
await page.getByRole('button', { name: '下一步' }).click() // step2
await page.waitForTimeout(300)
check(await page.locator('.atch-compact').count() === 1, '非详情步骤仍展示附件条（可继续粘贴）')
await page.getByRole('button', { name: '下一步' }).click() // step3 确认
await page.waitForTimeout(400)
const confirmText = await page.locator('.modal-b').innerText()
check(/附件材料/.test(confirmText), '确认页列出附件材料')
await page.screenshot({ path: `${OUT}/02-confirm.png` })

await page.getByRole('button', { name: '提交' }).click()
await page.waitForTimeout(2500)
const toastText = await page.locator('.toast, .toast-wrap, [class*=toast]').first().innerText().catch(() => '')
check(/3 个附件已归档|附件/.test(toastText), `提交后提示含附件结果（${toastText.replace(/\n/g, ' ')}）`)

/* ---------- 3. 详情页文档区 ---------- */
await page.locator('.search input, input[placeholder*=搜索]').first().fill('粘贴上传验证')
await page.waitForTimeout(600)
await page.locator('table tbody tr').first().click()
await page.waitForTimeout(1800)

// 注入一条过程文档（模拟客户端回传），验证「过程文件」分组；issueCode 从详情标题解析
const injected = await page.evaluate(async () => {
  const t = document.querySelector('.modal-h h3')?.textContent ?? ''
  const code = t.split('·')[0].trim()
  const res = await fetch('/api/docs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      issueCode: code,
      name: '概要设计.md',
      kind: '概要',
      source: '客户端回传',
      sizeText: '2.4 KB',
      content: '# 概要设计\n由 Coding Agent 生成并回传。',
    }),
  })
  return (await res.json()).id
})
check(typeof injected === 'number', `注入过程文档成功（id=${injected}）`)

// 重开详情，验证「过程文件」非空渲染
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
await page.locator('table tbody tr').first().click()
await page.waitForTimeout(1500)

const modalText = await page.locator('.modal-b').first().innerText()
check(/原始文件/.test(modalText), '详情页出现「原始文件」区块')
check(/过程文件/.test(modalText), '详情页出现「过程文件」区块')
const rawRows = await page.locator('.id-panel .doc-row').count()
check(rawRows >= 4, `文档行渲染 ${rawRows} 条（原始 3 + 过程 1）`)
await page.screenshot({ path: `${OUT}/03-detail-docs.png` })

// 高亮文档区块再截一张（便于看细节）
const panel = page.locator('section', { has: page.getByText('原始文件', { exact: true }) }).first()
await panel.screenshot({ path: `${OUT}/04-detail-raw.png` }).catch(() => {})

/* ---------- 4. 预览弹窗 ---------- */
await page.locator('.doc-row .doc-main').first().click()
await page.waitForTimeout(1200)
check(await page.locator('.docpv-img img, .docpv-text').count() > 0, '点击文档打开预览（图片/文本）')
await page.screenshot({ path: `${OUT}/05-preview.png` })

await page.keyboard.press('Escape')
await page.waitForTimeout(400)

console.log(`\n通过 ${pass.length} 项：`)
pass.forEach((p) => console.log('  ✓ ' + p))
if (fail.length) {
  console.log(`\n失败 ${fail.length} 项：`)
  fail.forEach((f) => console.log('  ✗ ' + f))
}
const realErrors = errors.filter((e) => !/favicon|fonts\.googleapis/.test(e))
const realNet = netErrors.filter((e) => !/favicon|fonts\.googleapis/.test(e))
console.log(`\n控制台错误 ${realErrors.length} 条${realErrors.length ? '：' + realErrors.slice(0, 3).join(' | ') : ''}`)
console.log(`网络 4xx/5xx ${realNet.length} 条${realNet.length ? '：' + realNet.slice(0, 3).join(' | ') : ''}`)

await browser.close()
process.exit(fail.length ? 1 : 0)
