export type IssueType = 'REQ' | 'BUG'
export type IssueStatus = 'admitting' | 'admitted' | 'rejected' | 'sorting' | 'running' | 'blocked' | 'reviewing' | 'done' | 'closed'

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
  bizCode?: string
  branch?: string
  sortMethod?: SortMethod
  sortReason?: string
  candidateBiz?: string
  admissionResult?: string
  admissionReason?: string
  confidence?: number
  closeReason?: string
}

/** 工作流实例（详情聚合用） */
export interface IssueInstance {
  instanceCode?: string
  issueCode?: string
  templateCode?: string
  currentStep?: number
  totalSteps?: number
  status?: string
  clientId?: string
}

/** 实例节点原始状态（详情内嵌时间线用） */
export interface IssueNode {
  step: number
  name: string
  kind: string
  execLocation?: string
  backend?: string
  status?: string
  execLog?: string
  /** 节点下发时刻（服务端 pushNext 时写入） */
  startedAt?: string
  /** 节点回执/跳过/取消时刻 */
  finishedAt?: string
}

export interface IssueDetail {
  issue: Issue
  instance: IssueInstance | null
  nodes: IssueNode[]
  /** 该 Issue 的全部文档：原始材料 + 过程文档 */
  docs: DocItem[]
}

export type SortMethod = 'auto' | 'llm' | 'manual' | 'none'

export interface BizDomain {
  id?: number
  code: string
  name: string
  /** 父业务域编码；为空即一级业务域 */
  parentCode?: string | null
  /** 本业务域绑定的仓库项目名；空 = 未绑定，沿父链继承 */
  repoProject?: string | null
  keywords: string
  /** 业务负责人：多人逗号分隔，顺序即优先级（第 1 人为主责） */
  bizOwners: string
  /** 开发负责人：多人逗号分隔，顺序即优先级；第 1 人为分拣默认承接人 */
  devOwners: string
  defaultPriority: string
  defaultClientId?: string
  sensitiveLevel: '普通' | '敏感' | '核心'
  slaHours?: number
  enabled: boolean
  description?: string
}

/**
 * 业务树节点：业务域字段 + 子节点 + 仓库来源。
 * 子域未配仓库时 effectiveRepo 沿父链上溯，repoFrom 记录实际提供方。
 */
export interface BizTreeNode extends BizDomain {
  children: BizTreeNode[]
  /** 自身绑定的仓库 */
  repo?: Repo | null
  /** 仓库来自哪个祖先的 code；为 null 表示用的是自身仓库或根本没有 */
  repoFrom?: string | null
  /** 实际生效的仓库（自身或继承） */
  effectiveRepo?: Repo | null
}

export interface Repo {
  id?: number
  project: string
  /** 编辑仓库时提交的归属业务域编码列表；一个仓库可服务多个业务域 */
  bizCodes?: string[]
  repoUrl: string
  baselineBranch?: string
  branchPrefix?: string
  language?: string
  buildCmd?: string
  testCmd?: string
  sensitive?: boolean
  requiredBackend?: string
  defaultClientId?: string
  enabled: boolean
  description?: string
}

export interface SortCandidate {
  code: string
  name: string
  matched?: string[]
}

export interface SortPreview {
  resolved: boolean
  method: SortMethod
  reason: string
  bizCode?: string
  bizName?: string
  owner?: string
  project?: string
  repoUrl?: string
  baselineBranch?: string
  branch?: string
  priority?: string
  clientId?: string
  sensitiveLevel?: string
  sensitiveRepo?: boolean
  requiredBackend?: string
  /** 命中子域且关键配置继承自祖先时，记录实际提供方 */
  inheritedFrom?: string | null
  candidates?: SortCandidate[]
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
  /** 实例视图才有：节点实时状态 */
  status?: string
  gateResult?: string | null
  round?: number
  execLog?: string
}

/** 条件边：condition 支持 always / gate:pass / gate:blocked / success / failed / expr:... */
export interface WorkflowEdge {
  from: number
  to: number
  condition: string
  label?: string
  /** forward 前向；loopback 回退重做（会重置路径上的节点） */
  kind?: 'forward' | 'loopback'
}

export interface WorkflowGraph {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

/** 实例图：模板图 + 节点实时状态 */
export interface InstanceGraph extends WorkflowGraph {
  instanceCode?: string | null
  issueCode?: string
  templateCode?: string
  status?: string
  round?: number
  maxRounds?: number
  currentStep?: number
  totalSteps?: number
}

/**
 * 跨页定位参数：从总览下钻时携带的筛选 / 定位条件。
 * Console.nav(page, focus) 的第二个参数就是它。
 */
export interface PageFocus {
  /** 直接打开该 Issue 详情 */
  issueCode?: string
  /** Issue 状态筛选 */
  status?: string
  /** 直接展开该客户端的日志 */
  clientId?: string
  /** 只看离线客户端 */
  offline?: boolean
  /** 只看异常 / 过期的客户端 */
  outdated?: boolean
  /** 预置搜索词 */
  q?: string
  /** 时间戳，保证同页重复下钻时也能触发副作用 */
  at?: number
}

export interface TimelineNode {
  name: string
  state: 'done' | 'active' | 'fail' | ''
  text: string
  icon: string
}

/**
 * 实例节点的完整原始行（t_task_node）。
 * 与 TimelineNode 的区别：这里保留 execLog 全文，供监控页展开查看节点执行日志。
 */
export interface TaskNodeRow {
  step: number
  name: string
  kind?: string
  execLocation?: string
  backend?: string
  promptTemplate?: string
  gate?: string
  gateResult?: string | null
  round?: number
  status?: string
  execLog: string
  startedAt?: string
  finishedAt?: string
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

/** 客户端运行日志条目：source=server 为链路事件，source=agent 为终端回传的本地日志 */
export interface ClientLogEntry {
  ts: string
  level: 'ok' | 'info' | 'warn' | 'err'
  source: string
  message: string
}

/** 服务端当前发布的客户端版本 */
export interface AgentRelease {
  available: boolean
  version?: string
  fileName?: string
  size?: number
  sha256?: string
  updatedAt?: string
  downloadUrl?: string
  releaseDir?: string
  hint?: string
}

/** 版本库中的一个安装包 */
export interface AgentReleaseItem {
  version: string
  fileName: string
  size: number
  sha256: string
  updatedAt: string
  downloadUrl: string
  current?: boolean
}

/** 版本库全量列表（接入指南页的版本管理） */
export interface AgentReleaseList {
  releaseDir?: string
  available: boolean
  current: AgentReleaseItem | null
  versions: AgentReleaseItem[]
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
  transport?: string
  execPath?: string
  argsTemplate?: string
  workDir?: string
  envVars?: string
  minVersion?: string
  tokenLimit?: number
}

export interface PromptTemplate {
  id?: number
  name: string
  scene: string
  backend: string
  vars: string
  /** 模板正文，{{var}} 占位 */
  content?: string
  updated: string
}

/** API 形式的 LLM 通道配置。apiKey 永不回传，只给「是否已配置 + 掩码」 */
export interface LlmChannel {
  id?: number
  channel: 'PUBLIC' | 'PRIVATE'
  label?: string
  /** qwen | zhipu | openai-compatible */
  provider?: string
  baseUrl?: string
  model?: string
  temperature?: number
  timeoutSeconds?: number
  enabled: boolean
  /** 私有化通道：禁止公网出站 */
  privateOnly?: boolean
  hasApiKey: boolean
  apiKeyMasked?: string | null
  lastTestResult?: string
  lastTestAt?: string
  updatedAt?: string
}

export interface LlmTestResult {
  ok: boolean
  message: string
  latencyMs?: number
  sample?: string
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

/** RAW = 提出人上传的原始材料；PROCESS = 工作流过程产出（客户端回传） */
export type DocCategory = 'RAW' | 'PROCESS'

export interface DocItem {
  id?: number
  issue: string
  name: string
  from: string
  size: string
  bytes?: number
  time: string
  kind: string
  category: DocCategory
  mime?: string
  uploader?: string
  /** 是否落盘了真实文件（过程文档可能只有正文） */
  hasFile?: boolean
  hasText?: boolean
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
  /** 主角色（roles[0]），兼容旧筛选 */
  role: string
  /** 拥有的全部角色编码 */
  roles: string[]
  /** 兼容展示用：业务域名称（存量单值或编码拼接）；新数据以 bizCodes 为准 */
  biz: string
  /** 归属业务域编码列表，与仓库 bizCodes 一致 */
  bizCodes?: string[]
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
  | 'workbench' | 'dashboard' | 'issues' | 'admission' | 'workflow' | 'monitor'
  | 'clients' | 'guide' | 'agents' | 'logs' | 'docs' | 'kb'
  | 'biz' | 'repos' | 'prompts' | 'models'
  | 'users' | 'roles'
