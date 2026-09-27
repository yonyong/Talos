import { mkdirSync } from 'node:fs'
import { launchPage, settle } from './pw.mjs'

const url = process.argv[2] || 'http://localhost:8080/#/'
const out = process.argv[3] || 'shots/landing.png'

mkdirSync('shots', { recursive: true })
const { browser, page } = await launchPage({ width: 1600, height: 1000 })
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await settle(page, 1500)
  await page.screenshot({ path: out })
  console.log('saved', out)
} finally {
  await browser.close()
}
