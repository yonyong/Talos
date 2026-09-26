import { useEffect, useState } from 'react'
import type {
  Issue, ClientNode, AgentBackend, PromptTemplate, AiCallLog, DocItem,
  KbDoc, UserRow, Admission, WorkflowNode, TimelineNode, TerminalLine, RolePermission,
} from './types'

/* =========================================================================
 * 基址：相对 /api（开发经由 Vite 代理到 :8080；生产由 jar 同源托管）
 * ========================================================================= */
const BASE = '/api'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
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
  admissionResult?: string; confidence?: number; admissionReason?: string; kbHits?: string
  createdAt?: string; updatedAt?: string
}
interface RawClient {
  clientId: string; owner?: string; ip?: string; version?: string
  status?: string; lastHeartbeat?: string; agentSummary?: string
}
interface RawAgent {
  id?: number; scope?: string; backend?: string; model?: string
  enabled?: boolean; tokenLimit?: number; monthlyQuota?: number | string
  httpEndpoint?: string; apiKey?: string; temperature?: number
  usagePercent?: number; privateOnly?: boolean; updatedAt?: string
}
interface RawPrompt { name: string; scene?: string; backend?: string; variables?: string; updatedAt?: string }
interface RawLog {
  issueCode?: string; node?: string; backend?: string; model?: string
  tokenUsed?: number; latencyMs?: number
  renderedPrompt?: string; renderedResponse?: string; missingVars?: boolean; createdAt?: string
}
interface RawDoc { issueCode?: string; name?: string; kind?: string; source?: string; sizeText?: string; createdAt?: string }
interface RawKb { name: string; category?: string; chunks?: number; status?: string; content?: string }
interface RawUser { id?: number; name?: string; empNo?: string; role?: string; bizDomain?: string; clientId?: string }
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
}

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
    httpEndpoint: e.httpEndpoint, apiKey: e.apiKey, temperature: e.temperature,
  }
}
function mapPrompt(e: RawPrompt): PromptTemplate {
  return { name: e.name, scene: e.scene ?? '—', backend: e.backend ?? '—', vars: e.variables ?? '—', updated: fmtClock(e.updatedAt) }
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
    issue: e.issueCode ?? '—', name: e.name ?? '未命名', from: e.source ?? '—',
    size: e.sizeText ?? '—', time: fmtClock(e.createdAt), kind: (e.kind as DocItem['kind']) ?? '概要',
  }
}
function mapKb(e: RawKb): KbDoc {
  return { name: e.name, cat: e.category ?? '—', chunks: e.chunks ?? 0, status: (e.status as KbDoc['status']) ?? '已索引', content: e.content }
}
function mapUser(e: RawUser): UserRow {
  return {
    id: e.id, name: e.name ?? '—', no: e.empNo ?? '—', role: e.role ?? 'guest',
    biz: e.bizDomain ?? '全部', client: e.clientId ?? '—',
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
  if (!json) return []
  try {
    const arr = JSON.parse(json) as RawNode[]
    return arr.map((n, i) => ({
      step: n.step ?? i + 1, name: n.name ?? `节点${i + 1}`,
      kind: (n.kind as WorkflowNode['kind']) ?? 'doc', tag: (n.kind ?? 'doc').toUpperCase(),
      exec: (n.execLocation as WorkflowNode['exec']) ?? '客户端', backend: n.backend ?? '—',
      model: n.model, temperature: n.temperature, maxTokens: n.maxTokens,
      prompt: n.promptTemplate ?? '—', gate: n.gate ?? '—', tools: n.tools,
    }))
  } catch { return [] }
}
function mapTimelineNodes(nodes: RawNode[]): TimelineNode[] {
  const ICON: Record<string, string> = { git: 'git', doc: 'doc', code: 'code', test: 'test', rev: 'review' }
  return nodes.map((n) => {
    const st = (n.status ?? '').toLowerCase()
    const state: TimelineNode['state'] =
      st === 'success' ? 'done' : st === 'running' ? 'active' : st === 'failed' || st === 'blocked' ? 'fail' : ''
    return {
      name: n.name ?? `节点${n.step}`, state,
      text: n.execLog ? n.execLog.slice(0, 60) : (n.status ? `状态：${n.status}` : '未开始'),
      icon: ICON[n.kind ?? ''] ?? 'check',
    }
  })
}

/* ============================ 高层 fetch ============================ */
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

export const fetchClients = () => api<RawClient[]>('/clients').then((r) => r.map(mapClient))
export const fetchClientStats = () => api<{ total: number; online: number; offline: number; onlineRate: number }>('/clients/stats')

export const fetchAgents = (scope?: string) => {
  const s = scope && scope !== '全局默认' ? `?scope=${encodeURIComponent(scope)}` : ''
  return api<RawAgent[]>(`/agents/config${s}`).then((r) => r.map(mapAgent))
}
export const saveAgent = (cfg: RawAgent) =>
  api<RawAgent>('/agents/config', { method: 'POST', body: JSON.stringify(cfg) })
export const pushAllAgents = () => api<{ pushed: number }>('/agents/config/push-all', { method: 'POST' })
export const fetchPrompts = () => api<RawPrompt[]>('/agents/prompts').then((r) => r.map(mapPrompt))

export const fetchLogs = (issueCode?: string) => {
  const s = issueCode ? `?issueCode=${encodeURIComponent(issueCode)}` : ''
  return api<RawLog[]>(`/logs${s}`).then((r) => r.map(mapLog))
}

export const fetchDocs = (params?: { issueCode?: string; kind?: string }) => {
  const q = new URLSearchParams()
  if (params?.issueCode) q.set('issueCode', params.issueCode)
  if (params?.kind) q.set('kind', params.kind)
  const s = q.toString()
  return api<RawDoc[]>(`/docs${s ? `?${s}` : ''}`).then((r) => r.map(mapDoc))
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
export const saveUser = (u: RawUser) =>
  api<RawUser>('/users', { method: 'POST', body: JSON.stringify(u) })
export const deleteUser = (id: number) =>
  api<{ deleted: boolean }>(`/users/${id}`, { method: 'DELETE' })

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
      return mapWorkflowNodes(t?.definitionJson)
    }
    return { REQ: by('REQ'), BUG: by('BUG') }
  })

export const saveWorkflowTemplate = (code: 'REQ' | 'BUG', nodes: WorkflowNode[]) =>
  api<RawTemplate>(`/workflows/templates/${code}`, {
    method: 'POST',
    body: JSON.stringify({
      definitionJson: JSON.stringify(nodes.map((n) => ({
        step: n.step, name: n.name, kind: n.kind, execLocation: n.exec,
        backend: n.backend, model: n.model, temperature: n.temperature, maxTokens: n.maxTokens,
        promptTemplate: n.prompt, gate: n.gate, tools: n.tools,
      }))),
    }),
  })
export const fetchWorkflowInstances = (status?: string) => {
  const s = status ? `?status=${encodeURIComponent(status)}` : ''
  return api<RawInstance[]>(`/workflows/instances${s}`)
}
export const fetchInstanceNodes = (code: string) =>
  api<RawNode[]>(`/workflows/instances/${encodeURIComponent(code)}/nodes`).then(mapTimelineNodes)

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

  const reload = () => {
    setLoading(true)
    fn().then((d) => setData(d)).catch((e) => setError(String(e))).finally(() => setLoading(false))
  }
  return { data, loading, error, reload }
}
