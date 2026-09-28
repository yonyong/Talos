import { useEffect, useRef, useState } from 'react'
import { authHeaders, clearAuth, withToken, type AuthUser } from './auth'
import type {
  Issue, ClientNode, AgentBackend, PromptTemplate, AiCallLog, DocItem,
  KbDoc, UserRow, Admission, WorkflowNode, WorkflowGraph, WorkflowEdge, InstanceGraph,
  TimelineNode, TerminalLine, RolePermission,
  BizDomain, BizTreeNode, Repo, SortPreview, SortMethod, ClientLogEntry, AgentRelease, AgentReleaseList,
  IssueDetail, IssueNode, TaskNodeRow, LlmChannel, LlmTestResult,
} from './types'

/* =========================================================================
 * 基址：相对 /api（开发经由 Vite 代理到 :8080；生产由 jar 同源托管）
 * ========================================================================= */
const BASE = '/api'

/**
 * 登录态收口：token 失效（401）时清掉本地凭据并把控制台退回登录页。
 * 只在已经进入控制台（#/app/...）时跳转——登录页自身打接口拿到 401 不该再跳一次。
 */
function onUnauthorized(msg: string): never {
  clearAuth()
  if (window.location.hash.startsWith('#/app')) {
    window.location.replace('#/login')
  }
  throw new Error(msg)
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // multipart 上传：不设 Content-Type，交给浏览器带 boundary
  const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData
  const headers: Record<string, string> = { ...authHeaders(), ...(init?.headers as Record<string, string> | undefined) }
  if (!isForm) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + path, { ...init, headers })
  if (res.status === 401) {
    let msg = '登录已失效，请重新登录'
    try { const b = await res.json(); if (b && b.message) msg = b.message } catch {}
    return onUnauthorized(msg)
  }
  if (!res.ok) {
    let msg = `请求失败 ${res.status}`
    try { const b = await res.json(); if (b && (b.message || b.error)) msg = b.message || b.error } catch {}
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

/* ============================ 后端原始类型 ============================ */
interface RawIssue {
  code: string; title: string; biz?: string; type?: string; owner?: string; reporter?: string
  dueDate?: string; priority?: string; status?: string; description?: string
  project?: string; repoUrl?: string; clientId?: string
  bizCode?: string; branch?: string; sortMethod?: string; sortReason?: string; candidateBiz?: string
  admissionResult?: string; confidence?: number; admissionReason?: string; kbHits?: string
  closeReason?: string
  createdAt?: string; updatedAt?: string
}
interface RawClient {
  clientId: string; owner?: string; ip?: string; version?: string
  status?: string; lastHeartbeat?: string; agentSummary?: string
}
interface RawAgent {
  id?: number; scope?: string; backend?: string; model?: string
  enabled?: boolean; tokenLimit?: number; monthlyQuota?: number | string
  transport?: string; execPath?: string; argsTemplate?: string; workDir?: string
  envVars?: string; minVersion?: string
  usagePercent?: number; privateOnly?: boolean; updatedAt?: string
}
interface RawPrompt {
  id?: number; name: string; scene?: string; backend?: string
  variables?: string; content?: string; updatedAt?: string
}
interface RawLog {
  issueCode?: string; node?: string; backend?: string; model?: string
  tokenUsed?: number; latencyMs?: number
  renderedPrompt?: string; renderedResponse?: string; missingVars?: boolean; createdAt?: string
}
interface RawDoc {
  id?: number; issueCode?: string; name?: string; kind?: string; source?: string; sizeText?: string
  category?: string; sizeBytes?: number; mimeType?: string; uploader?: string; createdAt?: string
  hasFile?: boolean; hasText?: boolean
}
interface RawKb { name: string; category?: string; chunks?: number; status?: string; content?: string }
interface RawUser { id?: number; name?: string; empNo?: string; email?: string; role?: string; bizDomain?: string; bizCodes?: string[]; clientId?: string }
interface RawRolePerm { id?: number; role?: string; capability?: string; level?: string }
interface RawTemplate { code?: string; name?: string; definitionJson?: string }
interface RawInstance {
  instanceCode?: string; issueCode?: string; templateCode?: string
  currentStep?: number; totalSteps?: number; status?: string; clientId?: string
}
interface RawNode {
  step?: number; name?: string; kind?: string; execLocation?: string
  backend?: string; model?: string; temperature?: number; maxTokens?: number
  promptTemplate?: string; gate?: string; tools?: string; status?: string; execLog?: string
  gateResult?: string | null; round?: number; startedAt?: string; finishedAt?: string
}
interface RawEdge { from: number; to: number; condition?: string; label?: string; kind?: string }

/* ============================ 格式化助手 ============================ */
function fmtYuan(n: number | string | null | undefined): string {
  if (n == null) return '¥ 0.0'
  const v = typeof n === 'string' ? parseFloat(n) : n
  if (!isFinite(v)) return '¥ 0.0'
  if (v === 0) return '¥ 0.0'
  return `¥ ${v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}
function relTime(iso?: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (isNaN(t)) return '—'
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return `${s}s 前`
  if (s < 3600) return `${Math.floor(s / 60)}m 前`
  if (s < 86400) return `${Math.floor(s / 3600)}h 前`
  return `${Math.floor(s / 86400)}d 前`
}
/** 字节数 -> 人类可读体积 */
export function fmtBytes(b?: number | null): string {
  if (b == null) return '—'
  if (b < 1024) return `${b} B`
  const kb = b / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return mb < 1024 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`
}
function fmtClock(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function fmtHMS(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/* ============================ 映射 ============================ */
const FRIENDLY_AGENT: Record<string, { name: string; logo: string }> = {
  claude: { name: 'Claude Code', logo: 'Cl' },
  cursor: { name: 'Cursor', logo: 'Cu' },
  codex: { name: 'Codex', logo: 'Cx' },
  codebuddy: { name: 'CodeBuddy', logo: 'CB' },
}
function agentLogo(b: string): string {
  if (FRIENDLY_AGENT[b]) return FRIENDLY_AGENT[b].logo
  return b.slice(0, 2).toUpperCase()
}
function agentName(b: string): string {
  if (FRIENDLY_AGENT[b]) return FRIENDLY_AGENT[b].name
  return b.charAt(0).toUpperCase() + b.slice(1)
}

function mapIssue(e: RawIssue): Issue {
  return {
    id: e.code, title: e.title, biz: e.biz ?? '', type: (e.type as Issue['type']) ?? 'REQ',
    owner: e.owner ?? '', reporter: e.reporter ?? e.owner ?? '—', due: e.dueDate ?? '—',
    priority: (e.priority as Issue['priority']) ?? 'P1', status: (e.status as Issue['status']) ?? 'admitting',
    desc: e.description, project: e.project, repo: e.repoUrl, clientId: e.clientId,
    bizCode: e.bizCode, branch: e.branch, sortMethod: e.sortMethod as SortMethod | undefined,
    sortReason: e.sortReason, candidateBiz: e.candidateBiz,
    admissionResult: e.admissionResult, admissionReason: e.admissionReason,
    confidence: e.confidence, closeReason: e.closeReason,
  }
}
function mapIssueNode(n: RawNode): IssueNode {
  return {
    step: n.step ?? 0, name: n.name ?? '—', kind: n.kind ?? 'doc',
    execLocation: n.execLocation, backend: n.backend, status: n.status, execLog: n.execLog,
    startedAt: n.startedAt, finishedAt: n.finishedAt,
  }
}
function mapClient(e: RawClient): ClientNode {
  const st = (e.status ?? 'OFFLINE').toLowerCase()
  const state: ClientNode['state'] = st === 'online' ? 'on' : st === 'busy' ? 'busy' : 'off'
  const agents = (e.agentSummary ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    id: e.clientId, owner: e.owner ?? '—', state, heartbeat: relTime(e.lastHeartbeat),
    version: e.version ?? '—', agents: agents.length ? agents : ['—'], ip: e.ip ?? '—',
  }
}
function mapAgent(e: RawAgent): AgentBackend {
  return {
    key: e.backend ?? 'unknown', name: agentName(e.backend ?? 'unknown'), logo: agentLogo(e.backend ?? 'unknown'),
    model: e.model ?? '—', enabled: !!e.enabled, cost: fmtYuan(e.monthlyQuota),
    usage: e.usagePercent ?? 0, privateOnly: !!e.privateOnly, id: e.id, scope: e.scope,
    transport: e.transport, execPath: e.execPath, argsTemplate: e.argsTemplate,
    workDir: e.workDir, envVars: e.envVars, minVersion: e.minVersion, tokenLimit: e.tokenLimit,
  }
}
function mapPrompt(e: RawPrompt): PromptTemplate {
  return {
    id: e.id, name: e.name, scene: e.scene ?? '—', backend: e.backend ?? '—',
    vars: e.variables ?? '—', content: e.content ?? '', updated: fmtClock(e.updatedAt),
  }
}
function mapLog(e: RawLog): AiCallLog {
  return {
    time: fmtHMS(e.createdAt), issue: e.issueCode ?? '—', backend: e.backend ?? '—', node: e.node ?? '—',
    model: e.model ?? '—', token: e.tokenUsed != null ? `${e.tokenUsed}` : '—',
    latency: e.latencyMs != null ? `${(e.latencyMs / 1000).toFixed(1)}s` : '—',
    missingVars: !!e.missingVars, prompt: e.renderedPrompt ?? '', output: e.renderedResponse ?? '（无输出）',
  }
}
function mapDoc(e: RawDoc): DocItem {
  return {
    id: e.id, issue: e.issueCode ?? '—', name: e.name ?? '未命名', from: e.source ?? '—',
    size: e.sizeText ?? (e.sizeBytes != null ? fmtBytes(e.sizeBytes) : '—'),
    bytes: e.sizeBytes, time: fmtClock(e.createdAt),
    kind: e.kind ?? (e.category === 'RAW' ? '原始材料' : '概要'),
    category: e.category === 'RAW' ? 'RAW' : 'PROCESS',
    mime: e.mimeType, uploader: e.uploader, hasFile: !!e.hasFile, hasText: !!e.hasText,
  }
}
function mapKb(e: RawKb): KbDoc {
  return { name: e.name, cat: e.category ?? '—', chunks: e.chunks ?? 0, status: (e.status as KbDoc['status']) ?? '已索引', content: e.content }
}
function mapUser(e: RawUser): UserRow {
  const codes = e.bizCodes ?? []
  return {
    id: e.id, name: e.name ?? '—', no: e.empNo ?? '—', role: e.role ?? 'guest',
    email: e.email ?? '',
    bizCodes: codes,
    biz: codes.length ? codes.join('、') : (e.bizDomain ?? '全部'),
    client: e.clientId ?? '—',
  }
}
function mapRolePerm(e: RawRolePerm): RolePermission {
  const lv = e.level === 'full' || e.level === 'part' || e.level === 'none' ? e.level : 'none'
  return { id: e.id, role: e.role ?? '', capability: e.capability ?? '', level: lv }
}
function parseKbHits(raw?: string): { doc: string; sim: number }[] {
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean).map((pair) => {
    const [doc, sim] = pair.split(':')
    return { doc: doc ?? '', sim: sim ? parseFloat(sim) : 0 }
  }).filter((h) => h.doc)
}
function mapAdmission(e: RawIssue): Admission {
  return {
    issueId: e.code, title: e.title, owner: e.owner ?? '—',
    result: (e.admissionResult as Admission['result']) ?? 'pending',
    confidence: e.confidence ?? 0, hits: parseKbHits(e.kbHits),
    project: e.project, repo: e.repoUrl, reason: e.admissionReason ?? '判定中…',
  }
}
function mapWorkflowNodes(json?: string): WorkflowNode[] {
  return mapWorkflowGraph(json).nodes
}
/** 兼容两代模板定义：旧版是节点数组（线性链），新版是 {nodes, edges} 图 */
function mapWorkflowGraph(json?: string): WorkflowGraph {
  if (!json) return { nodes: [], edges: [] }
  try {
    const parsed = JSON.parse(json) as RawNode[] | { nodes?: RawNode[]; edges?: RawEdge[] }
    const rawNodes = Array.isArray(parsed) ? parsed : (parsed.nodes ?? [])
    const nodes = rawNodes.map((n, i) => ({
      step: n.step ?? i + 1, name: n.name ?? `节点${i + 1}`,
      kind: (n.kind as WorkflowNode['kind']) ?? 'doc', tag: (n.kind ?? 'doc').toUpperCase(),
      exec: (n.execLocation as WorkflowNode['exec']) ?? '客户端', backend: n.backend ?? '—',
      model: n.model, temperature: n.temperature, maxTokens: n.maxTokens,
      prompt: n.promptTemplate ?? '—', gate: n.gate ?? '—', tools: n.tools,
      status: n.status, gateResult: n.gateResult ?? null, round: n.round, execLog: n.execLog,
    }))
    let edges: WorkflowEdge[]
    if (Array.isArray(parsed)) {
      edges = []
      for (let i = 0; i + 1 < nodes.length; i++) {
        edges.push({ from: nodes[i].step, to: nodes[i + 1].step, condition: 'always', label: '', kind: 'forward' })
      }
    } else {
      edges = (parsed.edges ?? []).map((e): WorkflowEdge => ({
        from: e.from, to: e.to,
        condition: e.condition ?? 'always', label: e.label ?? '',
        kind: e.kind === 'loopback' || e.kind === 'forward'
          ? e.kind
          : (e.to <= e.from ? 'loopback' : 'forward'),
      }))
    }
    return { nodes, edges }
  } catch { return { nodes: [], edges: [] } }
}
const NODE_STATUS_LABEL: Record<string, string> = {
  success: '已完成', running: '执行中', dispatched: '已下发',
  failed: '执行失败', blocked: '已阻塞', skipped: '已跳过', waiting: '待执行',
}
function mapTimelineNodes(nodes: RawNode[]): TimelineNode[] {
  const ICON: Record<string, string> = { git: 'git', doc: 'doc', code: 'code', test: 'test', rev: 'review' }
  return nodes.map((n) => {
    const st = (n.status ?? '').toLowerCase()
    const state: TimelineNode['state'] =
      st === 'success' ? 'done' : st === 'running' ? 'active' : st === 'failed' || st === 'blocked' ? 'fail' : ''
    return {
      name: n.name ?? `节点${n.step}`, state,
      text: n.execLog
        ? n.execLog.replace(/\s+/g, ' ').slice(0, 60)
        : (NODE_STATUS_LABEL[st] ?? (n.status ? `状态：${n.status}` : '未开始')),
      icon: ICON[n.kind ?? ''] ?? 'check',
    }
  })
}

/**
 * 节点原始行：execLog 保留全文。
 * 时间线视图为了版面只取前几十个字符，真正要看执行日志得用这个。
 */
function mapTaskNode(n: RawNode): TaskNodeRow {
  return {
    step: n.step ?? 0,
    name: n.name ?? `节点${n.step ?? ''}`,
    kind: n.kind,
    execLocation: n.execLocation,
    backend: n.backend,
    promptTemplate: n.promptTemplate,
    gate: n.gate,
    gateResult: n.gateResult ?? null,
    round: n.round,
    status: n.status,
    execLog: n.execLog ?? '',
    startedAt: n.startedAt,
    finishedAt: n.finishedAt,
  }
}

/* ============================ 高层 fetch ============================ */

/* ---- 登录：邮箱 + 邮件授权码（白名单接口，不需要 token） ---- */

/** 发授权码的结果：邮件地址已打码，只用于界面提示「已发送至 x***@y」 */
export interface SendCodeResult {
  sent: boolean
  /** false = 服务端沿用了有效期内的授权码，本次没有真的发新邮件 */
  resent: boolean
  email: string
  /** 授权码位数，前端据此限制输入长度 */
  codeLength: number
  /** 授权码有效期（秒） */
  expiresIn: number
  /** 距离下一次可以发信还有多少秒（0 = 现在就能发） */
  resendAfter: number
  /** 仅在服务端 expose-code=true（联调）时返回 */
  devCode?: string
}

export const sendLoginCode = (email: string, force = false) =>
  api<SendCodeResult>('/auth/send-code', { method: 'POST', body: JSON.stringify({ email, force }) })

export interface LoginResult {
  token: string
  expireAt: string
  ttlHours: number
  user: AuthUser
}

export const verifyLoginCode = (email: string, code: string) =>
  api<LoginResult>('/auth/verify', { method: 'POST', body: JSON.stringify({ email, code }) })

/** 校验当前 token 是否仍有效（服务端重启后会话即失效，前端启动时用它兜底） */
export const fetchMe = () => api<AuthUser>('/auth/me')

export const logout = () => api<{ loggedOut: boolean }>('/auth/logout', { method: 'POST' })

export const fetchIssues = (params?: { status?: string; type?: string; owner?: string }) => {
  const q = new URLSearchParams()
  if (params?.status) q.set('status', params.status)
  if (params?.type) q.set('type', params.type)
  if (params?.owner) q.set('owner', params.owner)
  const s = q.toString()
  return api<RawIssue[]>(`/issues${s ? `?${s}` : ''}`).then((r) => r.map(mapIssue))
}
export const createIssue = (body: Record<string, unknown>) =>
  api<RawIssue>('/issues', { method: 'POST', body: JSON.stringify(body) }).then(mapIssue)

/* ---- Issue 详情聚合与生命周期动作 ---- */
export const fetchIssueDetail = (code: string) =>
  api<{ issue: RawIssue; instance: RawInstance | null; nodes: RawNode[]; docs?: RawDoc[] }>(
    `/issues/${encodeURIComponent(code)}/detail`,
  ).then<IssueDetail>((r) => ({
    issue: mapIssue(r.issue),
    instance: r.instance ?? null,
    nodes: (r.nodes ?? []).map(mapIssueNode),
    docs: (r.docs ?? []).map(mapDoc),
  }))

/** 启动工作流：要求准入通过、未关闭且已分拣到仓库 */
export const startIssue = (code: string) =>
  api<{ started: boolean; instanceCode: string; status: string; currentStep: number; totalSteps: number }>(
    `/issues/${encodeURIComponent(code)}/start`, { method: 'POST' })

/** 改派责任人：只影响后续下发，执行中的实例客户端不变 */
export const reassignIssue = (code: string, owner: string) =>
  api<{ saved: boolean; code: string; from: string; owner: string; hint: string }>(
    `/issues/${encodeURIComponent(code)}/reassign`, { method: 'POST', body: JSON.stringify({ owner }) })

/** 关闭 Issue：同步取消未完成实例 */
export const closeIssue = (code: string, reason?: string) =>
  api<{ closed: boolean; code: string; cancelledInstance: string | null }>(
    `/issues/${encodeURIComponent(code)}/close`, { method: 'POST', body: JSON.stringify({ reason }) })

/** 重新处理：驳回 / 已关闭的 Issue 回到准入环节重判，可附带补充后的描述 */
export const reopenIssue = (code: string, description?: string) =>
  api<{ reopened: boolean; code: string; from: string; status: string; admissionResult: string | null; hint: string }>(
    `/issues/${encodeURIComponent(code)}/reopen`,
    { method: 'POST', body: JSON.stringify(description ? { description } : {}) },
  )

export const fetchClients = () => api<RawClient[]>('/clients').then((r) => r.map(mapClient))
export const fetchClientStats = () => api<{ total: number; online: number; offline: number; onlineRate: number }>('/clients/stats')

/* ---- 客户端：日志 / 诊断 / 升级 ---- */
interface RawLogBundle {
  clientId: string; online: boolean; total: number
  entries: { ts: string; level: ClientLogEntry['level']; source: string; message: string }[]
}
export const fetchClientLogs = (clientId: string, limit = 400) =>
  api<RawLogBundle>(`/clients/${encodeURIComponent(clientId)}/logs?limit=${limit}`).then((r) => ({
    clientId: r.clientId, online: r.online, total: r.total,
    entries: (r.entries ?? []).map<ClientLogEntry>((e) => ({
      ts: e.ts, level: e.level, source: e.source, message: e.message,
    })),
  }))

/** 让客户端把本机 logs/agent.log 尾部回传上来 */
export const pullClientLogs = (clientId: string, lines = 300) =>
  api<{ clientId: string; requested: boolean; hint: string }>(
    `/clients/${encodeURIComponent(clientId)}/logs/pull?lines=${lines}`, { method: 'POST' })

export const clearClientLogs = (clientId: string) =>
  api<{ clientId: string; cleared: number }>(`/clients/${encodeURIComponent(clientId)}/logs`, { method: 'DELETE' })

export const fetchClientAiLogs = (clientId: string) =>
  api<RawLog[]>(`/clients/${encodeURIComponent(clientId)}/ai-logs`).then((r) => r.map(mapLog))

/** 服务端当前发布的客户端版本（下载页与静默升级共用同一来源） */
export const fetchAgentRelease = () => api<AgentRelease>('/agent/release')
export const refreshAgentRelease = () => api<AgentRelease>('/agent/release/refresh', { method: 'POST' })

/** 版本库全量列表（接入指南页） */
export const fetchAgentReleaseList = () => api<AgentReleaseList>('/agent/release/list')

/** 上传客户端安装包（talos-agent-<版本>.jar / .zip）；multipart 不能带 JSON 头，单独走 fetch */
export async function uploadAgentRelease(file: File): Promise<AgentReleaseList> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(BASE + '/agent/release/upload', { method: 'POST', body: fd, headers: authHeaders() })
  if (res.status === 401) return onUnauthorized('登录已失效，请重新登录')
  if (!res.ok) {
    let msg = `上传失败 ${res.status}`
    try { const b = await res.json(); if (b && (b.message || b.error)) msg = b.message || b.error } catch {}
    throw new Error(msg)
  }
  return res.json() as Promise<AgentReleaseList>
}

/** 指定当前生效版本（可回退） */
export const activateAgentRelease = (version: string) =>
  api<AgentReleaseList>('/agent/release/activate', { method: 'POST', body: JSON.stringify({ version }) })

/** 删除某个安装包 */
export const deleteAgentReleaseFile = (fileName: string) =>
  api<AgentReleaseList>(`/agent/release/file?name=${encodeURIComponent(fileName)}`, { method: 'DELETE' })

export const reconnectClient = (clientId: string) =>
  api<{ clientId: string; online: boolean; requested: boolean; hint: string }>(
    `/clients/${encodeURIComponent(clientId)}/reconnect`, { method: 'POST' })
export const reconnectAllClients = () =>
  api<{ online: number; requested: number }>('/clients/reconnect-all', { method: 'POST' })

export const pushClientConfig = (clientId: string) =>
  api<{ clientId: string; pushed: boolean }>(`/clients/${encodeURIComponent(clientId)}/push-config`, { method: 'POST' })

export const upgradeClient = (clientId: string) =>
  api<{ clientId: string; pushed: boolean; version?: string; sha256?: string; hint: string }>(
    `/clients/${encodeURIComponent(clientId)}/upgrade`, { method: 'POST' })
export const upgradeAllClients = () =>
  api<{ target?: string; pushed: number; clients?: string[]; skipped?: string[]; hint?: string }>(
    '/clients/upgrade-all', { method: 'POST' })

/** 语义化版本比较，用于判断某客户端是否落后于发布版 */
export function versionOlder(cur?: string, latest?: string): boolean {
  if (!latest) return false
  if (!cur || cur === '—' || cur === 'dev') return true
  const a = cur.split(/[.\-+]/).map((s) => parseInt(s.replace(/\D/g, ''), 10) || 0)
  const b = latest.split(/[.\-+]/).map((s) => parseInt(s.replace(/\D/g, ''), 10) || 0)
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0
    if (x !== y) return x < y
  }
  return false
}

export const fetchAgents = (scope?: string) => {
  const s = scope && scope !== '全局默认' ? `?scope=${encodeURIComponent(scope)}` : ''
  return api<RawAgent[]>(`/agents/config${s}`).then((r) => r.map(mapAgent))
}
export const saveAgent = (cfg: RawAgent) =>
  api<RawAgent>('/agents/config', { method: 'POST', body: JSON.stringify(cfg) })
export const pushAllAgents = () => api<{ pushed: number }>('/agents/config/push-all', { method: 'POST' })
export const fetchAgentUsers = () =>
  api<{
    empNo: string; name: string; clientId: string; online: boolean;
    agents: { backend: string; execPath: string; model: string; enabled: boolean }[]
  }[]>('/agents/users')
export const fetchPrompts = () => api<RawPrompt[]>('/agents/prompts').then((r) => r.map(mapPrompt))

/** 保存模板：前端字段 vars ↔ 后端字段 variables，这里做一次映射 */
export const savePrompt = (t: {
  id?: number; name: string; scene: string; backend: string; vars: string; content: string
}) => api<RawPrompt>('/agents/prompts', {
  method: 'POST',
  body: JSON.stringify({
    id: t.id, name: t.name, scene: t.scene, backend: t.backend, variables: t.vars, content: t.content,
  }),
}).then(mapPrompt)

/** 删除模板：仍被工作流节点引用时后端返回 400，前端展示其 message */
export const deletePrompt = (id: number) =>
  api<{ deleted: boolean }>(`/agents/prompts/${id}`, { method: 'DELETE' })

/* ============================ 模型配置（API 形式 LLM） ============================ */
/** 通道列表。密钥不回传，只有 hasApiKey + 掩码 */
export const fetchLlmConfigs = () => api<LlmChannel[]>('/llm/config')

/**
 * 保存通道配置。
 * apiKey 传空字符串 = 保持原值；显式 clearKey=true 才是清空。
 */
export const saveLlmConfig = (c: {
  channel: string; label?: string; provider?: string; baseUrl?: string; model?: string
  temperature?: number; timeoutSeconds?: number; enabled?: boolean; privateOnly?: boolean
  apiKey?: string; clearKey?: boolean
}) => api<LlmChannel>('/llm/config', { method: 'POST', body: JSON.stringify(c) })

/** 连通性测试：真实发一条请求，失败原因原样返回 */
export const testLlmChannel = (channel: string) =>
  api<LlmTestResult>('/llm/test', { method: 'POST', body: JSON.stringify({ channel }) })

export const fetchLogs = (issueCode?: string) => {
  const s = issueCode ? `?issueCode=${encodeURIComponent(issueCode)}` : ''
  return api<RawLog[]>(`/logs${s}`).then((r) => r.map(mapLog))
}

export const fetchDocs = (params?: { issueCode?: string; kind?: string; category?: string }) => {
  const q = new URLSearchParams()
  if (params?.issueCode) q.set('issueCode', params.issueCode)
  if (params?.kind) q.set('kind', params.kind)
  if (params?.category) q.set('category', params.category)
  const s = q.toString()
  return api<RawDoc[]>(`/docs${s ? `?${s}` : ''}`).then((r) => r.map(mapDoc))
}

/**
 * 上传附件到 Issue：支持一次多个（Ctrl+V 粘贴 / 拖拽 / 选择）。
 * 默认记为提出人上传的原始材料（RAW），category='PROCESS' 时记为过程文档。
 */
export const uploadDocs = (
  issueCode: string,
  files: File[],
  opts?: { category?: 'RAW' | 'PROCESS'; kind?: string; uploader?: string },
) => {
  const fd = new FormData()
  for (const f of files) {
    // 粘贴的图片文件名常是 image.png，带上来源前缀避免重名混淆
    fd.append('files', f, f.name || 'pasted-file')
  }
  const q = new URLSearchParams({ issueCode, category: opts?.category ?? 'RAW' })
  if (opts?.kind) q.set('kind', opts.kind)
  if (opts?.uploader) q.set('uploader', opts.uploader)
  return api<{ saved: RawDoc[]; failed: string[] }>(`/docs/upload?${q}`, { method: 'POST', body: fd })
    .then((r) => ({ saved: (r.saved ?? []).map(mapDoc), failed: r.failed ?? [] }))
}

/** 删除文档（含落盘文件） */
export const deleteDoc = (id: number) =>
  api<{ deleted: boolean; id: number }>(`/docs/${id}`, { method: 'DELETE' })

/** 文档内容地址：文本/图片走 inline 预览，其他走下载。带 token —— <img>/<a> 直链发不了请求头 */
export const docRawUrl = (id: number, download = false) =>
  withToken(`${BASE}/docs/${id}/raw${download ? '?dl=1' : ''}`)

/** 读取文档纯文本（预览用；非文本类返回空串） */
export const fetchDocText = async (id: number): Promise<string> => {
  const res = await fetch(withToken(docRawUrl(id)), { headers: authHeaders() })
  if (res.status === 401) return onUnauthorized('登录已失效，请重新登录')
  if (!res.ok) throw new Error(`读取失败 ${res.status}`)
  return res.text()
}

export const fetchKb = () => api<RawKb[]>('/kb').then((r) => r.map(mapKb))
export const fetchKbDetail = (name: string) => api<RawKb>(`/kb/${encodeURIComponent(name)}`).then(mapKb)
export const searchKb = (q: string, topN = 5) =>
  api<{ doc: string; category?: string; sim: string }[]>(`/kb/search?q=${encodeURIComponent(q)}&topN=${topN}`)
    .then((r) => r.map((h) => ({ doc: h.doc, sim: parseFloat(h.sim), text: h.category ?? '' })))

export const fetchUsers = (role?: string) => {
  const s = role ? `?role=${encodeURIComponent(role)}` : ''
  return api<RawUser[]>(`/users${s}`).then((r) => r.map(mapUser))
}
/** 保存用户。bizCodes 未传（undefined）时后端保留原有业务域，传空数组才是清空。 */
export const saveUser = (u: RawUser) =>
  api<RawUser>('/users', { method: 'POST', body: JSON.stringify(u) })
export const deleteUser = (id: number) =>
  api<{ deleted: boolean }>(`/users/${id}`, { method: 'DELETE' })
/** 管理员解除用户与客户端的绑定（用户绑定后唯一的解绑出口） */
export const unbindClientUser = (clientId: string, empNo: string) =>
  api<{ clientId: string; empNo: string; name?: string; configPushed: boolean }>(
    `/clients/${encodeURIComponent(clientId)}/bound-users/${encodeURIComponent(empNo)}/unbind`,
    { method: 'POST' },
  )

export const fetchRoles = () => api<RawRolePerm[]>('/roles').then((r) => r.map(mapRolePerm))
export const saveRolePerm = (rp: RolePermission) =>
  api<RawRolePerm>('/roles', {
    method: 'POST',
    body: JSON.stringify({ role: rp.role, capability: rp.capability, level: rp.level }),
  }).then(mapRolePerm)

export const fetchAdmissions = () => api<RawIssue[]>('/admissions').then((r) => r.map(mapAdmission))
export const judgeAdmission = (code: string) =>
  api<RawIssue>(`/admissions/${encodeURIComponent(code)}/judge`, { method: 'POST' }).then(mapAdmission)
export const overrideAdmission = (code: string, result: string, operator = 'web') =>
  api<RawIssue>(`/admissions/${encodeURIComponent(code)}/override`, {
    method: 'POST', body: JSON.stringify({ result, operator }),
  }).then(mapAdmission)

export const fetchWorkflowTemplates = () =>
  api<RawTemplate[]>('/workflows/templates').then((r) => {
    const by = (code: string) => {
      const t = r.find((x) => x.code === code)
      return mapWorkflowGraph(t?.definitionJson)
    }
    return { REQ: by('REQ'), BUG: by('BUG') }
  })
/** 保存整张图：节点 + 条件边一起提交，服务端会先校验（悬空连线 / 自环直接 400） */
export const saveWorkflowTemplate = (code: 'REQ' | 'BUG', graph: WorkflowGraph) =>
  api<RawTemplate>(`/workflows/templates/${code}`, {
    method: 'POST',
    body: JSON.stringify({
      definitionJson: JSON.stringify({
        version: 2,
        nodes: graph.nodes.map((n) => ({
          step: n.step, name: n.name, kind: n.kind, execLocation: n.exec,
          backend: n.backend, model: n.model, temperature: n.temperature, maxTokens: n.maxTokens,
          promptTemplate: n.prompt, gate: n.gate, tools: n.tools,
        })),
        edges: graph.edges.map((e) => ({
          from: e.from, to: e.to, condition: e.condition || 'always',
          label: e.label ?? '', kind: e.kind ?? (e.to <= e.from ? 'loopback' : 'forward'),
        })),
      }),
    }),
  })
export const fetchWorkflowInstances = (status?: string) => {
  const s = status ? `?status=${encodeURIComponent(status)}` : ''
  return api<RawInstance[]>(`/workflows/instances${s}`)
}
export const fetchInstanceNodes = (code: string) =>
  api<RawNode[]>(`/workflows/instances/${encodeURIComponent(code)}/nodes`).then(mapTimelineNodes)

/** 实例节点原始行（含完整 execLog / 起止时间 / 轮次），监控页节点日志用 */
export const fetchTaskNodes = (code: string) =>
  api<RawNode[]>(`/workflows/instances/${encodeURIComponent(code)}/nodes`).then((r) => r.map(mapTaskNode))

/** 实例图 + 节点实时状态，监控页据此渲染带状态的 DAG */
export const fetchInstanceGraph = (instanceCode: string) =>
  api<InstanceGraph & { nodes: RawNode[]; edges: RawEdge[] }>(
    `/workflows/instances/${encodeURIComponent(instanceCode)}/graph`,
  ).then((r) => {
    const g = mapWorkflowGraph(JSON.stringify({ nodes: r.nodes, edges: r.edges }))
    return {
      ...g,
      instanceCode: r.instanceCode ?? null, issueCode: r.issueCode, templateCode: r.templateCode,
      status: r.status, round: r.round, maxRounds: r.maxRounds,
      currentStep: r.currentStep, totalSteps: r.totalSteps,
    } as InstanceGraph
  })

/** 按 Issue 取最新实例图（监控页深链用 issueCode 直接定位） */
export const fetchInstanceGraphByIssue = (issueCode: string) =>
  api<InstanceGraph & { nodes: RawNode[]; edges: RawEdge[] }>(
    `/workflows/instances/by-issue/${encodeURIComponent(issueCode)}/graph`,
  ).then((r) => {
    const g = mapWorkflowGraph(JSON.stringify({ nodes: r.nodes ?? [], edges: r.edges ?? [] }))
    return {
      ...g,
      instanceCode: r.instanceCode ?? null, issueCode: r.issueCode, templateCode: r.templateCode,
      status: r.status, round: r.round, maxRounds: r.maxRounds,
      currentStep: r.currentStep, totalSteps: r.totalSteps,
    } as InstanceGraph
  })

/**
 * 人工回执 / 节点推进。
 * step 传 0 或不传表示「自动挑选当前可推进节点」——图结构下可能有多个分支同时活跃，
 * 人工不必猜步骤号。
 */
export const advanceInstance = (instanceCode: string, step: number, success: boolean, log?: string) =>
  api<RawInstance>(`/workflows/instances/${encodeURIComponent(instanceCode)}/advance`, {
    method: 'POST', body: JSON.stringify({ step: step || null, success, log }),
  })

/** 人工取消实例 */
export const cancelInstance = (instanceCode: string, reason?: string) =>
  api<{ instanceCode: string; status: string }>(
    `/workflows/instances/${encodeURIComponent(instanceCode)}/cancel`,
    { method: 'POST', body: JSON.stringify({ reason }) },
  )

/**
 * 重新执行：step 省略 / 0 = 整图重跑（全部节点重置，从入口重新下发）；
 * 传 step = 从该节点（含下游）重跑，上游已完成的节点结果保留。
 */
export const rerunInstance = (instanceCode: string, step?: number, reason?: string) =>
  api<{ instanceCode: string; status: string }>(
    `/workflows/instances/${encodeURIComponent(instanceCode)}/rerun`,
    { method: 'POST', body: JSON.stringify({ step: step || null, reason }) },
  )

/* ============================ 业务域 / 仓库 / 分拣 ============================ */
function mapBiz(e: Partial<BizDomain>): BizDomain {
  return {
    id: e.id, code: e.code ?? '', name: e.name ?? '', parentCode: e.parentCode ?? null,
    repoProject: e.repoProject ?? null,
    keywords: e.keywords ?? '',
    bizOwners: e.bizOwners ?? '', devOwners: e.devOwners ?? '',
    defaultPriority: e.defaultPriority ?? 'P1',
    defaultClientId: e.defaultClientId,
    sensitiveLevel: (e.sensitiveLevel as BizDomain['sensitiveLevel']) ?? '普通',
    slaHours: e.slaHours, enabled: e.enabled !== false, description: e.description,
  }
}
function mapRepo(e: Partial<Repo>): Repo {
  return {
    id: e.id, project: e.project ?? '', bizCodes: e.bizCodes, repoUrl: e.repoUrl ?? '',
    baselineBranch: e.baselineBranch ?? 'main', branchPrefix: e.branchPrefix ?? 'feature/',
    language: e.language, buildCmd: e.buildCmd, testCmd: e.testCmd,
    sensitive: !!e.sensitive, requiredBackend: e.requiredBackend, defaultClientId: e.defaultClientId,
    enabled: e.enabled !== false, description: e.description,
  }
}

export const fetchBizDomains = () =>
  api<Partial<BizDomain>[]>('/biz/domains').then((r) => r.map(mapBiz))
export const saveBizDomain = (d: Partial<BizDomain>) =>
  api<{ saved: boolean; id: number; code: string; created: boolean }>('/biz/domains', {
    method: 'POST', body: JSON.stringify(d),
  })
export const deleteBizDomain = (id: number) =>
  api<{ deleted: boolean }>(`/biz/domains/${id}`, { method: 'DELETE' })

/** 业务树：一级业务域为根，children 递归；每个节点带自身/继承的仓库来源 */
function mapBizNode(e: Record<string, unknown>): BizTreeNode {
  const base = mapBiz(e as Partial<BizDomain>)
  const kids = Array.isArray(e.children) ? (e.children as Record<string, unknown>[]) : []
  const own = e.repo as Partial<Repo> | null | undefined
  const eff = e.effectiveRepo as Partial<Repo> | null | undefined
  return {
    ...base,
    children: kids.map(mapBizNode),
    repo: own ? mapRepo(own) : null,
    effectiveRepo: eff ? mapRepo(eff) : null,
    repoFrom: (e.repoFrom as string | null | undefined) ?? null,
  }
}
export const fetchBizTree = () =>
  api<Record<string, unknown>[]>('/biz/domains/tree').then((r) => r.map(mapBizNode))

export const fetchRepos = () => api<Partial<Repo>[]>('/repos').then((r) => r.map(mapRepo))
export const saveRepo = (r: Partial<Repo>) =>
  api<{ saved: boolean; id: number; created: boolean }>('/repos', {
    method: 'POST', body: JSON.stringify(r),
  })
export const deleteRepo = (id: number) =>
  api<{ deleted: boolean }>(`/repos/${id}`, { method: 'DELETE' })

/** 分拣预演：录入前先看「会分给谁、进哪个 Git」 */
export const sortPreview = (params: { title: string; desc?: string; biz?: string; code?: string }) => {
  const q = new URLSearchParams({ title: params.title })
  if (params.desc) q.set('desc', params.desc)
  if (params.biz) q.set('biz', params.biz)
  if (params.code) q.set('code', params.code)
  return api<SortPreview>(`/biz/sort-preview?${q.toString()}`)
}

/** 人工指定业务域重新分拣 */
export const resortIssue = (issueCode: string, bizCode?: string) =>
  api<{ saved: boolean; autoStarted?: string | null; result: SortPreview }>(
    `/biz/sort/${encodeURIComponent(issueCode)}`,
    { method: 'POST', body: JSON.stringify({ bizCode }) },
  )

/* ============================ 个人设置（多 Agent + Git 凭据 + 工具链） ============================ */
export interface UserAgentCfg {
  backend: string
  execPath?: string
  argsTemplate?: string
  workDir?: string
  envVars?: string
  model?: string
  tokenLimit?: number
  enabled: boolean
}

export interface UserProfile {
  empNo: string
  workDir?: string
  mavenHome?: string
  gitTokenSet?: boolean
  gitTokenMask?: string
  gitUserName?: string
  gitUserEmail?: string
  /** Git 测试仓库地址（持久化值，空则前端回落到第一个启用仓库） */
  gitTestRepoUrl?: string
  /** 工作流自动执行开关：准入通过且分拣成功后免人工启动（服务端缺省 true） */
  autoStart?: boolean
  agents?: UserAgentCfg[]
  boundClientId?: string | null
  boundUserName?: string | null
}

export interface ProbeResult {
  ok: boolean
  output?: string
  message?: string
}

/** token 永不回显明文，只有 gitTokenSet + 掩码 */
export const fetchUserProfile = (empNo: string) =>
  api<UserProfile>(`/profile/${encodeURIComponent(empNo)}`)

/** 保存结果里的下发状态：绑定客户端在线即已重推，离线则等其上线 */
export interface ProfileSaveResult {
  saved: boolean
  empNo?: string
  count?: number
  clientId?: string
  online?: boolean
  pushed?: boolean
}

/** 保存结果转提示文案：区分「已下发」「离线待补」「未绑定客户端」三种终态 */
export function profileSaveHint(r: ProfileSaveResult): string {
  if (r.pushed) return `配置已保存并下发到 ${r.clientId}`
  if (!r.clientId) return '配置已保存，但未绑定客户端，个人层暂不会下发'
  return `配置已保存，${r.clientId} 离线，将在其上线时自动补齐`
}

/** Git 凭据 + 工具链（workDir / mavenHome）；gitToken 传空 = 保持原值，clearGitToken=true 才清空 */
export const saveProfileSettings = (empNo: string, body: Record<string, unknown>) =>
  api<ProfileSaveResult>(`/profile/${encodeURIComponent(empNo)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

/** Agent 多条整表保存（顺序即优先级） */
export const saveProfileAgents = (empNo: string, agents: UserAgentCfg[]) =>
  api<ProfileSaveResult>(`/profile/${encodeURIComponent(empNo)}/agents`, {
    method: 'POST',
    body: JSON.stringify({ agents }),
  })

/* ---- 测试：全部经 gRPC 下发到绑定客户端本机真实执行 ---- */

export const probeAgent = (empNo: string, cfg: UserAgentCfg) =>
  api<ProbeResult>(`/profile/${encodeURIComponent(empNo)}/probe/agent`, {
    method: 'POST',
    body: JSON.stringify(cfg),
  })

export const probeGit = (empNo: string, repoUrl: string, gitToken?: string) =>
  api<ProbeResult>(`/profile/${encodeURIComponent(empNo)}/probe/git`, {
    method: 'POST',
    body: JSON.stringify({ repoUrl, gitToken }),
  })

export const probeToolchain = (empNo: string, workDir?: string, mavenHome?: string) =>
  api<ProbeResult>(`/profile/${encodeURIComponent(empNo)}/probe/toolchain`, {
    method: 'POST',
    body: JSON.stringify({ workDir, mavenHome }),
  })

/* ============================ useAsync Hook ============================ */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    fn()
      .then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  /**
   * 手动 / 定时重取。返回 Promise，调用方可以 await 后打「更新于 …」或做串行控制。
   * 开头先清 error：轮询场景下一次抖动留下的错误会一直挂在界面上，下次成功也不会消失。
   */
  const reload = () => {
    setLoading(true)
    setError(null)
    return fn()
      .then((d) => { setData(d) })
      .catch((e) => { setError(String(e)) })
      .finally(() => { setLoading(false) })
  }
  return { data, loading, error, reload }
}

/* =========================================================================
 * 轮询：作业监控这类「后台在跑、页面要跟着动」的视图用
 * ========================================================================= */

/**
 * 定时执行 fn。
 *
 * - `delay` 传函数时**每轮渲染重新求值**（不是每轮等待结束时），节拍一变立刻重排计时器 ——
 *   监控页据此在有节点在跑时用 5s、全停时拉长到 20s。若改成「等这轮走完再换」，
 *   页面首屏数据还没到时算出的 20s 会让第一次刷新白等一个空闲周期。
 * - 标签页在后台（`document.hidden`）时**跳过本轮**而不是照常请求：看不到的刷新没有意义。
 *   切回前台时 visibilitychange 立刻补一次，观感上仍是「一直是最新的」。
 * - `enabled=false` 完全停表，对接页面上的「暂停自动刷新」。
 * - fn 存在 ref 里：调用方每次渲染给新函数也不会重建计时器、丢掉当前这一轮等待。
 */
export function usePolling(fn: () => void, delay: number | (() => number), enabled = true) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const ms = typeof delay === 'function' ? delay() : delay

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let timer = 0
    // setTimeout 链而不是 setInterval：上一轮没结束不会堆积，且每轮都用最新的节拍
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (stopped) return
        if (!document.hidden) fnRef.current()
        schedule()
      }, ms)
    }
    schedule()
    const onVisible = () => { if (!document.hidden && !stopped) fnRef.current() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, ms])
}
