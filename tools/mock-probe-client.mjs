/**
 * 模拟客户端：验证服务端 gRPC 探测链路（PROBE_REQ → PROBE_RESULT）。
 * 与真实 Java 客户端同构：主动 Connect 双向流 → REGISTER → 收 PROBE_REQ 在本机执行 → 回 PROBE_RESULT。
 * 用法: node mock-probe-client.mjs <port> <clientId>
 */
import { createRequire } from 'node:module'
import { exec } from 'node:child_process'
import path from 'node:path'

// ESM 不走 NODE_PATH，用 createRequire 指向托管 node workspace 解析依赖
const require = createRequire('C:/Users/yd236/.workbuddy/binaries/node/workspace/')
const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')

const port = process.argv[2] || '18080'
const CLIENT_ID = process.argv[3] || 'mock-probe-01'
const GRPC_PORT = process.argv[4] || String(Number(port) + 1000 + 343) // 8080→9443, 18080→19443

const pkg = grpc.loadPackageDefinition(
  protoLoader.loadSync(path.resolve('proto/agent.proto'), { keepCase: true, enums: String })
)
const stub = new pkg.talos.agent.v1.AgentService(`localhost:${GRPC_PORT}`, grpc.credentials.createInsecure())

let sender = null
let agentCount = 0

function send(type, payload) {
  if (!sender) return
  sender.write({ type, payload_json: JSON.stringify(payload) })
  console.log(`[mock] → ${type}`)
}

/** 本机真实执行探测（与 ProbeExecutor 语义一致） */
function runProbe(params) {
  const { kind, probeId } = params
  const done = (ok, output, message) =>
    send('PROBE_RESULT', { probeId, ok, output: String(output || '').slice(0, 4000), message: message || '' })

  try {
    if (kind === 'agent') {
      const execPath = params.execPath || 'cmd'
      exec(`"${execPath}" --version`, { timeout: 20000 }, (err, stdout, stderr) => {
        done(!err, stdout || stderr, err ? String(err.message) : '')
      })
    } else if (kind === 'git') {
      const repoUrl = params.repoUrl
      const token = params.token
      if (!repoUrl) {
        exec('git --version', { timeout: 20000 }, (err, stdout, stderr) => {
          done(!err, stdout || stderr, err ? 'git 不可用: ' + err.message : '')
        })
      } else {
        const authed = token ? repoUrl.replace(/^https:\/\//, `https://oauth2:${token}@`) : repoUrl
        exec(`git ls-remote --heads "${authed}"`, { timeout: 25000 }, (err, stdout, stderr) => {
          done(!err, stdout || stderr, err ? '仓库不可达: ' + (stderr || err.message) : '')
        })
      }
    } else if (kind === 'toolchain') {
      // 简化：目录存在性 + mvn --version
      const parts = []
      const finish = () => done(true, parts.join('\n'), '')
      if (params.workDir) {
        parts.push(`workDir ${params.workDir}: 见 output`)
      }
      exec('mvn --version', { timeout: 20000 }, (err, stdout) => {
        parts.push(err ? `mvn: 不可用 (${err.message.split('\n')[0]})` : `mvn: ${(stdout || '').split('\n')[0]}`)
        finish()
      })
    } else {
      done(false, '', '未知探测类型: ' + kind)
    }
  } catch (e) {
    done(false, '', String(e))
  }
}

const call = stub.Connect()
call.on('data', (msg) => {
  let payload = {}
  try { payload = JSON.parse(msg.payload_json) } catch {}
  console.log(`[mock] ← ${msg.type}`)
  if (msg.type === 'PROBE_REQ') runProbe(payload)
  else if (msg.type === 'CONFIG_PUSH') {
    const agents = Array.isArray(payload.agents) ? payload.agents : []
    agentCount = agents.length
    console.log(`[mock]   CONFIG_PUSH: scope=${payload.scope} agents=${agents.length} ` +
      `defaultBackend=${payload.defaultBackend || '-'} git=${payload.git ? '已下发' : '-'}` +
      (payload.toolchain ? ` toolchain=${JSON.stringify(payload.toolchain)}` : ''))
    for (const a of agents) console.log(`[mock]     agent: ${a.backend} exec=${a.execPath || '-'}`)
  }
})
call.on('error', (e) => { console.error('[mock] stream error:', e.message); process.exit(1) })
call.on('end', () => { console.log('[mock] stream ended'); process.exit(0) })

sender = call
send('REGISTER', { clientId: CLIENT_ID, version: 'mock-1.0', ip: '127.0.0.1', agents: 'probe' })
setInterval(() => send('HEARTBEAT', { clientId: CLIENT_ID }), 10000)
setInterval(() => console.log(`[mock] alive (agents in push: ${agentCount})`), 30000)
