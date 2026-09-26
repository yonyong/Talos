/**
 * Talos favicon 生成器
 *
 * 以 web/public/favicon.svg 为唯一品牌源，用本机缓存的 Chromium 栅格化，
 * 产出：
 *   web/public/favicon.ico        16 / 32 / 48 三尺寸（PNG 载荷的 ICO）
 *   web/public/apple-touch-icon.png  180x180（白底圆角，iOS 不透明要求）
 *   web/public/favicon-192.png / favicon-512.png  PWA / 分享卡片备用
 *
 * 用法：
 *   NODE_PATH="C:/Users/yd236/.workbuddy/binaries/node/workspace/node_modules" \
 *     node tools/make-favicon.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlaywright, findChromium } from './pw.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC_DIR = join(ROOT, 'web', 'public')
const SVG_PATH = join(PUBLIC_DIR, 'favicon.svg')

const ICO_SIZES = [16, 32, 48]

/** 打包多尺寸 PNG 载荷的 ICO */
function packIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: 1 = icon
  header.writeUInt16LE(images.length, 4)

  const entries = []
  let offset = 6 + images.length * 16
  for (const { size, data } of images) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0) // width
    e.writeUInt8(size >= 256 ? 0 : size, 1) // height
    e.writeUInt8(0, 2) // palette count
    e.writeUInt8(0, 3) // reserved
    e.writeUInt16LE(1, 4) // color planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

async function main() {
  if (!existsSync(SVG_PATH)) throw new Error(`缺少品牌源文件：${SVG_PATH}`)
  if (!existsSync(PUBLIC_DIR)) mkdirSync(PUBLIC_DIR, { recursive: true })

  const svg = readFileSync(SVG_PATH, 'utf8')
  const { chromium } = loadPlaywright()
  const exe = findChromium()
  if (!exe) throw new Error('未找到 Chromium，可用 CHROMIUM_EXECUTABLE_PATH 指定')

  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    chromiumSandbox: false,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars'],
  })
  const ctx = await browser.newContext({ deviceScaleFactor: 1 })
  const page = await ctx.newPage()

  /** 在 size×size 画布上渲染，background 为 null 时透明 */
  async function render(size, { tile = null, pad = 0, radius = 0 } = {}) {
    const inner = size - pad * 2
    const bg = tile
      ? `background:${tile};border-radius:${radius}px;`
      : 'background:transparent;'
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(
      `<style>html,body{margin:0;padding:0;width:${size}px;height:${size}px;${bg}` +
        `overflow:hidden}svg{display:block;width:${inner}px;height:${inner}px;margin:${pad}px}</style>${svg}`,
      { waitUntil: 'load' },
    )
    return page.screenshot({ omitBackground: !tile })
  }

  // 1) ICO：16 / 32 / 48，透明底
  const icoImages = []
  for (const size of ICO_SIZES) {
    icoImages.push({ size, data: await render(size) })
  }
  writeFileSync(join(PUBLIC_DIR, 'favicon.ico'), packIco(icoImages))

  // 2) apple-touch-icon：180，白底圆角（iOS 不接受透明）
  writeFileSync(
    join(PUBLIC_DIR, 'apple-touch-icon.png'),
    await render(180, { tile: '#ffffff', pad: 26, radius: 40 }),
  )

  // 3) PWA / 分享卡片备用尺寸
  for (const size of [192, 512]) {
    writeFileSync(join(PUBLIC_DIR, `favicon-${size}.png`), await render(size))
  }

  await browser.close()

  console.log('[favicon] 生成完成 →', PUBLIC_DIR)
  for (const f of ['favicon.ico', 'apple-touch-icon.png', 'favicon-192.png', 'favicon-512.png']) {
    console.log('  -', f)
  }
}

main().catch((e) => {
  console.error('[favicon] 生成失败：', e.message)
  process.exit(1)
})
