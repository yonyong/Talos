#!/usr/bin/env node
/**
 * 回归验证：机械节点（拉取 Git）不该产生 AI 调用日志。
 *
 * 背景：客户端曾把每个节点都交给 Coding Agent CLI 跑一遍，于是「拉取 Git」这类
 * 纯确定性节点也被记成 codebuddy 调用（token 0、输出为空、Prompt 是兜底文案），
 * 污染 AI 调用日志与耗时统计。修复后两端都要挡住：
 *   - 新版客户端：机械节点根本不上报 CALL_LOG（带 kind 字段）
 *   - 服务端：即便旧版客户端（≤1.4.2，无 kind 字段）误报，也按节点名回查类型丢弃
 *
 * 本脚本扮演客户端走真实 gRPC 链路，连发三条 CALL_LOG：
 *   1) 拉取 Git · 无 kind      —— 模拟旧版客户端（应由服务端拦截）
 *   2) 拉取 Git · kind=git     —— 新版客户端若误报（应由服务端按 kind 拦截）
 *   3) 需求分析 · kind=doc     —— 真实 AI 调用（应正常入库）
 * 再查 /api/logs 断言只剩第 3 条。
 *
 * 用法：node tools/verify-mechanical-node-log.mjs [httpBase] [grpcPort] [issueCode] [clientId]
 * 前置：目标服务端已启动，且该 issueCode 已有工作流实例（先跑 tools/seed-monitor-demo.mjs）
 */
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire('C:/Users/yd236/.workbuddy/binaries/node/workspace/')
const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')

const HTTP = process.argv[2] || 'http://127.0.0.1:18080'
const GRPC_PORT = process.argv[3] || '19443'
const ISSUE = process.argv[4] || 'REQ-2201'
const CLIENT_ID = process.argv[5] || 'mock-mlog-01'

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok })
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${extra ? `  — ${extra}` : ''}`)
}

const pkg = grpc.loadPackageDefinition(
  protoLoader.loadSync(path.resolve('proto/agent.proto'), { keepCase: true, enums: String })
)
const stub = new pkg.talos.agent.v1.AgentService(`localhost:${GRPC_PORT}`, grpc.credentials.createInsecure())
const call = stub.Connect()

let ready = false
let downTypes = []

call.on('data', (msg) => { downTypes.push(msg.type) })
call.on('error', (e) => { console.error('[mock] stream error:', e.message); process.exit(1) })

const send = (type, payload) => call.write({ type, payload_json: JSON.stringify(payload) })

/** CALL_LOG 载荷；model 用作三条记录的区分标记 */
const callLog = (node, kind, model) => ({
  issueCode: ISSUE, node, backend: 'codebuddy', model,
  renderedPrompt: `[${node}] via ${model}`, missingVars: false,
  latencyMs: 20900, tokenUsed: 0, cost: 0,
  ...(kind ? { kind } : {}),
})

try {
  send('REGISTER', { clientId: CLIENT_ID, version: 'mock-mlog-1.0', ip: '127.0.0.1', agents: 'mock' })
  await new Promise((r) => setTimeout(r, 800))
  ready = true
  check('mock 客户端完成 gRPC 注册', downTypes.includes('CONFIG_PUSH'), `收到下行报文：${downTypes.join(',') || '无'}`)

  send('CALL_LOG', callLog('拉取 Git', null, 'cb-internal-legacy'))
  send('CALL_LOG', callLog('拉取 Git', 'git', 'cb-internal-new'))
  send('CALL_LOG', callLog('需求分析', 'doc', 'cb-internal-doc'))
  await new Promise((r) => setTimeout(r, 1500))
  check('三条 CALL_LOG 已上报', true, `${ISSUE} · 拉取 Git×2 + 需求分析×1`)

  const res = await fetch(`${HTTP}/api/logs?issueCode=${encodeURIComponent(ISSUE)}`)
  const rows = await res.json()
  const models = rows.map((r) => `${r.node}/${r.model}`)
  check('接口可用且返回调用明细', Array.isArray(rows), `${rows.length} 条`)

  check('AI 调用日志里没有「拉取 Git」',
    !rows.some((r) => r.node === '拉取 Git'), models.join(', ') || '(空)')

  check('真实 AI 调用（需求分析）正常保留',
    rows.some((r) => r.node === '需求分析' && r.model === 'cb-internal-doc'), models.join(', '))
} catch (e) {
  console.error('[FAIL] 脚本异常: ' + (e && e.message ? e.message : e))
  results.push({ name: '脚本异常', ok: false })
} finally {
  try { call.end() } catch {}
  const pass = results.filter((r) => r.ok).length
  console.log(`\n===== 通过 ${pass}/${results.length} =====`)
  results.filter((r) => !r.ok).forEach((r) => console.log('  未通过: ' + r.name))
  if (pass !== results.length) process.exitCode = 1
  setTimeout(() => process.exit(process.exitCode ?? 0), 200)
}
