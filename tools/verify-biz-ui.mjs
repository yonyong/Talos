#!/usr/bin/env node
/** 验证业务管理/仓库管理改版：分步弹框、树检索、右键菜单、搜索式人员选择、分拣预演 */
import { mkdirSync } from 'node:fs'
import { launchPage } from './pw.mjs'

const BASE = process.env.BASE || 'http://localhost:18080'
const OUT = 'shots-p3'
mkdirSync(OUT, { recursive: true })

const { browser, page, errors } = await launchPage({ width: 1680, height: 1050 })
const shots = []
const shot = async (name) => {
  const f = `${OUT}/${name}.png`
  await page.screenshot({ path: f })
  shots.push(f)
}
const sleep = (ms) => page.waitForTimeout(ms)

try {
  await page.goto(`${BASE}/#/app/biz`, { waitUntil: 'networkidle' })
  await sleep(1200)

  // 1) 分拣预演展开：双栏
  await page.click('.probe-head')
  await sleep(300)
  await page.fill('.probe-body input', '行情快照导出支持分页')
  await page.fill('.probe-body textarea', '需要支持 offset/limit 分页导出，单次上限 5000 行')
  await sleep(1400)
  await shot('biz-probe')

  // 2) 树检索
  await page.fill('.tree-search input', '行情')
  await sleep(500)
  await shot('biz-tree-search')
  await page.fill('.tree-search input', '')

  // 3) 右键菜单
  const row = page.locator('.tree-row').first()
  await row.click({ button: 'right' })
  await sleep(400)
  await shot('biz-ctx-menu')
  await page.keyboard.press('Escape')
  await sleep(200)

  // 4) 业务域弹框三步
  await page.getByRole('button', { name: /新增业务域/ }).click()
  await sleep(500)
  await shot('biz-step1')
  await page.getByRole('button', { name: '下一步' }).click()
  await sleep(300)
  // 搜索式人员选择
  const pick = page.locator('.owner-pick').first()
  await pick.locator('input').fill('杨')
  await sleep(300)
  await shot('biz-step2-picker')
  await pick.locator('.owner-drop button').first().click()
  await sleep(200)
  await shot('biz-step2-selected')
  await page.getByRole('button', { name: '下一步' }).click()
  await sleep(300)
  await shot('biz-step3')
  await page.keyboard.press('Escape') // 关弹框
  await sleep(300)

  // 5) 仓库弹框四步
  await page.goto(`${BASE}/#/app/repos`, { waitUntil: 'networkidle' })
  await sleep(1000)
  await page.getByRole('button', { name: /新增仓库/ }).click()
  await sleep(500)
  await shot('repo-step1')
  for (let i = 2; i <= 4; i++) {
    await page.getByRole('button', { name: '下一步' }).click()
    await sleep(300)
    await shot(`repo-step${i}`)
  }
} finally {
  await browser.close()
}

console.log(JSON.stringify({ ok: true, shots, pageErrors: errors }, null, 2))
