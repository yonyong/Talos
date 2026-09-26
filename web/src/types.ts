export type IssueType = 'REQ' | 'BUG'
export type IssueStatus = 'admitting' | 'admitted' | 'rejected' | 'sorting' | 'running' | 'blocked' | 'reviewing' | 'done'

export interface Issue {
  id: string
  title: string
  biz: string
  type: IssueType
  owner: string
  reporter: string
  due: string
  priority: 'P0' | 'P1' | 'P2'
  status: IssueStatus
  desc?: string
  project?: string
  repo?: string
  clientId?: string
}

export interface Admission {
  issueId: string
  title: string
  owner: string
  result: 'admit' | 'reject' | 'pending'
  confidence: number
  hits: { doc: string; sim: number }[]
  project?: string
  repo?: string
  reason: string
}

export type NodeKind = 'git' | 'doc' | 'code' | 'test' | 'rev'

export interface WorkflowNode {
  step: number
  name: string
  kind: NodeKind
  tag: string
  exec: '服务端' | '客户端'
  backend: string
  model?: string
  temperature?: number
  maxTokens?: number
  prompt: string
  gate: string
  tools?: string
}

export interface TimelineNode {
  name: string
  state: 'done' | 'active' | 'fail' | ''
  text: string
  icon: string
}

export interface ClientNode {
  id: string
  owner: string
  state: 'on' | 'busy' | 'off'
  heartbeat: string
  version: string
  agents: string[]
  ip: string
}

export interface AgentBackend {
  key: string
  name: string
  logo: string
  model: string
  enabled: boolean
  cost: string
  usage: number
  privateOnly?: boolean
  id?: number
  scope?: string
  httpEndpoint?: string
  apiKey?: string
  temperature?: number
}

export interface PromptTemplate {
  name: string
  scene: string
  backend: string
  vars: string
  updated: string
}

export interface AiCallLog {
  time: string
  issue: string
  backend: string
  node: string
  model: string
  token: string
  latency: string
  missingVars?: boolean
  prompt: string
  output: string
}

export interface DocItem {
  issue: string
  name: string
  from: string
  size: string
  time: string
  kind: '概要' | '详设' | '故障报告' | '修复方案' | '测试报告'
}

export interface KbDoc {
  name: string
  cat: string
  chunks: number
  status: '已索引' | '索引中' | '失败'
  content?: string
}

export interface TerminalLine {
  ts: string
  level: 'ok' | 'info' | 'warn' | 'err'
  text: string
}

export interface UserRow {
  id?: number
  name: string
  no: string
  role: string
  biz: string
  client: string
}

export type PermLevel = 'full' | 'part' | 'none'

export interface RolePermission {
  id?: number
  role: string
  capability: string
  level: PermLevel
}

export type PageKey =
  | 'dashboard' | 'issues' | 'admission' | 'workflow' | 'monitor'
  | 'clients' | 'agents' | 'logs' | 'docs' | 'kb'
  | 'users' | 'roles'
