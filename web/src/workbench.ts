/**
 * 我的工作台：按激活角色生成 KPI / 待办 / CTA。
 * 纯函数，便于单测；页面只负责拉数与渲染。
 */
import type { BizDomain, ClientNode, Issue, PageFocus, PageKey, UserRow } from './types'
import { roleLabel } from './constants'

export type RoleCode = 'admin' | 'pm' | 'lead' | 'dev' | 'qa' | 'guest'

export const ROLE_CODES: RoleCode[] = ['admin', 'pm', 'lead', 'dev', 'qa', 'guest']

export function isRoleCode(v: string): v is RoleCode {
  return (ROLE_CODES as string[]).includes(v)
}

export function parseRoles(raw?: string | string[] | null): RoleCode[] {
  const list = Array.isArray(raw)
    ? raw
    : (raw ?? '').split(/[,，]/).map((s) => s.trim()).filter(Boolean)
  const out: RoleCode[] = []
  for (const r of list) {
    const k = r.toLowerCase()
    if (isRoleCode(k) && !out.includes(k)) out.push(k)
  }
  return out.length ? out : ['guest']
}

/** 平台总览仅 admin / lead 激活态可见 */
export function canSeePlatformOverview(active: RoleCode): boolean {
  return active === 'admin' || active === 'lead'
}

const OPEN = new Set(['admitting', 'admitted', 'sorting', 'running', 'blocked', 'reviewing'])

export function isOpenIssue(i: Issue): boolean {
  return OPEN.has(i.status)
}

export function isMe(issueField: string, name: string, empNo: string): boolean {
  const v = (issueField || '').trim()
  if (!v) return false
  return v === name.trim() || v === empNo.trim()
}

/** 沿 parentCode 展开：用户域 + 所有子孙域 */
export function expandBizCodes(rootCodes: string[], domains: BizDomain[]): Set<string> {
  const roots = new Set(rootCodes.filter(Boolean))
  if (!roots.size) return roots
  const byParent = new Map<string, string[]>()
  for (const d of domains) {
    const p = d.parentCode || ''
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p)!.push(d.code)
  }
  const out = new Set<string>(roots)
  const walk = (code: string) => {
    for (const c of byParent.get(code) ?? []) {
      if (out.has(c)) continue
      out.add(c)
      walk(c)
    }
  }
  for (const r of roots) walk(r)
  return out
}

export function inBizScope(issue: Issue, scope: Set<string>): boolean {
  if (!scope.size) return false
  if (issue.bizCode && scope.has(issue.bizCode)) return true
  // 存量可能只写了业务名
  return !!issue.biz && [...scope].some((c) => issue.biz.includes(c))
}

export interface WorkbenchKpi {
  key: string
  icon: string
  label: string
  value: string
  delta?: string
  dir?: 'up' | 'down' | 'flat'
  color: string
  focus?: { page: PageKey; focus?: PageFocus }
}

export interface WorkbenchTodo {
  key: string
  title: string
  sub: string
  badge: string
  tone: 'ok' | 'warn' | 'err' | 'info' | 'prog' | 'mut'
  page: PageKey
  focus?: PageFocus
}

export interface WorkbenchCta {
  label: string
  page: PageKey
  focus?: PageFocus
  primary?: boolean
  icon?: string
}

export interface WorkbenchModel {
  headline: string
  emptyTodo: string
  kpis: WorkbenchKpi[]
  todos: WorkbenchTodo[]
  sideTitle: string
  sideLines: { text: string; tone?: 'ok' | 'warn' | 'err' | 'mut'; go?: { page: PageKey; focus?: PageFocus } }[]
  ctas: WorkbenchCta[]
  shortcuts: WorkbenchCta[]
}

const SEV: Record<string, number> = {
  blocked: 0, rejected: 1, reviewing: 2, admitting: 3, sorting: 4, running: 5, admitted: 6,
}

function sortTodos(items: WorkbenchTodo[], issues: Issue[]): WorkbenchTodo[] {
  const byId = new Map(issues.map((i) => [i.id, i]))
  return [...items].sort((a, b) => {
    const ia = byId.get(a.focus?.issueCode ?? a.key)
    const ib = byId.get(b.focus?.issueCode ?? b.key)
    const sa = ia ? (SEV[ia.status] ?? 9) : 9
    const sb = ib ? (SEV[ib.status] ?? 9) : 9
    if (sa !== sb) return sa - sb
    return (a.title || '').localeCompare(b.title || '')
  })
}

function todoFromIssue(i: Issue, badge: string, tone: WorkbenchTodo['tone'], sub?: string): WorkbenchTodo {
  return {
    key: i.id,
    title: i.title,
    sub: sub ?? `${i.id} · ${i.biz || '—'}${i.owner ? ` · ${i.owner}` : ''}`,
    badge,
    tone,
    page: 'issues',
    focus: { issueCode: i.id, status: i.status },
  }
}

export function buildWorkbench(input: {
  activeRole: RoleCode
  me: { name: string; no: string; bizCodes: string[]; clientId: string }
  issues: Issue[]
  clients: ClientNode[]
  domains: BizDomain[]
  activeInst: number
  aiCalls: number
}): WorkbenchModel {
  const { activeRole, me, issues, clients, domains, activeInst, aiCalls } = input
  const scope = expandBizCodes(me.bizCodes, domains)
  const myClient = me.clientId ? clients.find((c) => c.id === me.clientId) : undefined
  const reported = issues.filter((i) => isMe(i.reporter, me.name, me.no))
  const owned = issues.filter((i) => isMe(i.owner, me.name, me.no))
  const inBiz = issues.filter((i) => inBizScope(i, scope))

  switch (activeRole) {
    case 'pm': {
      const open = reported.filter(isOpenIssue)
      const bad = reported.filter((i) => i.status === 'rejected' || i.status === 'blocked' || i.status === 'admitting')
      const running = reported.filter((i) => i.status === 'running')
      const blocked = reported.filter((i) => i.status === 'blocked')
      const todos = sortTodos([
        ...reported.filter((i) => i.status === 'rejected').map((i) => todoFromIssue(i, '已驳回', 'err', '需修改后重新提交')),
        ...blocked.map((i) => todoFromIssue(i, '阻塞', 'warn')),
        ...reported.filter((i) => i.status === 'admitting').map((i) => todoFromIssue(i, '准入中', 'mut')),
      ], issues).slice(0, 8)
      return {
        headline: '盯住你提报的需求，从准入到交付',
        emptyTodo: '暂无需要你处理的提报事项',
        kpis: [
          { key: 'open', icon: 'issue', label: '我提报未闭环', value: String(open.length), color: '#4f46e5', focus: { page: 'issues' } },
          { key: 'adm', icon: 'filter', label: '准入中 / 驳回', value: String(bad.length), color: '#b45309', focus: { page: 'admission' } },
          { key: 'run', icon: 'flow', label: '执行中', value: String(running.length), color: '#0891b2', focus: { page: 'monitor' } },
          { key: 'blk', icon: 'warn', label: '阻塞', value: String(blocked.length), color: '#b91c1c', focus: { page: 'issues', focus: { status: 'blocked' } } },
        ],
        todos,
        sideTitle: '我提报的近期',
        sideLines: reported.slice(0, 5).map((i) => ({
          text: `${i.id} · ${i.title}`,
          tone: i.status === 'blocked' || i.status === 'rejected' ? 'warn' : 'mut',
          go: { page: 'issues' as PageKey, focus: { issueCode: i.id } },
        })),
        ctas: [{ label: '新建 Issue', page: 'issues', primary: true, icon: 'plus' }],
        shortcuts: [
          { label: 'Issue', page: 'issues' },
          { label: '准入判定', page: 'admission' },
        ],
      }
    }
    case 'lead': {
      const sorting = inBiz.filter((i) => i.status === 'sorting' || i.status === 'admitted')
      const blocked = inBiz.filter((i) => i.status === 'blocked' || i.status === 'reviewing')
      const running = inBiz.filter((i) => i.status === 'running')
      const offline = clients.filter((c) => c.state === 'off').length
      const todos = sortTodos([
        ...sorting.map((i) => todoFromIssue(i, i.status === 'sorting' ? '待分拣' : '待启动', 'prog')),
        ...blocked.map((i) => todoFromIssue(i, i.status === 'blocked' ? '阻塞' : '评审待决', 'warn')),
      ], issues).slice(0, 8)
      return {
        headline: '域内分拣、阻塞与节奏（含下属业务域）',
        emptyTodo: scope.size ? '域内暂无待你拍板的事项' : '尚未分配业务域，请联系管理员',
        kpis: [
          { key: 'sort', icon: 'filter', label: '域内待分拣', value: String(sorting.length), color: '#4f46e5', focus: { page: 'issues' } },
          { key: 'blk', icon: 'warn', label: '域内阻塞/评审', value: String(blocked.length), color: '#b45309', focus: { page: 'issues', focus: { status: 'blocked' } } },
          { key: 'run', icon: 'flow', label: '域内执行中', value: String(running.length), color: '#0891b2', focus: { page: 'monitor' } },
          { key: 'off', icon: 'client', label: '离线客户端', value: String(offline), color: '#b91c1c', focus: { page: 'clients', focus: { offline: true } } },
        ],
        todos,
        sideTitle: '域内概况',
        sideLines: [
          { text: `管辖业务域 ${scope.size} 个（含子域）`, tone: 'mut' },
          { text: `域内未闭环 ${inBiz.filter(isOpenIssue).length} 条`, tone: 'mut', go: { page: 'issues' } },
          { text: `活跃实例 ${activeInst}`, tone: 'mut', go: { page: 'monitor' } },
        ],
        ctas: [
          { label: blocked[0] ? '处理阻塞' : '查看 Issue', page: 'issues', focus: blocked[0] ? { issueCode: blocked[0].id, status: 'blocked' } : undefined, primary: true, icon: 'warn' },
        ],
        shortcuts: [
          { label: 'Issue', page: 'issues' },
          { label: '作业监控', page: 'monitor' },
          { label: '业务域', page: 'biz' },
          { label: '工作流', page: 'workflow' },
          { label: '平台总览', page: 'dashboard' },
        ],
      }
    }
    case 'dev': {
      const open = owned.filter(isOpenIssue)
      const running = owned.filter((i) => i.status === 'running')
      const blocked = owned.filter((i) => i.status === 'blocked' || i.status === 'reviewing')
      const onMyBox = me.clientId ? issues.filter((i) => i.clientId === me.clientId && isOpenIssue(i)) : []
      const online = myClient ? myClient.state !== 'off' : false
      const todos = sortTodos([
        ...blocked.map((i) => todoFromIssue(i, i.status === 'blocked' ? '阻塞' : '待评审', 'warn')),
        ...running.map((i) => todoFromIssue(i, '执行中', 'prog')),
        ...owned.filter((i) => i.status === 'sorting' || i.status === 'admitted').map((i) => todoFromIssue(i, '待启动', 'info')),
      ], issues).slice(0, 8)
      return {
        headline: '你的任务与终端',
        emptyTodo: '暂无指派给你的待办',
        kpis: [
          { key: 'own', icon: 'issue', label: '指派给我', value: String(open.length), color: '#4f46e5', focus: { page: 'issues' } },
          { key: 'run', icon: 'flow', label: '执行中', value: String(running.length), color: '#0891b2', focus: { page: 'monitor' } },
          { key: 'blk', icon: 'warn', label: '阻塞/评审', value: String(blocked.length), color: '#b45309' },
          {
            key: 'cli', icon: 'client', label: '我的客户端',
            value: !me.clientId ? '未绑定' : (online ? '在线' : '离线'),
            color: !me.clientId ? '#71717a' : (online ? '#15803d' : '#b91c1c'),
            focus: me.clientId ? { page: 'clients', focus: { clientId: me.clientId } } : { page: 'clients' },
          },
        ],
        todos,
        sideTitle: '我的终端',
        sideLines: !me.clientId
          ? [{ text: '尚未绑定客户端，无法自动领任务', tone: 'warn', go: { page: 'clients' } }]
          : [
              { text: `${me.clientId} · ${online ? '在线' : '离线'}`, tone: online ? 'ok' : 'err', go: { page: 'clients', focus: { clientId: me.clientId } } },
              { text: `本机在途 Issue ${onMyBox.length} 条`, tone: 'mut' },
              ...(myClient ? [{ text: `最近心跳 ${myClient.heartbeat}`, tone: 'mut' as const }] : []),
            ],
        ctas: [
          running[0]
            ? { label: '打开执行中 Issue', page: 'issues', focus: { issueCode: running[0].id }, primary: true, icon: 'play' }
            : { label: me.clientId ? '查看客户端' : '去绑定客户端', page: 'clients', focus: me.clientId ? { clientId: me.clientId } : undefined, primary: true, icon: 'client' },
        ],
        shortcuts: [
          { label: 'Issue', page: 'issues' },
          { label: '作业监控', page: 'monitor' },
          { label: '接入指南', page: 'guide' },
          { label: 'Coding Agent', page: 'agents' },
        ],
      }
    }
    case 'qa': {
      const reviewing = issues.filter((i) => i.status === 'reviewing' || (i.status === 'blocked' && owned.includes(i)))
      const testing = issues.filter((i) => i.status === 'running' && (owned.includes(i) || reported.includes(i)))
      const done = issues.filter((i) => i.status === 'done').slice(0, 5)
      const blocked = issues.filter((i) => i.status === 'blocked')
      const todos = sortTodos([
        ...issues.filter((i) => i.status === 'reviewing').map((i) => todoFromIssue(i, '评审待决', 'warn')),
        ...blocked.filter((i) => owned.includes(i)).map((i) => todoFromIssue(i, '阻塞', 'err')),
      ], issues).slice(0, 8)
      return {
        headline: '验收与测试节点',
        emptyTodo: '暂无待验收事项',
        kpis: [
          { key: 'rev', icon: 'review', label: '评审待决', value: String(issues.filter((i) => i.status === 'reviewing').length), color: '#b45309', focus: { page: 'issues', focus: { status: 'reviewing' } } },
          { key: 'test', icon: 'test', label: '相关执行中', value: String(testing.length), color: '#0891b2' },
          { key: 'done', icon: 'check', label: '已验收(样本)', value: String(done.length), color: '#15803d' },
          { key: 'blk', icon: 'warn', label: '阻塞', value: String(blocked.length), color: '#b91c1c', focus: { page: 'issues', focus: { status: 'blocked' } } },
        ],
        todos,
        sideTitle: '近期已验收',
        sideLines: done.length
          ? done.map((i) => ({ text: `${i.id} · ${i.title}`, tone: 'ok' as const, go: { page: 'issues' as PageKey, focus: { issueCode: i.id } } }))
          : [{ text: '暂无已验收记录', tone: 'mut' }],
        ctas: [
          { label: reviewing[0] ? '进入待验收' : '查看 Issue', page: 'issues', focus: reviewing[0] ? { issueCode: reviewing[0].id, status: 'reviewing' } : undefined, primary: true, icon: 'review' },
        ],
        shortcuts: [
          { label: 'Issue', page: 'issues' },
          { label: '作业监控', page: 'monitor' },
        ],
      }
    }
    case 'admin': {
      const open = issues.filter(isOpenIssue)
      const blocked = issues.filter((i) => i.status === 'blocked')
      const offline = clients.filter((c) => c.state === 'off')
      const todos: WorkbenchTodo[] = [
        ...blocked.slice(0, 4).map((i) => todoFromIssue(i, '阻塞', 'warn')),
        ...offline.slice(0, 4).map((c) => ({
          key: `c-${c.id}`,
          title: c.id,
          sub: `离线 · ${c.heartbeat}`,
          badge: '离线',
          tone: 'err' as const,
          page: 'clients' as PageKey,
          focus: { clientId: c.id, offline: true },
        })),
      ]
      return {
        headline: '平台是否健康，谁卡住了',
        emptyTodo: '暂无阻塞或离线告警',
        kpis: [
          { key: 'open', icon: 'issue', label: '待处理 Issue', value: String(open.length), color: '#4f46e5', focus: { page: 'issues' } },
          { key: 'inst', icon: 'flow', label: '活跃实例', value: String(activeInst), color: '#f59e0b', focus: { page: 'monitor' } },
          { key: 'off', icon: 'client', label: '离线客户端', value: String(offline.length), color: '#b91c1c', focus: { page: 'clients', focus: { offline: true } } },
          { key: 'ai', icon: 'bolt', label: 'AI 调用记录', value: String(aiCalls), color: '#15803d', focus: { page: 'logs' } },
        ],
        todos: todos.slice(0, 8),
        sideTitle: '管理入口',
        sideLines: [
          { text: '打开平台总览查看全局健康度', tone: 'mut', go: { page: 'dashboard' } },
          { text: '用户与权限', tone: 'mut', go: { page: 'users' } },
          { text: '模型配置', tone: 'mut', go: { page: 'models' } },
        ],
        ctas: [
          { label: '平台总览', page: 'dashboard', primary: true, icon: 'dashboard' },
          { label: '用户管理', page: 'users', icon: 'users' },
        ],
        shortcuts: [
          { label: '用户', page: 'users' },
          { label: '权限', page: 'roles' },
          { label: '客户端', page: 'clients' },
          { label: '模型配置', page: 'models' },
        ],
      }
    }
    default: {
      const open = issues.filter(isOpenIssue)
      return {
        headline: '只读旁观 · 联系管理员开通业务角色',
        emptyTodo: '暂无可见 Issue',
        kpis: [
          { key: 'all', icon: 'eye', label: '可见 Issue', value: String(issues.length), color: '#71717a' },
          { key: 'open', icon: 'issue', label: '未闭环', value: String(open.length), color: '#4f46e5' },
          { key: 'run', icon: 'flow', label: '执行中', value: String(issues.filter((i) => i.status === 'running').length), color: '#0891b2' },
          { key: 'done', icon: 'check', label: '已验收', value: String(issues.filter((i) => i.status === 'done').length), color: '#15803d' },
        ],
        todos: open.slice(0, 8).map((i) => todoFromIssue(i, '只读', 'mut')),
        sideTitle: '说明',
        sideLines: [{ text: '访客无法录入或执行任务', tone: 'mut' }],
        ctas: [],
        shortcuts: [{ label: 'Issue', page: 'issues' }],
      }
    }
  }
}

export function roleChipLabel(code: RoleCode): string {
  return roleLabel[code] ?? code
}

/** 从用户行解析身份（含多角色） */
export function identityFromUser(u: UserRow | undefined, fallback: { name: string; no: string }): {
  name: string; no: string; roles: RoleCode[]; bizCodes: string[]; clientId: string
} {
  if (!u) {
    return { name: fallback.name, no: fallback.no, roles: ['guest'], bizCodes: [], clientId: '' }
  }
  const roles = parseRoles(u.roles?.length ? u.roles : u.role)
  return {
    name: u.name,
    no: u.no,
    roles,
    bizCodes: u.bizCodes ?? [],
    clientId: u.client && u.client !== '—' ? u.client : '',
  }
}
