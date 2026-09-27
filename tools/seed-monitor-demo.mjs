/**
 * 作业监控页验证数据生成器。
 *
 * DataInitializer 不造 Issue / 工作流实例，所以「作业监控」初始是空态。
 * 本脚本走真实链路把实例造出来：录入 → 准入 override → 分拣 → start → advance 灌节点日志，
 * 可直接用于本地验证与截图。
 *
 * 用法： node tools/seed-monitor-demo.mjs [baseUrl]     默认 http://127.0.0.1:28080
 */

const BASE = process.argv[2] ?? 'http://127.0.0.1:28080'

async function api(path, init) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${path} → ${text.slice(0, 300)}`)
  try { return JSON.parse(text) } catch { return text }
}

const post = (p, body) => api(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined })

/** 节点序号 → 一段像样的 CLI 完整输出（真实跑起来时由客户端回执写入 exec_log） */
const LOGS = [
  `$ git clone git@gityonyong.dev:quote/quote-service.git workspace/quote-service
Cloning into 'workspace/quote-service'...
remote: Counting objects: 4821, done.
remote: Compressing objects: 100% (3187/3187), done.
Receiving objects: 100% (4821/4821), 12.44 MiB | 6.20 MiB/s, done.
Resolving deltas: 100% (2874/2874), done.
$ git checkout -b feature/req-2201 origin/main
Switched to a new branch 'feature/req-2201'
branch 'feature/req-2201' set up to track 'origin/main'.
工作分支确定: feature/req-2201（基线 main，HEAD e83f9d7）
耗时 43.2s`,

  `$ claude -p "分析需求 REQ-2201：行情推送偶发丢包，定位可能原因并输出影响面清单。" --model claude-sonnet-4
[思考] 从连接层 / 序列化层 / 消费端确认三个层面展开
[读取] src/main/java/com/yonyong/quote/push/QuotePushService.java
[读取] src/main/java/com/yonyong/quote/net/ChannelManager.java
[读取] docs/quote/architecture.md

结论：
1. 连接层：心跳间隔 30s，弱网下 TCP 重传未触发重连（P1）
2. 序列化层：批量推送 batchSize=200，单包超过 MTU 时未分片（P0）
3. 消费端：ACK 超时 500ms，弱网下误判失败并丢弃（P1）

影响面：行情推送链路 4 个模块 11 个类，涉及 2 个下游订阅方
Token 使用 6,412 / 8,192 · 耗时 18.4s`,

  `$ claude -p "基于需求分析产出详细设计文档，覆盖分片策略、ACK 重试与重连判定。" --model claude-sonnet-4
[产出] docs/req-2201/detail-design.md（2,140 字）
[产出] docs/req-2201/sequence.puml
[校验] 与现有 ChannelManager 接口签名一致
Token 使用 9,880 / 16,384 · 耗时 27.1s`,

  `$ claude -p "评审详细设计：检查边界条件与回滚方案。" --model claude-sonnet-4
[评审] 分片阈值 1400B 合理，但缺少分片重组的超时保护
[评审] ACK 重试 3 次后应降级为离线补推，当前设计是直接丢弃
[结论] 需补充 2 项后通过
Token 使用 5,102 / 8,192 · 耗时 12.7s`,

  `$ claude -p "按详细设计实现分片推送与 ACK 重试。" --model claude-sonnet-4
[修改] QuotePushService.java  (+184 -42)
[修改] ChannelManager.java     (+61 -12)
[新增] PacketSplitter.java     (+96)
$ mvn -q -DskipTests compile
BUILD SUCCESS · 4.82s
Token 使用 21,340 / 32,768 · 耗时 96.5s`,

  `$ mvn -q test -Dtest=QuotePushServiceTest,ChannelManagerTest
Tests run: 34, Failures: 0, Errors: 0, Skipped: 1
BUILD SUCCESS · 27.9s
耗时 27.9s`,
]

/** 造一个 Issue 并推进到「第 doneN 个节点完成」，返回实例码 */
async function seed({ title, type, priority, doneN }) {
  const issue = await post('/api/issues', {
    title, type, bizCode: 'quote', owner: '王磊', reporter: '李娜', priority,
    description: '作业监控页布局重构后的验证数据。', dueDate: '2026-10-30',
  })
  const code = issue.code ?? issue.id
  await post(`/api/admissions/${code}/override`, { result: 'admit', operator: 'seed' })
  await post(`/api/biz/sort/${code}`)
  await post(`/api/issues/${code}/start`)

  const insts = await api('/api/workflows/instances')
  const inst = insts.find((i) => i.issueCode === code)
  if (!inst?.instanceCode) throw new Error(`未找到 ${code} 的实例`)

  for (let i = 0; i < doneN; i++) {
    await post(`/api/workflows/instances/${inst.instanceCode}/advance`, {
      step: 0, success: true, log: LOGS[i] ?? `节点回执：执行成功·第 ${i + 1} 步`,
    })
  }
  console.log(`  ${code} → ${inst.instanceCode} · 推进 ${doneN} 个节点 · ${title}`)
  return inst.instanceCode
}

const targets = [
  { title: '行情推送偶发丢包：弱网下订阅端收不到增量', type: 'REQ', priority: 'P1', doneN: 3 },
  { title: '行情快照接口在开盘瞬间超时', type: 'BUG', priority: 'P0', doneN: 6 },
]

console.log(`seed → ${BASE}`)
for (const t of targets) await seed(t)
const all = await api('/api/workflows/instances')
console.log(`完成：共 ${all.length} 个实例`)
for (const i of all) console.log(`  ${i.instanceCode}  ${i.issueCode}  ${i.status}  ${i.currentStep}/${i.totalSteps}`)
