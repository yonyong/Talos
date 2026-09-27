#!/usr/bin/env node
/**
 * 验证「Coding Agent 配置 → 用户配置汇总」可直接配置（与设置面板共用同一编辑器）
 *
 *   node tools/verify-agent-admin-edit.mjs [base=http://localhost:5173] [outDir=shots-agentadmin]
 *
 * 覆盖：汇总表出现「配置」入口 / 弹框内编辑器复用 / 嵌套弹框（配置执行方式）定位正确 /
 *       添加后端可用 / 整表保存往返（在离线用户身上做，写后复原，不碰真实在线配置）/
 *       设置面板 Coding Agent Tab 回归。
 */
import { mkdirSync } from 'node:fs'
import { launchPage, settle } from './pw.mjs'

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = process.argv[3] || 'shots-agentadmin'
mkdirSync(OUT, { recursive: true })

const fails = []
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? '[ok]  ' : '[FAIL]'} ${label}${extra ? ` · ${extra}` : ''}`)
  if (!cond) fails.push(label)
}

/** 元素的 scrollWidth 是否超出（横向溢出 = 内容被裁） */
const overflowX = (page, sel) => page.$$eval(sel, (els) =>
  els.map((e) => e.scrollWidth - e.clientWidth))

const { browser, page, errors, netErrors } = await launchPage({ width: 1600, height: 1000 })
await page.addInitScript(() => {
  localStorage.setItem('talos.onboarded', '1')
  localStorage.setItem('talos.profile', JSON.stringify({
    name: 'YangDe', no: '00001', role: '平台管理员', email: '', phone: '',
  }))
})

await page.goto(`${BASE}/#/app/agents`, { waitUntil: 'domcontentloaded' })
await settle(page, 1800)

/* ---------- 1. 汇总表 + 配置入口 ---------- */
const rows = page.locator('table tbody tr')
const rowCount = await rows.count()
ok(rowCount > 0, '汇总表有用户行', `${rowCount} 行`)

const cfgBtns = page.locator('table tbody tr button:has-text("配置")')
const btnCount = await cfgBtns.count()
ok(btnCount === rowCount, '每行都有「配置」入口', `${btnCount}/${rowCount}`)
await page.screenshot({ path: `${OUT}/01-summary.png` })

/* ---------- 2. 打开 00001 的配置弹框（只看不存，避免动真实在线配置） ---------- */
await page.locator('tr', { hasText: '00001' }).first().locator('button:has-text("配置")').click()
await settle(page, 900)

const masks = await page.locator('.mask').count()
ok(masks === 1, '弹框已打开', `.mask=${masks}`)

const title = await page.locator('.modal-h h3').first().textContent()
ok(/配置 Coding Agent/.test(title || ''), '弹框标题正确', title?.trim())

const headText = await page.locator('.modal-b').first().textContent() || ''
ok(headText.includes('绑定客户端') && headText.includes('老杨的T14P'), '弹框头部带绑定客户端信息')
ok(headText.includes('在线'), '弹框头部带在线状态')

const items = page.locator('.mask .ua-item')
const itemCount = await items.count()
ok(itemCount === 1, '编辑器复用：读出 1 条已配置后端', `${itemCount} 条`)
ok(await page.locator('button:has-text("添加后端")').count() > 0, '编辑器带「添加后端」')

// 未改动时「保存」必须是禁用态（与设置面板一致）
const saveBtn = page.locator('.mask button:text-is("保存")').first()
ok(await saveBtn.isDisabled(), '未改动时「保存」不可点')
console.log('     保存按钮样式 =', await saveBtn.evaluate((e) => {
  const c = getComputedStyle(e)
  return `bg=${c.backgroundColor} opacity=${c.opacity} cursor=${c.cursor}`
}))

// 弹框与列表行的几何检查：不超出视口、行内不横向裁切
const geo = await page.evaluate(() => {
  const m = document.querySelector('.mask .modal')
  const r = m.getBoundingClientRect()
  const vw = innerWidth, vh = innerHeight
  return {
    w: Math.round(r.width), h: Math.round(r.height),
    inside: r.left >= 0 && r.top >= 0 && r.right <= vw + 1 && r.bottom <= vh + 1,
    vw, vh,
  }
})
ok(geo.inside, '弹框完整落在视口内', `${geo.w}×${geo.h} @ ${geo.vw}×${geo.vh}`)

const ovf = await overflowX(page, '.mask .ua-item')
ok(ovf.every((d) => d <= 1), '后端行无横向裁切', `溢出=${JSON.stringify(ovf)}`)
await page.screenshot({ path: `${OUT}/02-editor-in-modal.png` })

/* ---------- 3. 添加后端 + 嵌套「配置执行方式」弹框定位 ---------- */
await page.locator('button:has-text("添加后端")').click()
await settle(page, 400)
ok(await items.count() === 2, '添加后端生效', `${await items.count()} 条`)

await page.locator('.mask .ua-item').nth(1).locator('button:has-text("配置")').click()
await settle(page, 600)

const masks2 = await page.locator('.mask').count()
ok(masks2 === 2, '嵌套弹框已打开（外层编辑 + 内层执行参数）', `.mask=${masks2}`)

const nested = await page.evaluate(() => {
  const all = [...document.querySelectorAll('.mask .modal')]
  const r = all[all.length - 1].getBoundingClientRect()
  return {
    title: all[all.length - 1].querySelector('h3')?.textContent?.trim(),
    dx: Math.round(Math.abs((r.left + r.right) / 2 - innerWidth / 2)),
    dy: Math.round(Math.abs((r.top + r.bottom) / 2 - innerHeight / 2)),
    w: Math.round(r.width),
  }
})
ok(/配置执行方式/.test(nested.title || ''), '内层弹框标题正确', nested.title)
ok(nested.dx < 60 && nested.dy < 60, '内层弹框在视口居中（嵌套未错位）', `dx=${nested.dx} dy=${nested.dy} w=${nested.w}`)
await page.screenshot({ path: `${OUT}/03-nested-modal.png` })

await page.locator('button:text-is("完成")').last().click()
await settle(page, 500)
ok(await page.locator('.mask').count() === 1, '关闭内层后外层仍在')

// 未保存的修改提示
const draft = await page.locator('text=有未保存的修改').count()
ok(draft > 0, '未保存时有提示')
ok(await page.locator('button:text-is("保存")').first().isEnabled(), '有改动时「保存」可点')

/* ---------- 4. 关闭（不保存），改在离线用户身上跑真实保存往返 ---------- */
await page.keyboard.press('Escape')
await settle(page, 600)
ok(await page.locator('.mask').count() === 0, 'Esc 关闭外层弹框（未写库）')

const OFFLINE = '25520'
const offRow = page.locator('tr', { hasText: OFFLINE }).first()
ok(await offRow.count() > 0, `找到离线用户行 ${OFFLINE}`)
ok((await offRow.textContent() || '').includes('未配置'), '该用户初始为未配置')

await offRow.locator('button:has-text("配置")').click()
await settle(page, 900)
ok((await page.locator('.mask .ua-item').count()) === 0, '离线用户编辑器为空（显示空态）')
ok(await page.locator('text=该用户客户端当前离线').count() > 0, '离线用户给出离线提示')

await page.locator('button:has-text("添加后端")').click()
await settle(page, 300)
await page.locator('button:text-is("保存")').first().click()
await settle(page, 1200)

const toastText = await page.locator('.toast.show').first().textContent().catch(() => '')
ok(/配置已保存|已下发/.test(toastText || ''), '保存有成功提示', toastText?.trim())
ok((await page.locator('.mask .ua-item').count()) === 1, '保存后编辑器回读为 1 条')

await page.screenshot({ path: `${OUT}/04-saved-offline-user.png` })

// 关闭弹框 → 汇总表应即时反映
await page.keyboard.press('Escape')
await settle(page, 900)
const offRowText = (await page.locator('tr', { hasText: OFFLINE }).first().textContent()) || ''
ok(!offRowText.includes('未配置'), '汇总表即时反映新配置', offRowText.replace(/\s+/g, ' ').slice(0, 90))
await page.screenshot({ path: `${OUT}/05-summary-after-save.png` })

/* ---------- 5. 复原该用户（删空再保存），避免留下测试数据 ---------- */
await page.locator('tr', { hasText: OFFLINE }).first().locator('button:has-text("配置")').click()
await settle(page, 900)
await page.locator('.mask .ua-item button[title="删除"]').first().click()
await settle(page, 300)
await page.locator('button:text-is("保存")').first().click()
await settle(page, 1200)
await page.keyboard.press('Escape')
await settle(page, 900)
const restored = (await page.locator('tr', { hasText: OFFLINE }).first().textContent()) || ''
ok(restored.includes('未配置'), '已复原该用户为未配置')

/* ---------- 6. 设置面板回归（同一编辑器） ---------- */
await page.goto(`${BASE}/#/app/dashboard`, { waitUntil: 'domcontentloaded' })
await settle(page, 1200)
await page.locator('button[title="设置"]').first().click()
await settle(page, 700)
ok(await page.locator('.mask').count() > 0, '设置面板已打开')

await page.locator('.mask button:has-text("Coding Agent")').first().click()
await settle(page, 900)
const spItems = await page.locator('.mask .ua-item').count()
ok(spItems === 1, '设置面板 Coding Agent Tab 正常（复用编辑器）', `${spItems} 条`)
ok(await page.locator('.mask button:has-text("添加后端")').count() > 0, '设置面板仍有「添加后端」')
const spOvf = await overflowX(page, '.mask .ua-item')
ok(spOvf.every((d) => d <= 1), '设置面板后端行无横向裁切', `溢出=${JSON.stringify(spOvf)}`)
await page.screenshot({ path: `${OUT}/06-settings-agent-tab.png` })

/* ---------- 汇总 ---------- */
const netBad = netErrors.filter((e) => !/favicon/.test(e))
console.log('\n[console errors]', errors.length ? errors : '(无)')
console.log('[net >=400]', netBad.length ? netBad : '(无)')
console.log(`\n结果：${fails.length === 0 ? '全部通过' : `${fails.length} 项失败`}`)
if (fails.length) console.log('失败项：\n - ' + fails.join('\n - '))

await browser.close()
process.exit(fails.length ? 1 : 0)
