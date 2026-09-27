/**
 * 桌面通知与提醒 + 通知中心台账。
 *
 * 服务端没有推送通道（客户端在 NAT 后，只有服务端轮询可得状态），所以这里做**快照比对**：
 * 定时拉 /api/issues 与 /api/workflows/instances，和上一轮快照比，
 * 出现「作业完成 / 作业失败或被阻断 / 新增 Issue」时按偏好发浏览器通知 + 应用内 toast。
 *
 * 同时每一条发出去的通知都落进通知中心（右上角铃铛），带已读/未读状态，刷新后仍在。
 * 首轮只建立基线不提醒（否则一进页面就把历史作业全播报一遍）。
 */
import { useSyncExternalStore } from 'react'
import { fetchIssues, fetchWorkflowInstances } from './api'
import type { NotifyPrefs } from './settings'
import type { PageFocus, PageKey } from './types'

/** 轮询间隔（ms）。作业粒度是分钟级，30s 足够 */
const INTERVAL = 30_000

type Reporter = (msg: string) => void

let timer: ReturnType<typeof setInterval> | null = null
let reporter: Reporter = () => {}
/** 上一轮快照：实例 code → 状态；已知 Issue code 集合 */
let jobSnap: Record<string, string> = {}
let issueSnap: string[] = []
let primed = false

/** 终态：完成 / 失败 / 被阻断（与后端 WorkflowInstance 状态对齐） */
const DONE = new Set(['done', 'completed', 'finished', 'success'])
const FAILED = new Set(['failed', 'error', 'blocked'])

function title(inst: { instanceCode?: string; issueCode?: string }) {
  return inst.issueCode ?? inst.instanceCode ?? '作业'
}

/* ============================================================
   通知中心台账
   ============================================================ */

export type NotifKind = 'jobDone' | 'jobFailed' | 'newIssue' | 'system'

export interface NotifItem {
  id: string
  kind: NotifKind
  title: string
  body: string
  ts: number
  read: boolean
  /** 关联对象（Issue code / 实例 code），用于去重判断与展示 */
  ref?: string
  /** 点击后跳转的控制台页面 */
  page?: PageKey
  /** 跳转携带的定位参数 */
  focus?: PageFocus
}

const NKEY = 'talos.notifications'
/** 最多保留条数（超出丢弃最旧的） */
const MAX_KEEP = 200
/** 保留时长：30 天，更旧的读历史没有意义 */
const KEEP_MS = 30 * 24 * 3600_000

function loadStore(): NotifItem[] {
  try {
    const raw = localStorage.getItem(NKEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    const deadline = Date.now() - KEEP_MS
    return (arr as NotifItem[]).filter(
      (n) => n && typeof n.id === 'string' && typeof n.ts === 'number' && n.ts > deadline,
    )
  } catch {
    return []
  }
}

let items: NotifItem[] = loadStore()
const subs = new Set<() => void>()

function persist() {
  try { localStorage.setItem(NKEY, JSON.stringify(items)) } catch { /* 隐私模式下写不进就算了 */ }
}
function emit() { subs.forEach((f) => f()) }

/** 多标签页同步：另一个标签页读了通知，这里也跟着变 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== NKEY) return
    items = loadStore()
    emit()
  })
}

function subscribe(cb: () => void) {
  subs.add(cb)
  return () => { subs.delete(cb) }
}
const snapshot = () => items

/** 订阅通知列表（组件里用它拿最新台账，任何变更都会触发重渲染） */
export function useNotifications(): NotifItem[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function unreadCount(list: NotifItem[] = items): number {
  return list.reduce((n, x) => (x.read ? n : n + 1), 0)
}

/** 入一条通知（未读置顶）。返回新条目 id */
export function pushNotif(n: Omit<NotifItem, 'id' | 'ts' | 'read'>): string {
  const id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  items = [{ ...n, id, ts: Date.now(), read: false }, ...items].slice(0, MAX_KEEP)
  persist()
  emit()
  return id
}

export function markNotifRead(id: string) {
  let hit = false
  items = items.map((x) => (x.id === id && !x.read ? (hit = true, { ...x, read: true }) : x))
  if (!hit) return
  persist(); emit()
}

export function markAllNotifRead() {
  if (!items.some((x) => !x.read)) return
  items = items.map((x) => (x.read ? x : { ...x, read: true }))
  persist(); emit()
}

export function removeNotif(id: string) {
  items = items.filter((x) => x.id !== id)
  persist(); emit()
}

export function clearNotifs() {
  if (!items.length) return
  items = []
  persist(); emit()
}

/* ============================================================
   桌面通知（浏览器级）
   ============================================================ */

export function isNotifySupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

/** 当前授权状态：unsupported = 浏览器不支持 */
export function notifyPermission(): NotificationPermission | 'unsupported' {
  if (!isNotifySupported()) return 'unsupported'
  return Notification.permission
}

/** 申请桌面通知权限（必须由用户手势触发，否则浏览器会忽略） */
export async function requestNotifyPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isNotifySupported()) return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

/** 发一条桌面通知（未授权则静默跳过，只走应用内 toast） */
export function pushDesktop(title_: string, body: string) {
  if (!isNotifySupported() || Notification.permission !== 'granted') return
  try {
    new Notification(title_, { body, tag: `talos-${title_}` })
  } catch {
    /* 某些浏览器在非 https 下抛异常，忽略即可，应用内 toast 仍在 */
  }
}

async function tick(getPrefs: () => NotifyPrefs) {
  const p = getPrefs()
  if (!p.enabled) return
  try {
    const [insts, issues] = await Promise.all([
      fetchWorkflowInstances(),
      fetchIssues(),
    ])

    // 作业终态变化
    const nextSnap: Record<string, string> = {}
    for (const it of insts) {
      const code = it.instanceCode ?? it.issueCode
      if (!code || !it.status) continue
      nextSnap[code] = it.status
      if (!primed) continue
      const prev = jobSnap[code]
      if (prev === it.status) continue
      const ref = it.issueCode ?? it.instanceCode
      const focus: PageFocus | undefined = it.issueCode ? { issueCode: it.issueCode } : undefined
      if (DONE.has(it.status) && p.jobDone) {
        const msg = `作业完成 · ${title(it)}`
        reporter(msg); pushDesktop('Talos 作业完成', `${title(it)} 已跑完全部节点`)
        pushNotif({
          kind: 'jobDone', title: msg, body: `${title(it)} 已跑完全部节点`, ref,
          page: 'monitor', focus,
        })
      } else if (FAILED.has(it.status) && p.jobFailed) {
        const msg = `作业${it.status === 'blocked' ? '被阻断' : '失败'} · ${title(it)}`
        reporter(msg); pushDesktop('Talos 作业异常', `${title(it)} 状态：${it.status}`)
        pushNotif({
          kind: 'jobFailed', title: msg, body: `${title(it)} 当前状态：${it.status}`, ref,
          page: 'monitor', focus,
        })
      }
    }

    // 新增 Issue
    // mapIssue 把后端 code 映射到了 Issue.id 上
    const codes = issues.map((i) => i.id)
    if (primed && p.newIssue) {
      const fresh = codes.filter((c) => !issueSnap.includes(c))
      if (fresh.length) {
        const msg = fresh.length === 1 ? `新 Issue 待处理 · ${fresh[0]}` : `${fresh.length} 条新 Issue 待处理`
        reporter(msg); pushDesktop('Talos 新 Issue', msg)
        pushNotif({
          kind: 'newIssue', title: msg,
          body: fresh.length === 1 ? `${fresh[0]} 已录入，等待准入判定` : `共 ${fresh.length} 条，点击查看`,
          ref: fresh.length === 1 ? fresh[0] : undefined,
          page: 'issues',
          focus: fresh.length === 1 ? { issueCode: fresh[0] } : { status: 'new' },
        })
      }
    }

    jobSnap = nextSnap
    issueSnap = codes
    primed = true
  } catch {
    /* 轮询失败不打扰用户：下一轮继续 */
  }
}

/** 启动轮询器（Console 挂载时调用一次，重复调用无副作用） */
export function startNotifier(getPrefs: () => NotifyPrefs, report: Reporter) {
  reporter = report
  if (timer) return
  void tick(getPrefs) // 首轮建基线
  timer = setInterval(() => void tick(getPrefs), INTERVAL)
}

export function stopNotifier() {
  if (timer) { clearInterval(timer); timer = null }
  primed = false
  jobSnap = {}
  issueSnap = []
}

/** 发送一条测试通知：桌面授权则弹系统通知，同时始终记进通知中心 */
export function sendTestNotification(): boolean {
  const granted = isNotifySupported() && Notification.permission === 'granted'
  if (granted) pushDesktop('Talos 通知测试', '这是一条来自 Talos 设置面板的测试通知')
  pushNotif({
    kind: 'system',
    title: '通知测试',
    body: '这是一条来自 Talos 设置面板的测试通知',
  })
  return granted
}
