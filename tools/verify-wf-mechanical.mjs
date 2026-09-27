#!/usr/bin/env node
/**
 * 回归验证：编排页把「拉取 Git」这类机械节点锁成不接 AI 的形态。
 *
 * 背景：机械节点（kind=git）在客户端只做 clone/fetch/切分支，不调用 Coding Agent。
 * 编排页必须同步表达这一约束 —— 选到 Git 类型时「Coding Agent 后端」与「Prompt 模板」
 * 置灰并归位为占位符，同时给出说明，否则很容易配出一个「看起来接了 AI 其实不会调」的空壳节点。
 *
 * 用法：node tools/verify-wf-mechanical.mjs [base]    默认 http://127.0.0.1:18080
 */
import { mkdirSync } from 'node:fs'
import { launchPage, settle } from './pw.mjs'

const BASE = process.argv[2] || 'http://127.0.0.1:18080'
const OUT = 'shots-wfmech'
mkdirSync(OUT, { recursive: true })

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok })
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${extra ? `  — ${extra}` : ''}`)
}

const { browser, page, errors } = await launchPage({ width: 1500, height: 1000, dsf: 1 })
try {
  // 跳过「初始配置」向导，避免遮挡点击
  await page.addInitScript(() => localStorage.setItem('talos.onboarded', '1'))
  await page.goto(`${BASE}/#/app/workflow`, { waitUntil: 'load', timeout: 30000 })
  await page.waitForSelector('.app', { timeout: 15000 })
  await settle(page, 1200)

  const canvas = page.locator('[data-wf-canvas]').first()
  check('编排页渲染出拓扑画布', await canvas.isVisible(), `节点 ${await page.locator('[data-wf-canvas] [data-wf-node]').count()} 个`)

  /** 打开某个节点的编辑弹窗 */
  const openNode = async (name) => {
    await page.locator('[data-wf-canvas] [data-wf-node]', { hasText: name }).first().click()
    await page.waitForSelector('.modal', { timeout: 8000 })
    await settle(page, 400)
  }
  const closeModal = async () => {
    await page.locator('.modal-h .iconbtn').first().click()
    await settle(page, 300)
  }

  /* ---------- 机械节点：拉取 Git ---------- */
  await openNode('拉取 Git')
  const modal = page.locator('.modal').first()
  const bodyText = (await modal.innerText()).replace(/\s+/g, ' ')

  check('Git 节点弹窗给出机械节点说明', bodyText.includes('机械节点') && bodyText.includes('不产生 AI 调用日志'),
    bodyText.slice(bodyText.indexOf('机械节点'), bodyText.indexOf('机械节点') + 60))

  const backendSel = modal.locator("select").nth(2)
  const promptInput = modal.locator('.field', { hasText: 'Prompt 模板' }).locator('input').first()
  check('Git 节点的「Coding Agent 后端」已置灰', await backendSel.isDisabled(),
    `值=${await backendSel.inputValue()}`)
  check('Git 节点的「Prompt 模板」已置灰', await promptInput.isDisabled(),
    `值=${await promptInput.inputValue()}`)
  check('Git 节点的后端/模板仍是占位符「—」',
    (await backendSel.inputValue()) === '—' && (await promptInput.inputValue()) === '—')

  await page.screenshot({ path: `${OUT}/wf-mechanical-git.png` })
  await closeModal()

  /* ---------- AI 节点：需求分析（对照组） ---------- */
  await openNode('需求分析')
  const modal2 = page.locator('.modal').first()
  const body2 = (await modal2.innerText()).replace(/\s+/g, ' ')
  const backend2 = modal2.locator("select").nth(2)
  const prompt2 = modal2.locator('.field', { hasText: 'Prompt 模板' }).locator('input').first()

  check('AI 节点不显示机械节点说明', !body2.includes('机械节点'))
  check('AI 节点的后端与模板可编辑',
    !(await backend2.isDisabled()) && !(await prompt2.isDisabled()),
    `后端=${await backend2.inputValue()} · 模板=${await prompt2.inputValue()}`)
  await page.screenshot({ path: `${OUT}/wf-ai-node.png` })
  await closeModal()

  check('无控制台 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '))
} catch (e) {
  console.error('[FAIL] 脚本异常: ' + (e && e.message ? e.message : e))
  results.push({ name: '脚本异常', ok: false })
} finally {
  const pass = results.filter((r) => r.ok).length
  console.log(`\n===== 通过 ${pass}/${results.length} =====`)
  results.filter((r) => !r.ok).forEach((r) => console.log('  未通过: ' + r.name))
  await browser.close().catch(() => {})
  if (pass !== results.length) process.exitCode = 1
}
