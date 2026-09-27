#!/usr/bin/env node
import { launchPage } from './pw.mjs'

const base = process.argv[2] ?? 'http://localhost:18080'
const out = process.argv[3] ?? 'shots-wfnodes/wf-graph.png'

const { browser, page } = await launchPage()
await page.setViewportSize({ width: 1440, height: 900 })
// 跳过「初始配置」向导（标记落 localStorage），比点按钮更安全：不触碰服务端配置
await page.addInitScript(() => localStorage.setItem('talos.onboarded', '1'))
await page.goto(base + '/#/app/workflow', { waitUntil: 'load', timeout: 30000 })
await page.waitForSelector('[data-wf-canvas] [data-wf-node]', { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(1200)
await page.screenshot({ path: out, fullPage: false })
console.log('[shot]', out)
await browser.close()
