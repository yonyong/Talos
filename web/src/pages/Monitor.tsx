import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../icons'
import { Empty, Drawer, PageH, Panel, Search, Seg, Tag, useToast } from '../ui'
import {
  fetchClients, fetchIssues, fetchWorkflowInstances, fetchTaskNodes, fetchInstanceGraph,
  advanceInstance, cancelInstance, rerunInstance, useAsync, usePolling,
} from '../api'
import WfGraph from '../wfgraph'
import { duration, hhmmss, hhmmssOf, nodeTime, nodeTimeRange } from '../time'
import type { ClientNode, InstanceGraph, Issue, PageFocus, PageKey, TaskNodeRow } from '../types'

const instStatusTone: Record<string, 'ok' | 'prog' | 'err' | 'warn' | 'mut'> = {
  done: 'ok', running: 'prog', blocked: 'warn', failed: 'err', pending: 'mut', cancelled: 'mut',
}
const instStatusLabel: Record<string, string> = {
  running: '执行中', blocked: '阻塞', done: '已完成', failed: '失败', pending: '待启动', cancelled: '已取消',
}
/** 节点状态：标签文案 / 色调 / 时间线样式 class */
const NODE_STATUS: Record<string, { l: string; tone: 'ok' | 'prog' | 'err' | 'warn' | 'mut'; cls: 'done' | 'active' | 'fail' | '' }> = {
  waiting: { l: '待执行', tone: 'mut', cls: '' },
  dispatched: { l: '已下发', tone: 'prog', cls: 'active' },
  running: { l: '执行中', tone: 'prog', cls: 'active' },
  success: { l: '已完成', tone: 'ok', cls: 'done' },
  failed: { l: '失败', tone: 'err', cls: 'fail' },
  blocked: { l: '阻塞', tone: 'warn', cls: 'fail' },
  skipped: { l: '已跳过', tone: 'mut', cls: '' },
  cancelled: { l: '已取消', tone: 'mut', cls: '' },
}
const KIND_ICON: Record<string, string> = { git: 'git', doc: 'doc', code: 'code', test: 'test', rev: 'review' }
/** 分拣方式文案 */
const SORT_METHOD: Record<string, string> = { auto: '关键词命中', llm: 'AI 裁决', manual: '人工指定', none: '待人工' }
/** 可人工操作的实例状态 */
const OPERABLE = ['running', 'blocked', 'pending']

/** 终态实例：监控页只看「还在跑」的，已完成 / 失败 / 已取消到 Issue 详情与日志页追溯 */
const TERMINAL_STATUS = ['done', 'failed', 'cancelled']

/**
 * 自动刷新节拍。页面不再靠人工点刷新 —— 节点在客户端跑，进度、耗时、日志都是流动的，
 * 停在屏幕上 5 分钟不动的监控页等于没有。
 *
 * 有实例在跑时 5s（节点 startedAt / execLog 的变化要跟手）；全部停下来（阻塞待人工 /
 * 无可展示实例）拉到 20s —— 那些状态下数据本来就不会自己变，没必要持续打服务端。
 * 页面切到后台自动暂停，切回立即补一次，见 usePolling。
 */
const POLL_BUSY_MS = 5000
const POLL_IDLE_MS = 20000
/** 自动刷新开关的持久化键（页面级视图偏好，不进全局 talos.settings） */
const LIVE_KEY = 'talos.monitor.live'

const nodeStatusOf = (n: TaskNodeRow) => NODE_STATUS[String(n.status ?? '').toLowerCase()] ?? { l: '未开始', tone: 'mut' as const, cls: '' as const }

/** 时间线一行只放得下几十个字符，这里只做摘要；完整日志点节点在侧边面板查看 */
function nodeSummary(n: TaskNodeRow): string {
  const raw = stripAnsi(n.execLog ?? '').trim()
  if (!raw) return nodeStatusOf(n).l
  const first = raw.split('\n').find((l) => l.trim()) ?? raw
  const line = first.replace(/\s+/g, ' ').trim()
  return line.length > 78 ? `${line.slice(0, 78)}…` : line
}

/** 去掉 CLI 输出里的 ANSI 颜色/光标控制序列，否则日志面板里是乱码方块 */
function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
}

/**
 * 节点日志空态：必须回答「为什么还没有日志 + 现在能做什么」。
 * 以前只有一句「该节点尚未回传日志」，客户端卡死 8 小时也照旧显示「进行中」，
 * 用户完全看不出是正常在跑还是已经失联。
 */
function emptyNodeLog(n: TaskNodeRow): string {
  const mech = String(n.kind ?? '').toLowerCase() === 'git'
  const tail = mech
    ? '机械节点（拉取 Git）只做仓库准备 —— 克隆 / 拉取 / 切工作分支，不调用模型；完成后每条 git 命令与输出都会写在这里。'
    : '节点执行完成后，客户端回执会把本地 CLI 的完整输出写入这里。'
  const st = String(n.status ?? '').toLowerCase()
  const ran = n.startedAt ? duration(n.startedAt) : ''
  if (st === 'dispatched') {
    const since = n.startedAt ? Date.now() - new Date(n.startedAt).getTime() : 0
    // 客户端自身有硬上限（仓库准备 300~600s + CLI 默认 900s），超过就该怀疑而不是干等
    const over = since > (mech ? 10 : 25) * 60_000
    if (!over) return `已下发客户端执行${ran ? ` · 已等待 ${ran}` : ''}。\n\n等客户端回执即可，本页会自动刷新。\n\n${tail}`
    return `已下发客户端执行 · 已等待 ${ran} 仍无回执。\n\n`
      + '⚠ 已超过这类节点的正常耗时（机械节点约 10 分钟、AI 节点约 25 分钟），大概率是客户端卡在本地进程或这条连接已经掉线 —— 任务不会自动重发。\n'
      + '处理：① 到「客户端」页确认该机器在线，必要时在本机重启客户端；'
      + '② 回到本页用「取消实例」→「重新执行」让任务重新下发（节点仍挂着时「从此节点重跑」会被拒绝）。\n\n'
      + tail
  }
  if (st === 'waiting') return `该节点尚未开始 —— 前序节点结束后才会下发。\n\n${tail}`
  if (!n.startedAt) return `该节点尚未回传日志。\n\n${tail}`
  return `该节点已${nodeStatusOf(n).l}，但没有留下输出。\n\n${tail}`
}

/** 摘要场景压成单行并截断 */
function oneLine(s?: string | null, max = 90): string {
  const line = (s ?? '').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max)}…` : line
}

/** 默认定位到最值得看的节点：正在执行的 → 最后一个产出日志的 → 最后一个 */
function defaultStep(nodes: TaskNodeRow[]): number | null {
  if (!nodes.length) return null
  const active = nodes.find((n) => ['running', 'dispatched'].includes(String(n.status ?? '').toLowerCase()))
  if (active) return active.step
  const withLog = [...nodes].reverse().find((n) => (n.execLog ?? '').trim())
  if (withLog) return withLog.step
  return nodes[nodes.length - 1].step
}

/**
 * 作业监控：左侧实例列表 + 右侧实例详情（实例头 / 节点视图）。
 * 节点视图用 tab 在「时间线」和「拓扑图」之间切换；点击节点从右侧滑出
 * 日志面板（Drawer）就地查看完整执行日志，面板内可上一个/下一个节点切换。
 * AI 调用明细不在本页堆面板，经实例头「AI 调用明细」深链到日志页按 Issue 过滤查看。
 */
export default function Monitor({ focus, onNav }: { focus?: PageFocus; onNav?: (p: PageKey, f?: PageFocus) => void }) {
  const { toast } = useToast()
  const { data: clients } = useAsync<ClientNode[]>(() => fetchClients(), [])
  const { data: issues } = useAsync<Issue[]>(() => fetchIssues(), [])
  const { data: instances, reload: reloadInstances } = useAsync(() => fetchWorkflowInstances(), [])

  const clientList = clients ?? []
  const issueList = issues ?? []
  const instList = instances ?? []
  /** 监控页只看「还在跑」的实例；终态（已完成/失败/已取消）不展示，追溯走 Issue 详情与日志页 */
  const openInstList = useMemo(
    () => instList.filter((i) => !TERMINAL_STATUS.includes(String(i.status))),
    [instList],
  )

  const [selCode, setSelCode] = useState<string | null>(null)
  /** 选中节点（step），用于时间线 / 拓扑图高亮 */
  const [selStep, setSelStep] = useState<number | null>(null)
  /** 侧滑日志面板当前展示的节点（step）；null = 面板关闭 */
  const [logStep, setLogStep] = useState<number | null>(null)
  /** 节点视图：时间线 / 拓扑图 */
  const [view, setView] = useState<'tl' | 'graph'>('tl')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  /** 自动刷新开关（持久化）；关掉后只剩「立即刷新」按钮 */
  const [live, setLive] = useState(() => localStorage.getItem(LIVE_KEY) !== '0')
  /** 最近一次成功刷新的时刻，用于头部「更新于 21:40:12」 */
  const [lastAt, setLastAt] = useState<number | null>(null)
  /** 手动刷新按钮的忙态。轮询刷新不打这个标记 —— 否则按钮每 5s 闪一次「刷新中」 */
  const [manualBusy, setManualBusy] = useState(false)
  /** 轮询上一轮还没回来就跳过这一轮（服务端慢的时候不堆请求）；用户手动操作不受此限制 */
  const pollInflight = useRef(false)
  /** 已按下钻参数定位过的 focus 对象；只在导航换新 focus 时跳一次，否则轮询会把用户切走的实例拽回来 */
  const appliedFocus = useRef<PageFocus | undefined>(undefined)
  /** 节点日志抽屉：内容随刷新持续追加，只在用户没往回翻时贴底（见下方 effect） */
  const logRef = useRef<HTMLPreElement>(null)
  const stickLog = useRef(true)

  /** 点节点 = 选中高亮 + 从右侧滑出该节点的完整日志 */
  const openNode = (step: number) => {
    setSelStep(step)
    setLogStep(step)
    // 换节点默认跟到最新一行；用户手动往上翻后才停手，所以每次重新打开都要复位
    stickLog.current = true
  }

  /**
   * 从 Issue 详情下钻过来时，优先定位到该 Issue 的实例；终态实例不在可选范围内。
   *
   * ⚠ 下钻只认「导航产生的新 focus 对象」。定时刷新会让本 effect 反复触发，
   * 若每次都按 focus.issueCode 定位，用户手动切到别的实例后每 5s 就会被拽回去。
   */
  useEffect(() => {
    if (!openInstList.length) { setSelCode(null); return }
    if (focus?.issueCode && appliedFocus.current !== focus) {
      const hit = openInstList.find((i) => i.issueCode === focus.issueCode)
      if (hit?.instanceCode) {
        appliedFocus.current = focus
        setSelCode(hit.instanceCode)
        return
      }
    }
    // 选中的实例一旦进入终态就会从列表消失，此时自动落到第一个进行中的实例
    setSelCode((prev) =>
      prev && openInstList.some((i) => i.instanceCode === prev) ? prev : openInstList[0].instanceCode ?? null)
  }, [openInstList, focus])

  const selInst = openInstList.find((i) => i.instanceCode === selCode)
  const selIssueCode = selInst?.issueCode
  const selIssue = selInst ? issueList.find((i) => i.id === selInst.issueCode) : undefined

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return openInstList
    return openInstList.filter((r) => {
      const t = issueList.find((i) => i.id === r.issueCode)
      return [r.instanceCode, r.issueCode, r.clientId, r.templateCode, t?.title]
        .some((v) => String(v ?? '').toLowerCase().includes(kw))
    })
  }, [openInstList, issueList, q])

  /**
   * 节点原始行（execLog 全文）。时间线摘要与日志面板同源，
   * 避免「看了摘要想看全文却拿不到」。
   */
  const { data: taskNodes, reload: reloadNodes } = useAsync<TaskNodeRow[]>(
    () => (selCode ? fetchTaskNodes(selCode) : Promise.resolve([])),
    [selCode],
  )
  const nodes = taskNodes ?? []

  // 换实例后重挑默认节点；轮询刷新时保持用户当前选择
  useEffect(() => {
    if (!nodes.length) { setSelStep(null); return }
    setSelStep((prev) => (prev != null && nodes.some((n) => n.step === prev) ? prev : defaultStep(nodes)))
  }, [nodes])

  /** 实例图（带节点实时状态），与时间线同源不同视角 */
  const { data: graph, reload: reloadGraph } = useAsync<InstanceGraph | null>(
    () => (selCode ? fetchInstanceGraph(selCode) : Promise.resolve(null)),
    [selCode],
  )

  const canOperate = !!selInst && OPERABLE.includes(String(selInst.status))
  /** 重新执行：除「待启动」外都可触发（已完成 / 已取消 / 已阻塞的实例也能重跑） */
  const canRerun = !!selInst && String(selInst.status) !== 'pending'

  const runningN = openInstList.filter((i) => String(i.status) === 'running').length
  const blockedN = issueList.filter((i) => i.status === 'blocked').length
  const onlineN = clientList.filter((c) => c.state === 'on' || c.state === 'busy').length
  const offlineN = clientList.filter((c) => c.state === 'off').length

  /**
   * 实例绑定的执行客户端是否离线。离线时下发必然落空（任务只会停在 waiting），
   * 服务端会直接 409 拦截；这里提前置灰按钮并说明原因，别让人点了才报错。
   */
  const boundClientOffline = !!selInst?.clientId
    && clientList.some((c) => c.id === selInst.clientId && c.state === 'off')
  /** 实例绑定的客户端在线状态（无绑定 = undefined） */
  const boundClient = selInst?.clientId ? clientList.find((c) => c.id === selInst.clientId) : undefined

  /**
   * 拉一次全量：实例列表 + 当前实例的节点与拓扑图。
   * 定时轮询、操作后刷新、手动刷新共用同一份实现，保证三条路径拿到的是同一套数据。
   */
  const refresh = async () => {
    await Promise.all([reloadInstances(), reloadNodes(), reloadGraph()])
    setLastAt(Date.now())
  }

  /** 操作后的刷新（人工回执 / 取消 / 重跑）：不 await，界面先给 toast 反馈 */
  const reloadAll = () => { void refresh() }

  /** 有实例在跑（执行中 / 刚下发）走快节拍；其余状态数据不会自己变，拉长间隔省请求 */
  const pollBusy = openInstList.some((i) => ['running', 'pending'].includes(String(i.status)))
  const pollMs = pollBusy ? POLL_BUSY_MS : POLL_IDLE_MS
  const pollSec = pollMs / 1000

  usePolling(() => {
    // 上一轮没回来就跳过本轮，避免服务端慢时请求堆积
    if (pollInflight.current) return
    pollInflight.current = true
    void refresh().finally(() => { pollInflight.current = false })
  }, pollMs, live)

  const toggleLive = () => {
    const next = !live
    setLive(next)
    localStorage.setItem(LIVE_KEY, next ? '1' : '0')
  }

  /** 手动刷新：打忙态让按钮有反馈（轮询刷新不打，否则每 5s 闪一次） */
  const refreshNow = async () => {
    setManualBusy(true)
    try {
      await refresh()
    } catch (e) {
      toast(`刷新失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setManualBusy(false)
    }
  }

  /**
   * 节点日志抽屉的「贴底」：自动刷新会让执行中的节点日志持续追加，
   * 用户停在底部时就跟着滚，自己往上翻看历史了就不抢滚动条（同客户端日志面板的做法）。
   */
  const logText = logStep != null
    ? stripAnsi(nodes.find((n) => n.step === logStep)?.execLog ?? '').trim()
    : ''
  useEffect(() => {
    const el = logRef.current
    if (el && stickLog.current) el.scrollTop = el.scrollHeight
  }, [logText, logStep])
  const onLogScroll = () => {
    const el = logRef.current
    if (el) stickLog.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
  }

  /**
   * 人工回执当前节点：客户端离线时由人工确认节点结果。
   * step 传 0 让服务端自动挑选可推进节点——DAG 下可能同时有多个分支活跃，人工不必猜步骤号。
   */
  const ack = async (success: boolean) => {
    if (!selInst?.instanceCode) return
    setBusy(true)
    try {
      const r = await advanceInstance(selInst.instanceCode, 0,
        success, success ? '人工确认：节点执行通过' : '人工确认：节点执行失败')
      toast(success
        ? (r.status === 'done' ? '人工确认通过 · 实例已完成' : `人工确认通过 · 实例流转至 ${instStatusLabel[String(r.status)] ?? r.status}`)
        : '已标记失败 · 实例阻塞，等待人工处理')
      reloadAll()
    } catch (e) {
      toast(`操作失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  const doCancel = async () => {
    if (!selInst?.instanceCode) return
    setBusy(true)
    try {
      await cancelInstance(selInst.instanceCode, '监控页人工取消')
      toast(`实例 ${selInst.instanceCode} 已取消，未执行节点标记为跳过`)
      reloadAll()
    } catch (e) {
      toast(`取消失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  /**
   * 重新执行：不传 step 整图重跑；传 step 从该节点（含下游）重跑，上游已完成的结果保留。
   * 重跑会重置目标节点的执行记录，需二次确认。
   */
  const doRerun = async (step?: number) => {
    if (!selInst?.instanceCode) return
    const nodeName = step ? nodes.find((n) => n.step === step)?.name ?? `STEP ${step}` : ''
    const what = step
      ? `从节点 ${step}. ${nodeName} 重新执行（该节点及其下游的执行记录将被重置，上游结果保留）`
      : '重新执行整个工作流（所有节点的执行记录将被重置）'
    if (!window.confirm(`确认${what}？`)) return
    setBusy(true)
    try {
      await rerunInstance(selInst.instanceCode, step,
        step ? `监控页从节点 ${step} 重新执行` : '监控页整图重新执行')
      toast(step ? `已从节点 ${step}. ${nodeName} 重新下发` : '工作流已重置并重新下发')
      reloadAll()
    } catch (e) {
      toast(`重新执行失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  /** 模板里的占位符 '—' 不是真实后端/闸门，展示时一律当空 */
  const real = (v?: string | null) => (v && v !== '—' ? v : '')

  return (
    <div>
      <PageH
        title="作业监控"
        desc="左侧选择实例，点击节点从侧边查看完整执行日志。"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              className={`mon-chip mon-live ${live ? 'on' : ''}`}
              onClick={toggleLive}
              title={live
                ? `每 ${pollSec}s 自动刷新实例与节点进度（有实例执行时 5s，全部停下来时 20s）。`
                  + '标签页切到后台会暂停，切回立即补刷。点击暂停'
                : '自动刷新已暂停 —— 数据不会自己更新，点击恢复'}
            >
              <span className={`cdot ${live ? 'busy' : ''}`} />
              {live ? `自动刷新 ${pollSec}s` : '自动刷新已暂停'}
            </button>
            <button
              className="mon-chip"
              onClick={() => void refreshNow()}
              disabled={manualBusy}
              title="立即刷新实例列表、节点进度与拓扑图"
            >
              <Icon name="refresh" size={13} />
              {manualBusy ? '刷新中…' : lastAt ? `更新于 ${hhmmssOf(lastAt)}` : '刷新'}
            </button>
            <span className="mon-chip" title="运行中实例 / 进行中的实例数（终态记录不在此展示）">
              <span className={`cdot ${runningN ? 'on' : ''}`} />
              {runningN}/{openInstList.length} 运行中
            </span>
            <button className="mon-chip" onClick={() => onNav?.('issues', { status: 'blocked' })} title="查看阻塞 Issue">
              <span className={`cdot ${blockedN ? 'off' : ''}`} />
              {blockedN} 个阻塞
            </button>
            <button className="mon-chip" onClick={() => onNav?.('clients', { offline: true })} title="查看客户端连接状态">
              <span className={`cdot ${offlineN ? 'off' : onlineN ? 'on' : ''}`} />
              {clientList.length ? `${onlineN}/${clientList.length} 客户端在线` : '暂无客户端接入'}
            </button>
          </div>
        }
      />

      <div className="mon">
        {/* ---------- 左：实例列表（常驻，切换入口不再埋在页底） ---------- */}
        <div className="mon-side">
          <Panel
            title="工作流实例"
            sub={q ? `${filtered.length} / ${openInstList.length}` : `${openInstList.length} 个`}
            flush
          >
            <div className="mon-search">
              <Search placeholder="搜索实例 / Issue" value={q} onChange={setQ} />
            </div>
            <div className="mon-list">
              {filtered.length === 0 && (
                <div className="logempty" style={{ padding: '10px 4px' }}>
                  {openInstList.length === 0
                    ? '暂无进行中的实例（已完成 / 失败 / 已取消的不在此展示）'
                    : '没有匹配的实例'}
                </div>
              )}
              {filtered.map((r) => {
                const p = r.totalSteps ? Math.round(((r.currentStep ?? 0) / r.totalSteps) * 100) : 0
                const t = issueList.find((i) => i.id === r.issueCode)
                return (
                  <button
                    key={r.instanceCode}
                    type="button"
                    className={`mon-item ${selCode === r.instanceCode ? 'on' : ''}`}
                    onClick={() => { setSelCode(r.instanceCode ?? null); setLogStep(null) }}
                  >
                    <div className="mi-top">
                      <span className="mi-code">{r.instanceCode}</span>
                      <Tag tone={instStatusTone[String(r.status)] ?? 'mut'} dot>
                        {instStatusLabel[String(r.status)] ?? r.status}
                      </Tag>
                    </div>
                    <div className="mi-sub">{r.issueCode}{t?.title ? ` · ${t.title}` : ''}</div>
                    <div className="pbar"><i style={{ width: `${p}%` }} /></div>
                  </button>
                )
              })}
            </div>
          </Panel>
        </div>

        {/* ---------- 右：实例详情 ---------- */}
        {!selInst ? (
          <div className="card card-pad" style={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty text="左侧选择一个工作流实例" />
          </div>
        ) : (
          <div className="mon-detail">
            <div className="mon-head">
              <div style={{ minWidth: 0 }}>
                <div className="mh-title">
                  <span className="mono">{selInst.issueCode}</span>
                  {selIssue?.title ?? '工作流实例'}
                </div>
                <div className="mh-sub">
                  <Tag tone={instStatusTone[String(selInst.status)] ?? 'mut'} dot>
                    {instStatusLabel[String(selInst.status)] ?? selInst.status}
                  </Tag>
                  <span>节点 {selInst.currentStep ?? 0}/{selInst.totalSteps ?? 0}</span>
                  <span>责任人 {selIssue?.owner ?? '—'}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    客户端 {selInst.clientId ?? '—'}
                    {boundClientOffline && (
                      <span style={{ color: 'var(--err)', fontWeight: 600 }}>· 离线，无法下发</span>
                    )}
                  </span>
                  <span>模板 {selInst.templateCode ?? '—'}</span>
                </div>
              </div>
              <div className="mh-acts">
                <button
                  className="btn btn-outline btn-xs"
                  title="查看本 Issue 触发的服务端 LLM 调用明细（Prompt / Token / 耗时）"
                  onClick={() => onNav?.('logs', { issueCode: selIssueCode })}
                >
                  <Icon name="spark" size={13} />AI 调用明细
                </button>
                {canOperate && (
                  <>
                    <button className="btn btn-outline btn-xs" disabled={busy} onClick={() => ack(true)}>
                      <Icon name="check" size={13} />人工通过
                    </button>
                    <button className="btn btn-outline btn-xs" disabled={busy} onClick={() => ack(false)}>
                      <Icon name="warn" size={13} />标记失败
                    </button>
                    <button className="btn btn-outline btn-xs" disabled={busy} onClick={doCancel}>
                      <Icon name="x" size={13} />取消实例
                    </button>
                  </>
                )}
                {canRerun && (
                  <button
                    className="btn btn-outline btn-xs"
                    disabled={busy || boundClientOffline}
                    onClick={() => doRerun()}
                    title={boundClientOffline
                      ? `执行客户端 ${selInst?.clientId} 离线，无法下发任务；请先启动客户端`
                      : '全部节点重置，从入口重新下发'}
                  >
                    <Icon name="refresh" size={13} />重新执行
                  </button>
                )}
              </div>
            </div>

            {/* 启动前阶段：准入 / 分拣 / 承接客户端。这三步发生在工作流启动之前，
                不在下方节点进度里，单独成条呈现——排查「卡待执行」类问题先看这里 */}
            <div className="pre-phase">
              <div className="pp-item" title={oneLine(selIssue?.admissionReason, 300) || '准入判定发生在 Issue 提交时'}>
                <span className="pp-k">准入判定</span>
                {selIssue?.admissionResult ? (
                  <>
                    <span className={`pp-v ${selIssue.admissionResult === 'admit' ? 'ok' : 'err'}`}>
                      {selIssue.admissionResult === 'admit' ? '已准入' : selIssue.admissionResult}
                    </span>
                    {selIssue.confidence != null && (
                      <span className="pp-note">置信度 {Math.round(selIssue.confidence * 100)}%</span>
                    )}
                  </>
                ) : (
                  <span className="pp-v">—</span>
                )}
              </div>
              <div className="pp-item" title={oneLine(selIssue?.sortReason, 300) || '分拣决定仓库、分支与承接客户端'}>
                <span className="pp-k">分拣</span>
                <span className="pp-v">{SORT_METHOD[String(selIssue?.sortMethod)] ?? selIssue?.sortMethod ?? '—'}</span>
                {selIssue?.bizCode && <span className="pp-note">{selIssue.bizCode} · {oneLine(selIssue?.sortReason, 60)}</span>}
              </div>
              <div className="pp-item" title={selInst?.clientId
                ? `任务经该客户端本地 CLI 执行${boundClientOffline ? '；当前离线，上线后自动补发排队任务' : ''}`
                : '未绑定执行客户端：任务没有下发通道，也不会有任何补发'}>
                <span className="pp-k">承接客户端</span>
                {selInst?.clientId ? (
                  <>
                    <span className={`cdot ${boundClient?.state === 'off' ? 'off' : boundClient?.state === 'busy' ? 'busy' : 'on'}`} />
                    <span className="pp-v">{selInst.clientId}</span>
                    {boundClientOffline && <span className="pp-note warn">离线 · 上线后自动补发</span>}
                  </>
                ) : (
                  <span className="pp-v err">未绑定 · 无法下发</span>
                )}
              </div>
            </div>

            {/* 节点视图：时间线与拓扑图合并为一个面板，用 tab 切换 */}
            <div className="mon-sec mon-sec-nodes">
            <Panel
              title="节点进度"
              sub={nodes.length ? `${nodes.filter((n) => ['success'].includes(String(n.status))).length}/${nodes.length} 已完成` : undefined}
              actions={
                <Seg
                  value={view}
                  options={[{ v: 'tl' as const, l: '时间线' }, { v: 'graph' as const, l: '拓扑图' }]}
                  onChange={setView}
                />
              }
            >
              {view === 'tl' ? (
                nodes.length === 0 ? (
                  <div className="logempty">暂无节点进度（实例执行后回传）</div>
                ) : (
                  <div className="timeline mon-scroll">
                    {nodes.map((n) => {
                      const ns = nodeStatusOf(n)
                      const hasLog = !!(n.execLog ?? '').trim()
                      const nt = nodeTime(n.startedAt, n.finishedAt, n.status)
                      return (
                        <div
                          key={n.step}
                          className={`tl ${ns.cls} clickable ${selStep === n.step ? 'sel' : ''}`}
                          onClick={() => openNode(n.step)}
                          title={hasLog ? '点击在侧边查看该节点完整执行日志' : '该节点暂无日志'}
                        >
                          <div className="tld"><div className="dot"><Icon name={KIND_ICON[n.kind ?? ''] ?? 'check'} size={13} /></div></div>
                          <div className="tlb">
                            <div className="tlhead">
                              <div className="tlt">
                                {n.step}. {n.name}
                                {n.round != null && n.round > 1 && <span className="tlround">第 {n.round} 轮重做</span>}
                              </div>
                              {nt && <span className="tltime" title={nodeTimeRange(n.startedAt, n.finishedAt)}>{nt}</span>}
                            </div>
                            <div className="tls">{nodeSummary(n)}</div>
                          </div>
                          {hasLog && (
                            <span className="tlgo">
                              {selStep === n.step && logStep === n.step ? '正在查看' : '查看日志'} <Icon name="arrow" size={12} />
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              ) : graph && graph.nodes.length > 0 ? (
                <div className="mon-scroll">
                  <WfGraph
                    nodes={graph.nodes}
                    edges={graph.edges}
                    showStatus
                    highlightStep={selStep}
                    onNodeClick={(n) => openNode(n.step)}
                    onNodeAction={canRerun && !boundClientOffline ? (n) => doRerun(n.step) : undefined}
                  />
                </div>
              ) : (
                <div className="logempty">暂无拓扑数据</div>
              )}
            </Panel>
            </div>
          </div>
        )}

        {/* ---------- 节点执行日志：右侧滑出面板 ---------- */}
        {logStep != null && (() => {
          const dn = nodes.find((n) => n.step === logStep) ?? null
          if (!dn) return null
          const tone = nodeStatusOf(dn)
          const log = stripAnsi(dn.execLog ?? '').trim()
          const idx = nodes.findIndex((n) => n.step === logStep)
          return (
            <Drawer
              title={<>{dn.step}. {dn.name}{dn.round != null && dn.round > 1 && <span className="tlround">第 {dn.round} 轮重做</span>}</>}
              sub={`${selInst?.instanceCode ?? ''} · ${selInst?.issueCode ?? ''}`}
              width={780}
              onClose={() => setLogStep(null)}
              nav={
                <div className="drawer-nav">
                  <button
                    type="button" className="dn-btn flip" title="上一个节点"
                    disabled={idx <= 0} onClick={() => openNode(nodes[idx - 1].step)}
                  >
                    <Icon name="arrow" size={14} />
                  </button>
                  <span className="cnt">{idx + 1} / {nodes.length}</span>
                  <button
                    type="button" className="dn-btn" title="下一个节点"
                    disabled={idx >= nodes.length - 1} onClick={() => openNode(nodes[idx + 1].step)}
                  >
                    <Icon name="arrow" size={14} />
                  </button>
                </div>
              }
            >
              <div className="logbar">
                <div className="lb-l">
                  <Tag tone={tone.tone}>{tone.l}</Tag>
                  {real(dn.gate) && (
                    <Tag tone={dn.gateResult === 'pass' ? 'ok' : dn.gateResult === 'blocked' ? 'err' : 'mut'}>
                      闸门 {real(dn.gate)} · {dn.gateResult === 'pass' ? '通过' : dn.gateResult === 'blocked' ? '拦下' : '未判定'}
                    </Tag>
                  )}
                  <Tag tone="mut">{`${real(dn.execLocation) || '服务端'}执行`}</Tag>
                  {dn.round != null && dn.round > 1 && <Tag tone="warn">第 {dn.round} 轮</Tag>}
                  {canRerun && (
                    <button
                      className="btn btn-outline btn-xs"
                      disabled={busy}
                      title={`重置 ${dn.step}. ${dn.name} 及其下游节点，从该节点重新下发`}
                      onClick={() => doRerun(dn.step)}
                    >
                      <Icon name="refresh" size={12} />从此节点重跑
                    </button>
                  )}
                </div>
                <div className="lb-r">
                  {dn.startedAt ? (
                    <>
                      <Icon name="clock" size={12} />
                      {hhmmss(dn.startedAt)} → {dn.finishedAt ? hhmmss(dn.finishedAt) : '进行中'}
                      {duration(dn.startedAt, dn.finishedAt) && <b> · {duration(dn.startedAt, dn.finishedAt)}</b>}
                    </>
                  ) : (
                    <>尚未开始</>
                  )}
                </div>
              </div>
              <pre className="nodelog" ref={logRef} onScroll={onLogScroll}>{log || emptyNodeLog(dn)}</pre>
              {log && (
                <div className="logmeta">
                  {log.split('\n').length} 行 · {log.length} 字符
                  <button
                    className="btn btn-outline btn-xs"
                    style={{ marginLeft: 10 }}
                    onClick={() => {
                      navigator.clipboard?.writeText(log)
                        .then(() => toast('节点日志已复制'))
                        .catch(() => toast('复制失败，请手动选中'))
                    }}
                  >
                    <Icon name="copy" size={12} />复制
                  </button>
                </div>
              )}
            </Drawer>
          )
        })()}
      </div>
    </div>
  )
}
