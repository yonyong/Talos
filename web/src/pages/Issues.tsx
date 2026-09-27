import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../icons'
import { Chips, Dropdown, Empty, Modal, PageH, Panel, PersonSelect, Progress, Search, Tag, useToast } from '../ui'
import { AttachPane, DocList } from '../attach'
import type { PendingFile } from '../attach'
import {
  fetchIssues, createIssue, fetchBizTree, resortIssue, useAsync,
  fetchIssueDetail, fetchUsers, startIssue, reassignIssue, closeIssue, reopenIssue,
  uploadDocs, deleteDoc,
} from '../api'
import { statusMeta } from '../constants'
import { loadProfile } from '../settings'
import { nodeTime, nodeTimeRange } from '../time'
import type { BizTreeNode, Issue, IssueDetail, IssueNode, PageFocus, PageKey, SortMethod, UserRow } from '../types'

type Filter = 'all' | 'REQ' | 'BUG' | 'mine'

/** 未走完的生命周期状态，对应总览「待处理」下钻 */
const OPEN_STATUS = ['admitting', 'admitted', 'sorting', 'running', 'blocked', 'reviewing']

const WIZ_STEPS = ['基本信息', '诉求详情', '指派时限', '确认提交']

const SORT_LABEL: Record<SortMethod, { l: string; tone: 'ok' | 'warn' | 'info' | 'mut' }> = {
  auto: { l: '关键词命中', tone: 'ok' },
  llm: { l: 'AI 裁决', tone: 'info' },
  manual: { l: '人工指定', tone: 'mut' },
  none: { l: '待人工分拣', tone: 'warn' },
}

/* 实例 / 节点的展示映射 */
const INST_LABEL: Record<string, string> = {
  running: '执行中', blocked: '阻塞', done: '已完成', failed: '失败', pending: '待启动', cancelled: '已取消',
}
const INST_TONE: Record<string, 'ok' | 'warn' | 'err' | 'prog' | 'mut'> = {
  done: 'ok', running: 'prog', blocked: 'warn', failed: 'err', pending: 'mut', cancelled: 'mut',
}
const NODE_STATE: Record<string, { l: string; cls: string }> = {
  success: { l: '已完成', cls: 'done' },
  running: { l: '执行中', cls: 'active' },
  dispatched: { l: '已下发', cls: 'active' },
  failed: { l: '失败', cls: 'fail' },
  blocked: { l: '阻塞', cls: 'fail' },
  skipped: { l: '已跳过', cls: '' },
  waiting: { l: '待执行', cls: '' },
}
const KIND_ICON: Record<string, string> = { git: 'git', doc: 'doc', code: 'code', test: 'test', rev: 'review' }

/** 去掉 CLI 输出里的 ANSI 颜色 / 光标控制序列 */
function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
}

/** 本地时区日期 -> YYYY-MM-DD（date input 的原生格式） */
function fmtLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 期望完成时间快速选择：本周/下周取周五（工作周最后一天），本月取月末；任何结果不早于今天 */
function quickDueOptions(): { l: string; v: string }[] {
  const now = new Date()
  const dow = now.getDay() // 0=周日
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (dow === 0 ? -6 : 1 - dow))
  const fri = (base: Date) => fmtLocal(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 4))
  const today = fmtLocal(now)
  const clamp = (v: string) => (v < today ? today : v)
  return [
    { l: '今天', v: today },
    { l: '明天', v: fmtLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) },
    { l: '本周', v: clamp(fri(monday)) },
    { l: '下周', v: fri(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7)) },
    { l: '本月', v: clamp(fmtLocal(new Date(now.getFullYear(), now.getMonth() + 1, 0))) },
  ]
}

function nodeLine(n: IssueNode): string {
  const st = NODE_STATE[n.status ?? '']?.l ?? '未开始'
  const line = (n.execLog ?? '').trim().split('\n').find((l) => l.trim()) ?? ''
  const tail = line.replace(/\s+/g, ' ').trim()
  if (!tail) return st
  return `${st} · ${tail.length > 78 ? `${tail.slice(0, 78)}…` : tail}`
}

export default function Issues({ nav, focus }: { nav: (p: PageKey, focus?: PageFocus) => void; focus?: PageFocus }) {
  const { toast } = useToast()
  const { data: list, loading, reload } = useAsync<Issue[]>(() => fetchIssues(), [])
  const { data: bizTree } = useAsync<BizTreeNode[]>(() => fetchBizTree(), [])
  const { data: userData } = useAsync<UserRow[]>(() => fetchUsers(), [])
  const [filter, setFilter] = useState<Filter>('all')
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [view, setView] = useState<'list' | 'board'>('list')
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<Issue | null>(null)
  const [detailFull, setDetailFull] = useState<IssueDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [step, setStep] = useState(0)
  /** 重新分拣弹框里选定的业务域（空 = 交给自动判定） */
  const [resortBiz, setResortBiz] = useState('')
  const [resorting, setResorting] = useState(false)
  const [acting, setActing] = useState(false)
  /** 详情里就地展开的节点执行日志（step），null 表示都收起 */
  const [openLog, setOpenLog] = useState<number | null>(null)
  /** 归属调整类动作一律走弹框：改派责任人 / 重新分拣 */
  const [reassignOpen, setReassignOpen] = useState(false)
  const [resortOpen, setResortOpen] = useState(false)
  const [reassignTo, setReassignTo] = useState('')
  const [closePanel, setClosePanel] = useState(false)
  const [closeReason, setCloseReason] = useState('')
  const [reopenPanel, setReopenPanel] = useState(false)
  const [reopenDesc, setReopenDesc] = useState('')
  const [form, setForm] = useState({
    bizCode: '', type: 'REQ', title: '', desc: '',
    reporter: '', owner: '', due: '', priority: 'P1',
  })
  const [saving, setSaving] = useState(false)
  /** 待上传的原始材料（本地暂存，提交 Issue 后统一上传） */
  const [pending, setPending] = useState<PendingFile[]>([])
  /** 详情页补充上传面板 */
  const [addDocOpen, setAddDocOpen] = useState(false)
  const [addDocPending, setAddDocPending] = useState<PendingFile[]>([])
  const [uploading, setUploading] = useState(false)

  /** 当前登录用户：优先用后端用户表按工号反查姓名，取不到时回退个人信息里的姓名 */
  const profile = useMemo(() => loadProfile(), [])
  const me = useMemo(() => {
    const hit = (userData ?? []).find((u) => u.no && u.no !== '—' && u.no === profile.no)
    return hit?.name || profile.name || ''
  }, [userData, profile])

  /** 提出人是否被手工改过：未改则始终跟随当前登录用户（用户表异步到位后自动回填） */
  const [reporterEdited, setReporterEdited] = useState(false)
  const reporter = reporterEdited ? form.reporter : (form.reporter || me)
  /** 责任人：选业务域后由开发负责人带出，未指定时默认当前登录用户 */
  const owner = form.owner || me

  /** 业务域平铺列表（由树拍平，保证与树同源） */
  const bizList = useMemo(() => flatBiz(bizTree ?? []), [bizTree])
  const bizOf = (code: string) => bizList.find((b) => b.code === code)

  /** 逗号分隔名单 -> 姓名数组（复用模块级实现，避免两处解析规则漂移） */
  const splitNames = ownerList

  /** 人员候选（姓名 + 工号/来源副标题）：后端用户表优先，补充业务域负责人与当前值 */
  const peopleOptions = useMemo(() => {
    const map = new Map<string, string>()
    const put = (name?: string, sub?: string) => {
      const n = (name ?? '').trim()
      if (!n || n === '—') return
      if (!map.has(n)) map.set(n, sub && sub !== '—' ? sub : '')
    }
    for (const u of userData ?? []) put(u.name, u.no && u.no !== '—' ? u.no : u.role)
    const b = bizOf(form.bizCode)
    for (const n of splitNames(b?.devOwners)) put(n, '开发负责人')
    for (const n of splitNames(b?.bizOwners)) put(n, '业务负责人')
    put(detail?.owner, '当前责任人')
    put(owner)
    put(reporter)
    if (!map.size) return ['王磊', '李娜', '陈昊', '赵敏', '孙悦'].map((name) => ({ name }))
    return Array.from(map, ([name, sub]) => ({ name, sub }))
  }, [userData, form.bizCode, bizList, detail, owner, reporter])

  /** 开发负责人第 1 顺位 = 分拣默认承接人 */
  const devFirst = (b?: { devOwners?: string }) => splitNames(b?.devOwners)[0] ?? ''

  /** 选中业务域后带出默认承接人与优先级，可再手工改；留空则交由系统自动分拣 */
  const applyBiz = (code: string) => {
    const b = bizOf(code)
    setForm((f) => ({
      ...f,
      bizCode: code,
      owner: devFirst(b) || f.owner,
      priority: b?.defaultPriority || f.priority,
    }))
  }

  const resetForm = () => {
    setForm({ bizCode: '', type: 'REQ', title: '', desc: '', reporter: '', owner: '', due: '', priority: 'P1' })
    setReporterEdited(false)
    setPending([])
    setStep(0)
  }

  /** 打开详情：先渲染列表行数据，再补齐实例与节点进度 */
  const openDetail = async (i: Issue) => {
    setDetail(i)
    setDetailFull(null)
    setResortBiz('')
    setReassignOpen(false)
    setResortOpen(false)
    setReassignTo('')
    setClosePanel(false)
    setCloseReason('')
    setReopenPanel(false)
    setReopenDesc(i.desc ?? '')
    setAddDocOpen(false)
    setAddDocPending([])
    setDetailLoading(true)
    try {
      setDetailFull(await fetchIssueDetail(i.id))
    } catch {
      // 聚合接口失败不影响基本信息展示
    } finally {
      setDetailLoading(false)
    }
  }

  /** 重新拉取详情（动作执行后同步实例与节点） */
  const refreshDetail = async (code: string) => {
    const fresh = await fetchIssueDetail(code)
    setDetailFull(fresh)
    setDetail(fresh.issue)
  }

  /* ---- 来自总览的下钻条件 ---- */
  const handledRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!focus) return
    if (focus.status) setStatusFilter(focus.status)
    if (focus.q) setQ(focus.q)
  }, [focus?.at]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focus?.issueCode || !list) return
    if (handledRef.current === focus.at) return
    const hit = list.find((i) => i.id === focus.issueCode)
    if (!hit) return
    handledRef.current = focus.at
    openDetail(hit)
  }, [focus, list]) // eslint-disable-line react-hooks/exhaustive-deps

  const issues = list ?? []
  const counts = useMemo(() => ({
    all: issues.length,
    REQ: issues.filter((i) => i.type === 'REQ').length,
    BUG: issues.filter((i) => i.type === 'BUG').length,
    mine: issues.filter((i) => i.owner === me || i.reporter === me).length,
  }), [issues, me])

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return issues
      .filter((i) => (filter === 'all' ? true : filter === 'mine' ? i.owner === me || i.reporter === me : i.type === filter))
      .filter((i) => {
        if (!statusFilter) return true
        if (statusFilter === 'open') return OPEN_STATUS.includes(i.status)
        return i.status === statusFilter
      })
      .filter((i) => !kw || i.title.toLowerCase().includes(kw) || i.id.toLowerCase().includes(kw) || i.owner.includes(kw) || i.reporter.includes(kw))
  }, [issues, filter, q, statusFilter, me])

  const submit = async () => {
    setSaving(true)
    try {
      const b = bizOf(form.bizCode)
      const created = await createIssue({
        biz: b?.name, bizCode: form.bizCode || undefined,
        type: form.type, title: form.title || '未命名诉求',
        reporter, owner, priority: form.priority,
        description: form.desc, dueDate: form.due || undefined, clientId: undefined,
      })
      // 附件在 Issue 落库后上传（需要 code 做归属）
      let n = 0
      let failed: string[] = []
      if (pending.length) {
        const r = await uploadDocs(created.id, pending.map((p) => p.file), { uploader: reporter || undefined })
        n = r.saved.length
        failed = r.failed
      }
      setOpen(false)
      resetForm()
      reload()
      toast(n
        ? `${created.id} 已提交 · ${n} 个附件已归档${failed.length ? ` · ${failed.length} 个失败` : ''}`
        : failed.length
          ? `${created.id} 已提交 · 附件上传失败：${failed.slice(0, 2).join('、')}`
          : `${created.id} 已提交 · 正在准入判定`)
    } catch (e) {
      toast(`提交失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  /** 人工指定业务域重新分拣 */
  const doResort = async () => {
    if (!detail) return
    setResorting(true)
    try {
      const res = await resortIssue(detail.id, resortBiz || undefined)
      if (res.result.resolved) {
        toast(`已分拣至 ${res.result.bizName ?? ''}${res.result.project ? ` · ${res.result.project}` : ''}`
          + (res.autoStarted ? ` · 已自动启动 ${res.autoStarted}` : ''))
        setResortOpen(false)
        setResortBiz('')
      } else {
        toast('仍无法确定业务域，请在弹框中明确指定一个业务域')
      }
      await refreshDetail(detail.id)
      reload()
    } catch (e) {
      toast(`分拣失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setResorting(false)
    }
  }

  /** 启动工作流：准入通过且已分拣到仓库才可用 */
  const doStart = async () => {
    if (!detail) return
    setActing(true)
    try {
      const r = await startIssue(detail.id)
      toast(`已启动 ${r.instanceCode} · 步骤 ${r.currentStep}/${r.totalSteps}`)
      await refreshDetail(detail.id)
      reload()
    } catch (e) {
      toast(`启动失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setActing(false)
    }
  }

  /** 改派责任人 */
  const doReassign = async () => {
    if (!detail || !reassignTo) return
    setActing(true)
    try {
      const r = await reassignIssue(detail.id, reassignTo)
      toast(r.hint)
      setReassignOpen(false)
      setReassignTo('')
      await refreshDetail(detail.id)
      reload()
    } catch (e) {
      toast(`改派失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setActing(false)
    }
  }

  /** 关闭 Issue：联动取消未完成实例 */
  const doClose = async () => {
    if (!detail) return
    setActing(true)
    try {
      const r = await closeIssue(detail.id, closeReason || undefined)
      toast(r.cancelledInstance
        ? `${detail.id} 已关闭，同时取消实例 ${r.cancelledInstance}`
        : `${detail.id} 已关闭`)
      setClosePanel(false)
      setCloseReason('')
      await refreshDetail(detail.id)
      reload()
    } catch (e) {
      toast(`关闭失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setActing(false)
    }
  }

  /** 重新处理：驳回 / 已关闭的 Issue 补材料后回到准入环节重判 */
  const doReopen = async () => {
    if (!detail) return
    const desc = reopenDesc.trim()
    const changed = desc && desc !== (detail.desc ?? '').trim()
    setActing(true)
    try {
      const r = await reopenIssue(detail.id, changed ? desc : undefined)
      toast(r.admissionResult === 'admit'
        ? `${detail.id} 已重新准入 · ${r.hint}`
        : `${detail.id} 重新判定仍未通过 · ${r.hint}`)
      setReopenPanel(false)
      await refreshDetail(detail.id)
      reload()
    } catch (e) {
      toast(`重新处理失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setActing(false)
    }
  }

  /** 详情页补充上传原始材料（补充材料后常配合「重新处理」） */
  const doUploadDocs = async () => {
    if (!detail || addDocPending.length === 0) return
    setUploading(true)
    try {
      const r = await uploadDocs(detail.id, addDocPending.map((p) => p.file), { uploader: me || undefined })
      setAddDocPending([])
      setAddDocOpen(false)
      toast(r.failed.length
        ? `已上传 ${r.saved.length} 个 · 失败 ${r.failed.length} 个：${r.failed.slice(0, 2).join('、')}`
        : `已上传 ${r.saved.length} 个文件`)
      await refreshDetail(detail.id)
    } catch (e) {
      toast(`上传失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setUploading(false)
    }
  }

  /** 撤回原始材料（含落盘文件） */
  const doDeleteDoc = async (d: { id?: number; name: string }) => {
    if (d.id == null) return
    await deleteDoc(d.id)
    toast(`已删除 ${d.name}`)
  }

  /* 详情动作的派生状态 */
  const inst = detailFull?.instance ?? null
  const detailNodes = detailFull?.nodes ?? []
  /** 文档：提出人上传的原始材料 vs 工作流产出的过程文档 */
  const detailDocs = detailFull?.docs ?? []
  const rawDocs = detailDocs.filter((d) => d.category === 'RAW')
  const procDocs = detailDocs.filter((d) => d.category !== 'RAW')
  const instPct = inst?.totalSteps ? Math.round(((inst.currentStep ?? 0) / inst.totalSteps) * 100) : 0
  const isFinished = detail?.status === 'closed' || detail?.status === 'done'
  // 终态：done / closed / rejected —— 已无活动的工作流实例，作业监控中无可查看的进度
  const isTerminal = detail?.status === 'done' || detail?.status === 'closed' || detail?.status === 'rejected'
  /** 驳回与关闭都是终态，支持补充材料后重新走一遍准入 */
  const canReopen = !!detail && (detail.status === 'rejected' || detail.status === 'closed')
  const canStart = !!detail && detail.admissionResult === 'admit' && !inst && !isFinished && !!detail.repo
  const startHint = canStart ? '' : !detail?.repo
    ? '该 Issue 尚未分拣到仓库，请先在下方「分拣依据」中指定业务域。'
    : detail?.admissionResult !== 'admit'
      ? '准入通过后才能启动工作流。'
      : inst ? `已存在实例 ${inst.instanceCode ?? ''}，如需重跑请先取消该实例。`
        : 'Issue 已关闭或已验收，不能再启动工作流。'

  const columns: { k: Issue['status']; l: string }[] = [
    { k: 'admitting', l: '准入中' }, { k: 'sorting', l: '分拣中' },
    { k: 'running', l: '执行中' }, { k: 'reviewing', l: '评审待决' }, { k: 'done', l: '已验收' },
  ]

  return (
    <div>
      <PageH
        title="Issue"
        desc="所有录入的诉求与缺陷，录入后自动进入准入判定。"
        actions={<button className="btn btn-primary btn-sm" onClick={() => { resetForm(); setOpen(true) }} disabled={loading}><Icon name="plus" size={15} />新建 Issue</button>}
      />

      {loading && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>}
      {/* 加载完成后整体渲染（含新建弹窗）：列表为空时也必须能点「新建 Issue」 */}
      {!loading && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
            <Chips
              value={filter}
              onChange={setFilter}
              items={[
                { v: 'all', l: '全部', n: counts.all },
                { v: 'REQ', l: '需求', n: counts.REQ },
                { v: 'BUG', l: '缺陷', n: counts.BUG },
                { v: 'mine', l: '我的', n: counts.mine },
              ]}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <Search placeholder="搜索标题、ID、责任人、提出人" value={q} onChange={setQ} />
              <div className="seg">
                <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>列表</button>
                <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>看板</button>
              </div>
            </div>
          </div>

          {statusFilter && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
              border: '1px solid var(--line)', borderLeft: '2px solid var(--accent)',
              borderRadius: 9, padding: '9px 12px', background: 'var(--bg-subtle)', fontSize: 12.5,
            }}>
              <Icon name="filter" size={14} />
              <span>
                已按状态筛选：
                <b style={{ marginLeft: 4 }}>
                  {statusFilter === 'open' ? '待处理（未走完生命周期）' : statusMeta[statusFilter]?.l ?? statusFilter}
                </b>
                <span style={{ color: 'var(--ink-4)', marginLeft: 8 }}>命中 {shown.length} 条</span>
              </span>
              <button
                className="btn btn-xs btn-outline" style={{ marginLeft: 'auto' }}
                onClick={() => setStatusFilter(null)}
              >
                <Icon name="x" size={12} />清除筛选
              </button>
            </div>
          )}

          {view === 'list' ? (
            <Panel title={`共 ${shown.length} 条`} flush>
              {shown.length === 0 ? <Empty text={issues.length === 0 ? '暂无 Issue，点击右上角「新建 Issue」开始录入' : '没有符合条件的 Issue'} /> : (
                <table>
                  <thead>
                    <tr><th>ID</th><th>标题</th><th>业务</th><th>类型</th><th>提出人</th><th>责任人</th><th>优先级</th><th>期望完成</th><th>状态</th></tr>
                  </thead>
                  <tbody>
                    {shown.map((i) => (
                      <tr key={i.id} onClick={() => openDetail(i)} style={{ cursor: 'pointer' }}>
                        <td className="tid">{i.id}</td>
                        <td>{i.title}</td>
                        <td>
                          {i.biz || '—'}
                          {i.sortMethod === 'none' && <span style={{ marginLeft: 6 }}><Tag tone="warn" dot>待分拣</Tag></span>}
                        </td>
                        <td><Tag tone={i.type === 'REQ' ? 'info' : 'err'}>{i.type === 'REQ' ? '需求' : '缺陷'}</Tag></td>
                        <td>{i.reporter}</td>
                        <td>{i.owner}</td>
                        <td><span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{i.priority}</span></td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{i.due}</td>
                        <td><Tag tone={statusMeta[i.status].tone} dot>{statusMeta[i.status].l}</Tag></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(180px, 1fr))', gap: 14 }}>
              {columns.map((c) => {
                const items = shown.filter((i) => i.status === c.k)
                return (
                  <div key={c.k} className="panel">
                    <div className="panel-h" style={{ padding: '12px 14px' }}>
                      <h3 style={{ fontSize: 12.5 }}>{c.l}</h3>
                      <span className="tag t-mut">{items.length}</span>
                    </div>
                    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 120 }}>
                      {items.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-4)', textAlign: 'center', padding: '20px 0' }}>—</div>}
                      {items.map((i) => (
                        <div key={i.id} className="card" style={{ padding: 12, cursor: 'pointer' }} onClick={() => openDetail(i)}>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-4)' }}>{i.id}</div>
                          <div style={{ fontSize: 12.5, fontWeight: 550, marginTop: 6 }}>{i.title}</div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 11.5, color: 'var(--ink-4)' }}>
                            <span>提出：{i.reporter}</span><span>{i.due}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {open && (
            <Modal
              title="新建 Issue"
              width={780}
              /* 固定高度：向导各步高度稳定，业务域树面板展开时也不会被内容区裁切 */
              height={640}
              onClose={() => setOpen(false)}
              footer={
                <>
                  <button className="btn btn-outline btn-sm" onClick={() => (step === 0 ? setOpen(false) : setStep(step - 1))} disabled={saving}>
                    {step === 0 ? '取消' : '上一步'}
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => (step === WIZ_STEPS.length - 1 ? submit() : setStep(step + 1))} disabled={saving}>
                    {saving ? '提交中…' : step === WIZ_STEPS.length - 1 ? '提交' : '下一步'}
                  </button>
                </>
              }
            >
              <div className="wiz-steps">
                {WIZ_STEPS.map((s, i) => (
                  <div key={s} className={`ws ${i === step ? 'on' : i < step ? 'done' : ''}`}>{`0${i + 1} · ${s}`}</div>
                ))}
              </div>

              {/* 非「诉求详情」步骤也保留粘贴入口：任何一步 Ctrl+V 都能把文件收进来 */}
              {step !== 1 && pending.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <AttachPane
                    compact
                    files={pending}
                    onChange={setPending}
                    onReject={(names) => toast(`${names.length} 个文件超过 20MB：${names.slice(0, 2).join('、')}`)}
                  />
                </div>
              )}

              {step === 0 && (
                <>
                  <div className="field">
                    <label>业务域</label>
                    <BizTreePicker
                      tree={bizTree ?? []}
                      value={form.bizCode}
                      onChange={(code) => applyBiz(code)}
                    />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 10, marginBottom: 4, lineHeight: 1.7 }}>
                    {form.bizCode
                      ? <>已锁定到 <strong>{bizOf(form.bizCode)?.name}</strong>，
                        业务负责人 {firstOf(bizOf(form.bizCode)?.bizOwners) || '未配置'}、
                        承接人（开发负责人）{devFirst(bizOf(form.bizCode)) || '未配置'}；
                        工作流由下方「诉求类型」自动决定，无需配置。</>
                      : <>留空则系统自动判定：先按业务域关键词匹配，多个业务域同时命中时交 AI 裁决，仍无法确定则进入人工分拣队列。</>}
                  </div>
                  <div className="field">
                    <label>诉求类型</label>
                    <Dropdown
                      width="100%"
                      value={form.type}
                      options={[{ v: 'REQ', l: '需求' }, { v: 'BUG', l: '缺陷' }]}
                      onChange={(v) => setForm({ ...form, type: v })}
                    />
                  </div>
                  <div className="field">
                    <label>标题</label>
                    <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="一句话描述诉求" />
                  </div>
                </>
              )}

              {step === 1 && (
                <>
                  <div className="field">
                    <label>详细描述</label>
                    <textarea rows={5} value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} placeholder="现象、影响范围、期望结果（缺陷请附复现步骤）" />
                  </div>
                  <div className="field">
                    <label>优先级</label>
                    <Dropdown
                      width="100%"
                      value={form.priority}
                      options={[{ v: 'P0', l: 'P0 · 紧急' }, { v: 'P1', l: 'P1 · 高' }, { v: 'P2', l: 'P2 · 常规' }]}
                      onChange={(v) => setForm({ ...form, priority: v })}
                    />
                  </div>
                  <div className="field">
                    <label>附件材料</label>
                    <AttachPane
                      files={pending}
                      onChange={setPending}
                      onReject={(names) => toast(`${names.length} 个文件超过 20MB：${names.slice(0, 2).join('、')}`)}
                      hint="截图、日志、需求稿等原始材料，随 Issue 一起归档；提交后可在详情页查看与下载。"
                    />
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <div className="field">
                    <label>提出人</label>
                    <PersonSelect
                      value={reporter}
                      options={peopleOptions}
                      onChange={(v) => { setReporterEdited(true); setForm({ ...form, reporter: v }) }}
                      placeholder="选择提出人"
                    />
                    <div className="fhelp">默认取当前登录用户{me ? `（${me}${profile.no && profile.no !== '—' ? ` · ${profile.no}` : ''}）` : ''}，可下拉改为代他人录入。</div>
                  </div>
                  <div className="field">
                    <label>责任人</label>
                    <PersonSelect
                      value={owner}
                      options={peopleOptions}
                      onChange={(v) => setForm({ ...form, owner: v })}
                      placeholder="选择责任人"
                    />
                  </div>
                  <div className="field">
                    <label>期望完成时间</label>
                    <input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                      {quickDueOptions().map((o) => (
                        <button
                          key={o.l}
                          type="button"
                          className={`btn btn-xs ${form.due === o.v ? 'btn-primary' : 'btn-outline'}`}
                          onClick={() => setForm({ ...form, due: o.v })}
                        >
                          {o.l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-4)', marginTop: 14, lineHeight: 1.6 }}>
                    选择业务域后系统会自动预填默认责任人；提交后将立即触发 AI 准入判定与项目分拣。
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <div className="review-title">{form.title || '未命名诉求'}</div>
                  <div className="review-tags">
                    <Tag tone={form.type === 'REQ' ? 'info' : 'err'}>{form.type === 'REQ' ? '需求' : '缺陷'}</Tag>
                    <Tag tone="mut">{form.priority}</Tag>
                    <Tag tone={form.bizCode ? 'info' : 'mut'}>
                      {form.bizCode ? bizOf(form.bizCode)?.name ?? form.bizCode : '自动分拣'}
                    </Tag>
                  </div>
                  <div className="id-dl">
                    <div className="r"><span className="k">业务域</span><span className="v">
                      {form.bizCode ? bizOf(form.bizCode)?.name ?? form.bizCode : '自动分拣（按标题与描述判定）'}
                    </span></div>
                    <div className="r"><span className="k">诉求类型</span><span className="v">{form.type === 'REQ' ? '需求' : '缺陷'}</span></div>
                    <div className="r"><span className="k">标题</span><span className="v">{form.title || '未命名诉求'}</span></div>
                    <div className="r"><span className="k">描述</span><span className="v review-desc">{form.desc?.trim() || '—'}</span></div>
                    <div className="r"><span className="k">提出人</span><span className="v">{reporter || '—'}</span></div>
                    <div className="r"><span className="k">责任人</span><span className="v">{owner || '—'}</span></div>
                    <div className="r"><span className="k">期望完成</span><span className="v">{form.due || '未指定'}</span></div>
                    <div className="r"><span className="k">优先级</span><span className="v">{form.priority}</span></div>
                    {pending.length > 0 && (
                      <div className="r">
                        <span className="k">附件材料</span>
                        <span className="v">
                          {pending.length} 个 · {pending.slice(0, 3).map((p) => p.file.name).join('、')}
                          {pending.length > 3 ? ` 等` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="id-note">
                    提交后立即触发 AI 准入判定与业务域分拣
                    {form.bizCode ? '' : '（未指定业务域时由关键词匹配或 AI 裁决确定）'}；
                    {reporter && reporter === me ? '按提出人的「自动执行」偏好，条件满足时无需人工点击即可启动。' : '提出人非当前登录用户时，按该用户的偏好决定是否自动启动。'}
                  </div>
                </>
              )}
            </Modal>
          )}

          {detail && (
            <Modal
              title={`${detail.id} · Issue 详情`}
              size="full"
              onClose={() => setDetail(null)}
              footer={<button className="btn btn-outline btn-sm" onClick={() => setDetail(null)}>关闭</button>}
            >
              <div className="id-wrap">
                {/* 头部：左侧身份，右侧处置动作；大窗下不再竖着堆 */}
                <div className="id-head">
                  <div className="id-head-main">
                    <div className="id-tags">
                      <Tag tone={detail.type === 'REQ' ? 'info' : 'err'}>{detail.type === 'REQ' ? '需求' : '缺陷'}</Tag>
                      <Tag tone="mut">{detail.priority}</Tag>
                      <Tag tone={statusMeta[detail.status].tone} dot>{statusMeta[detail.status].l}</Tag>
                    </div>
                    <h3 className="id-title">{detail.title}</h3>
                    {detail.status === 'closed' && (
                      <div className="id-closed">
                        该 Issue 已关闭{detail.closeReason ? `：${detail.closeReason}` : ''}
                      </div>
                    )}
                    {detail.status === 'rejected' && (
                      <div className="id-closed" style={{ borderLeftColor: 'var(--err)', color: 'var(--err)' }}>
                        准入未通过{detail.admissionReason ? `：${detail.admissionReason}` : '：原因未记录，可在「准入判定」页查看判定日志'}
                        <span style={{ color: 'var(--ink-3)', marginLeft: 6 }}>补充材料后可点上方「重新处理」再次判定。</span>
                      </div>
                    )}
                  </div>

                  <div className="id-head-side">
                    <div className="acts">
                      {canReopen && (
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={acting}
                          onClick={() => { setReopenPanel(!reopenPanel); setClosePanel(false); setReassignOpen(false); setResortOpen(false) }}
                        >
                          <Icon name="refresh" size={14} />{acting ? '处理中…' : '重新处理'}
                        </button>
                      )}
                      <button className={`btn btn-sm ${canReopen ? 'btn-outline' : 'btn-primary'}`} disabled={acting || !canStart} onClick={doStart}>
                        <Icon name="play" size={14} />{acting ? '处理中…' : '启动工作流'}
                      </button>
                      {!isTerminal && (
                        <button
                          className="btn btn-outline btn-sm"
                          disabled={!inst}
                          onClick={() => nav('monitor', { issueCode: detail.id })}
                        >
                          <Icon name="terminal" size={14} />查看进度
                        </button>
                      )}
                      {/* 归属调整：改派责任人与重新分拣成对出现，均走弹框 */}
                      <span className="act-div" />
                      <button
                        className="btn btn-outline btn-sm"
                        disabled={acting || isFinished}
                        onClick={() => { setReassignOpen(true); setResortOpen(false); setClosePanel(false); setReopenPanel(false) }}
                      >
                        <Icon name="users" size={14} />改派责任人
                      </button>
                      <button
                        className="btn btn-outline btn-sm"
                        disabled={acting || resorting || isFinished}
                        onClick={() => { setResortOpen(true); setReassignOpen(false); setClosePanel(false); setReopenPanel(false) }}
                      >
                        <Icon name="branch" size={14} />重新分拣
                      </button>
                      <span className="act-div" />
                      <button
                        className="btn btn-outline btn-sm"
                        disabled={acting || isFinished}
                        onClick={() => { setClosePanel(!closePanel); setReassignOpen(false); setResortOpen(false) }}
                      >
                        <Icon name="x" size={14} />关闭 Issue
                      </button>
                    </div>
                    <div className="meta">
                      {inst
                        ? `${INST_LABEL[inst.status ?? ''] ?? inst.status} · 节点 ${inst.currentStep ?? 0}/${inst.totalSteps ?? 0}`
                        : canStart
                          ? '已满足启动条件，将按提出人设置自动启动（客户端离线时待上线补启）'
                          : '尚未启动工作流'}
                    </div>
                    {!canStart && startHint && <div className="hint">{startHint}</div>}
                  </div>
                </div>

                {/* 动作展开区：整宽，独占一行（改派 / 重新分拣已改为弹框，此处只留终态动作） */}
                {reopenPanel && canReopen && (
                  <div className="id-ctx">
                    <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 10, lineHeight: 1.6 }}>
                      重新处理会清空上一次的判定结论{detail.status === 'closed' ? '与关闭原因' : ''}，回到「准入中」并按下方描述重新判定与分拣；
                      原判定理由已记录在右侧「准入判定」，可据此补充后再提交。
                    </div>
                    <div className="field">
                      <label>描述（可补充后再重新判定）</label>
                      <textarea
                        rows={5}
                        value={reopenDesc}
                        onChange={(e) => setReopenDesc(e.target.value)}
                        placeholder="补充现象、影响范围、期望结果（缺陷请附复现步骤）"
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button className="btn btn-primary btn-sm" disabled={acting} onClick={doReopen}>确认重新处理</button>
                      <button className="btn btn-outline btn-sm" disabled={acting} onClick={() => { setReopenPanel(false); setReopenDesc(detail.desc ?? '') }}>取消</button>
                    </div>
                  </div>
                )}

                {closePanel && (
                  <div className="id-ctx">
                    <div style={{ fontSize: 12.5, color: 'var(--warn)', marginBottom: 9, lineHeight: 1.6 }}>
                      关闭后该 Issue 不再参与工作流；若已有实例在执行，未完成节点将被标记为跳过，且不可恢复。
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        className="inp" style={{ flex: 1, height: 34 }}
                        value={closeReason} onChange={(e) => setCloseReason(e.target.value)}
                        placeholder="关闭原因（可选，如：重复诉求 / 用户撤回）"
                      />
                      <button className="btn btn-primary btn-sm" disabled={acting} onClick={doClose}>确认关闭</button>
                      <button className="btn btn-outline btn-sm" disabled={acting} onClick={() => { setClosePanel(false); setCloseReason('') }}>取消</button>
                    </div>
                  </div>
                )}

                <div className="id-cols">
                  {/* 1｜诉求：这是什么 */}
                  <div className="id-col id-col-a">
                    <section>
                      <div className="id-sec-h"><h4>详细描述</h4></div>
                      <div className="id-panel">
                        <div className="id-desc">{detail.desc || '（无详细描述）'}</div>
                      </div>
                    </section>

                    <section>
                      <div className="id-sec-h">
                        <h4>原始文件</h4>
                        {rawDocs.length > 0 && <span className="tag t-mut">{rawDocs.length}</span>}
                      </div>
                      <div className="id-panel">
                        {detailLoading && detailDocs.length === 0
                          ? <div className="id-muted">读取文档…</div>
                          : (
                            <DocList
                              docs={rawDocs}
                              empty="提出时未上传附件，可在下方补充材料（截图 / 日志 / 需求稿）。"
                              onDelete={doDeleteDoc}
                              onChanged={() => refreshDetail(detail.id)}
                            />
                          )}
                        {addDocOpen ? (
                          <div style={{ marginTop: 12 }}>
                            <AttachPane
                              compact
                              files={addDocPending}
                              onChange={setAddDocPending}
                              onReject={(names) => toast(`${names.length} 个文件超过 20MB：${names.slice(0, 2).join('、')}`)}
                            />
                            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                              <button
                                className="btn btn-primary btn-sm"
                                disabled={uploading || addDocPending.length === 0}
                                onClick={doUploadDocs}
                              >
                                {uploading ? '上传中…' : `上传 ${addDocPending.length || ''} 个文件`}
                              </button>
                              <button
                                className="btn btn-outline btn-sm"
                                disabled={uploading}
                                onClick={() => { setAddDocPending([]); setAddDocOpen(false) }}
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            className="btn btn-xs btn-outline"
                            style={{ marginTop: 12 }}
                            onClick={() => setAddDocOpen(true)}
                          >
                            <Icon name="plus" size={12} />补充材料
                          </button>
                        )}
                      </div>
                    </section>

                    <section>
                      <div className="id-sec-h">
                        <h4>过程文件</h4>
                        {procDocs.length > 0 && <span className="tag t-mut">{procDocs.length}</span>}
                      </div>
                      <div className="id-panel">
                        {detailLoading && detailDocs.length === 0
                          ? <div className="id-muted">读取文档…</div>
                          : (
                            <DocList
                              docs={procDocs}
                              empty="工作流执行后由客户端回传过程文档（需求概要 / 详细设计 / 测试报告等），这里按 Issue 归档。"
                            />
                          )}
                      </div>
                    </section>
                  </div>

                  {/* 2｜事实：谁、在哪、怎么路由的 */}
                  <div className="id-col id-col-c">
                    <section>
                      <div className="id-sec-h"><h4>准入判定</h4></div>
                      <div className="id-panel">
                        <div className="id-dl">
                          <div className="r">
                            <span className="k">结论</span>
                            <span className="v">
                              {detail.admissionResult === 'admit' && <Tag tone="ok">准入通过</Tag>}
                              {detail.admissionResult === 'reject' && <Tag tone="err">准入驳回</Tag>}
                              {!detail.admissionResult && <span style={{ color: 'var(--ink-4)' }}>判定中…</span>}
                              {detail.confidence != null && detail.admissionResult && (
                                <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-4)', marginLeft: 8 }}>
                                  置信度 {detail.confidence}
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                        {detail.admissionReason && <div className="id-note">{detail.admissionReason}</div>}
                      </div>
                    </section>

                    <section>
                      <div className="id-sec-h"><h4>关键信息</h4></div>
                      <div className="id-panel">
                        <div className="id-dl">
                          <div className="r">
                            <span className="k">业务域</span>
                            <span className="v">
                              {detail.biz || '—'}
                              {detail.bizCode && <span style={{ color: 'var(--ink-4)', fontFamily: 'var(--mono)', fontSize: 11.5 }}> {detail.bizCode}</span>}
                            </span>
                          </div>
                          <div className="r"><span className="k">提出人</span><span className="v">{detail.reporter || '—'}</span></div>
                          <div className="r"><span className="k">责任人</span><span className="v">{detail.owner || '—'}</span></div>
                          <div className="r"><span className="k">期望完成</span><span className="v mono">{detail.due || '—'}</span></div>
                          <div className="r"><span className="k">分拣项目</span><span className="v">{detail.project || '—'}</span></div>
                          <div className="r"><span className="k">仓库</span><span className="v mono">{detail.repo || '—'}</span></div>
                        </div>
                      </div>
                    </section>

                    <section>
                      <div className="id-sec-h"><h4>分拣依据</h4></div>
                      <div className="id-panel">
                        <div className="id-dl">
                          <div className="r">
                            <span className="k">分拣方式</span>
                            <span className="v">
                              {detail.sortMethod
                                ? <Tag tone={SORT_LABEL[detail.sortMethod]?.tone ?? 'mut'}>{SORT_LABEL[detail.sortMethod]?.l ?? detail.sortMethod}</Tag>
                                : <span style={{ color: 'var(--ink-4)' }}>—</span>}
                            </span>
                          </div>
                          <div className="r"><span className="k">工作分支</span><span className="v mono">{detail.branch || '—'}</span></div>
                        </div>

                        {detail.sortReason && <div className="id-note">{detail.sortReason}</div>}

                        <div
                          style={{
                            marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)',
                            fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.7,
                          }}
                        >
                          分拣结果需要调整时，使用上方「重新分拣」指定业务域（留空则按标题与描述重新判定）。
                        </div>
                      </div>
                    </section>
                  </div>

                  {/* 3｜过程：跑到哪了 */}
                  <div className="id-col id-col-b">
                    <section>
                      <div className="id-sec-h">
                        <h4>执行进度</h4>
                        {inst && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Tag tone={INST_TONE[inst.status ?? ''] ?? 'mut'} dot>{INST_LABEL[inst.status ?? ''] ?? inst.status}</Tag>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-4)' }}>{inst.instanceCode}</span>
                          </div>
                        )}
                      </div>
                      <div className="id-panel">
                        {detailLoading && <div className="id-muted">读取执行进度…</div>}

                        {!detailLoading && !inst && (
                          <div className="id-muted">
                            {detail.admissionResult === 'admit'
                              ? (canStart
                                ? '准入通过且已分拣到仓库，满足自动启动条件；客户端在线时立即执行，离线则待其上线后自动补启。也可手动启动。'
                                : '尚未启动工作流。完成上方「启动工作流」后，节点进度会在这里实时更新。')
                              : '准入通过后才可启动工作流；当前实例尚未创建。'}
                          </div>
                        )}

                        {!detailLoading && inst && (
                          <>
                            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                              <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>已终结节点</span>
                              <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>{inst.currentStep ?? 0} / {inst.totalSteps ?? 0}</span>
                            </div>
                            <Progress pct={instPct} />
                            <div style={{ display: 'flex', gap: 18, marginTop: 10, fontSize: 11.5, color: 'var(--ink-4)', flexWrap: 'wrap' }}>
                              <span>模板 <b style={{ fontFamily: 'var(--mono)', fontWeight: 500, color: 'var(--ink-3)' }}>{inst.templateCode ?? '—'}</b></span>
                              <span>客户端 <b style={{ fontFamily: 'var(--mono)', fontWeight: 500, color: 'var(--ink-3)' }}>{inst.clientId || '未指定'}</b></span>
                            </div>

                    {detailNodes.length > 0 && (
                      <div className="timeline" style={{ marginTop: 16 }}>
                        {detailNodes.map((n) => {
                          const full = stripAnsi(n.execLog ?? '').trim()
                          const expanded = openLog === n.step
                          const nt = nodeTime(n.startedAt, n.finishedAt, n.status)
                          return (
                            <Fragment key={n.step}>
                              <div
                                className={`tl clickable ${NODE_STATE[n.status ?? '']?.cls ?? ''} ${expanded ? 'sel' : ''}`}
                                onClick={() => setOpenLog(expanded ? null : n.step)}
                                title={full ? '点击展开该节点完整执行日志' : '该节点暂无日志'}
                              >
                                <div className="tld"><div className="dot"><Icon name={KIND_ICON[n.kind] ?? 'check'} size={13} /></div></div>
                                <div className="tlb">
                                  <div className="tlhead">
                                    <div className="tlt">{n.step}. {n.name}</div>
                                    {nt && <span className="tltime" title={nodeTimeRange(n.startedAt, n.finishedAt)}>{nt}</span>}
                                  </div>
                                  <div className="tls">{nodeLine(n)}</div>
                                </div>
                                {full && (
                                  <span className="tlgo">
                                    {expanded ? '收起' : '查看日志'}
                                    <Icon name={expanded ? 'chevron' : 'arrow'} size={12} />
                                  </span>
                                )}
                              </div>
                              {expanded && (
                                <pre className="nodelog" style={{ margin: '0 0 16px 42px' }}>
                                  {full || '该节点尚未回传日志。\n\n节点执行完成后由客户端回执写入；客户端离线时可用作业监控页的「人工回执」补结论。'}
                                </pre>
                              )}
                            </Fragment>
                          )
                        })}
                      </div>
                    )}

                            {!isTerminal && (
                              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                                <a
                                  style={{ color: 'var(--accent)', cursor: 'pointer', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                                  onClick={() => nav('monitor', { issueCode: detail.id })}
                                >
                                  在作业监控中打开 <Icon name="arrow" size={12} />
                                </a>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </section>
                  </div>

                </div>
              </div>
            </Modal>
          )}

          {/* 改派责任人：与详情大窗平级渲染（避免嵌套弹框被大窗裁切），两者互斥打开 */}
          {detail && reassignOpen && (
            <Modal
              title="改派责任人"
              width={520}
              onClose={() => { setReassignOpen(false); setReassignTo('') }}
              footer={(
                <>
                  <button className="btn btn-outline btn-sm" disabled={acting} onClick={() => { setReassignOpen(false); setReassignTo('') }}>取消</button>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={acting || !reassignTo || reassignTo === detail.owner}
                    onClick={doReassign}
                  >
                    {acting ? '处理中…' : '确认改派'}
                  </button>
                </>
              )}
            >
              <div className="id-dl dlg-dl">
                <div className="r"><span className="k">当前责任人</span><span className="v">{detail.owner || '—'}</span></div>
                <div className="r">
                  <span className="k">执行中实例</span>
                  <span className="v mono">{inst?.instanceCode ?? '无'}</span>
                </div>
              </div>
              <div className="field">
                <label>改派至</label>
                <PersonSelect
                  value={reassignTo}
                  options={peopleOptions.filter((o) => o.name !== detail.owner)}
                  onChange={setReassignTo}
                  placeholder="选择新的责任人"
                  width="100%"
                />
              </div>
              <div className="dlg-hint">
                {inst
                  ? `改派只影响后续下发：当前实例 ${inst.instanceCode} 正在执行，执行客户端不会自动切换，如需切换请先取消该实例。`
                  : '改派后下次启动的实例将按新责任人下发；是否自动启动仍按提出人的「自动执行」偏好决定。'}
              </div>
            </Modal>
          )}

          {/* 重新分拣：指定业务域或交回自动判定 */}
          {detail && resortOpen && (
            <Modal
              title="重新分拣业务域"
              width={620}
              onClose={() => { setResortOpen(false); setResortBiz('') }}
              footer={(
                <>
                  <button className="btn btn-outline btn-sm" disabled={resorting} onClick={() => { setResortOpen(false); setResortBiz('') }}>取消</button>
                  <button className="btn btn-primary btn-sm" disabled={resorting} onClick={doResort}>
                    {resorting ? '分拣中…' : '确认重新分拣'}
                  </button>
                </>
              )}
            >
              <div className="id-dl dlg-dl">
                <div className="r">
                  <span className="k">当前业务域</span>
                  <span className="v">
                    {detail.biz || '—'}
                    {detail.bizCode && <span style={{ color: 'var(--ink-4)', fontFamily: 'var(--mono)', fontSize: 11.5 }}> {detail.bizCode}</span>}
                  </span>
                </div>
                <div className="r"><span className="k">当前仓库</span><span className="v mono">{detail.repo || '—'}</span></div>
                <div className="r">
                  <span className="k">分拣方式</span>
                  <span className="v">
                    {detail.sortMethod
                      ? <Tag tone={SORT_LABEL[detail.sortMethod]?.tone ?? 'mut'}>{SORT_LABEL[detail.sortMethod]?.l ?? detail.sortMethod}</Tag>
                      : <span style={{ color: 'var(--ink-4)' }}>—</span>}
                  </span>
                </div>
              </div>
              {detail.sortReason && <div className="id-note">{detail.sortReason}</div>}
              <div className="field">
                <label>指定业务域（留空则按标题与描述自动判定）</label>
                <BizTreePicker tree={bizTree ?? []} value={resortBiz} onChange={setResortBiz} />
              </div>
              <div className="dlg-hint">
                重新分拣会按所选业务域重算仓库、工作分支与执行客户端；人工指定后记为「人工指定」分拣方式，
                并会按提出人的「自动执行」偏好尝试自动启动。
                {inst ? ` 当前实例 ${inst.instanceCode} 的快照不受影响，仍按原业务域执行。` : ''}
              </div>
            </Modal>
          )}

          <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--ink-4)' }}>
            提交后：AI 准入判定 → 项目分拣（识别仓库）→ 匹配工作流模板 → 下发至责任人客户端。
            <a style={{ color: 'var(--accent)', cursor: 'pointer', marginLeft: 8 }} onClick={() => nav('admission')}>查看判定队列 →</a>
          </div>
        </>
      )}
    </div>
  )
}

/** 业务树拍平成节点列表，供反查与统计复用 */
function flatBiz(nodes: BizTreeNode[], out: BizTreeNode[] = []): BizTreeNode[] {
  for (const n of nodes) {
    out.push(n)
    flatBiz(n.children ?? [], out)
  }
  return out
}

/** 负责人字符串（多人逗号分隔）→ 名单 */
function ownerList(s?: string): string[] {
  return (s || '').split(/[,，、;；\s]+/).map((x) => x.trim()).filter(Boolean)
}
/** 第 1 顺位负责人 */
const firstOf = (s?: string) => ownerList(s)[0] ?? ''
/** 展示用：最多 2 人，超出折叠为 +N */
const shortOwners = (s?: string) => {
  const a = ownerList(s)
  return a.length ? `${a.slice(0, 2).join('、')}${a.length > 2 ? ` +${a.length - 2}` : ''}` : ''
}

/**
 * 业务域单选树：按父子层级缩进展示，每个节点在名称下给出「业务负责人 / 开发负责人」
 * （自身未配置时沿父链继承，以 ↑ 标注），顶部固定「自动分拣」选项；支持检索与逐层折叠。
 */
function BizTreePicker({ tree, value, onChange }: {
  tree: BizTreeNode[]
  value: string
  onChange: (code: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    /** 捕获阶段拦截 Esc：只收起面板，不连带关掉外层 Modal */
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', esc, true)
    }
  }, [open])

  /** 检索：命中名称 / 编码 / 负责人即保留，并带上完整祖先链 */
  const filterSet = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return null
    const hit = new Set<string>()
    const walk = (n: BizTreeNode, ancestors: string[]): boolean => {
      const self = [n.name, n.code, n.bizOwners, n.devOwners].some((s) => (s || '').toLowerCase().includes(kw))
      let childHit = false
      for (const c of n.children ?? []) childHit = walk(c, [...ancestors, n.code]) || childHit
      if (self || childHit) {
        hit.add(n.code)
        ancestors.forEach((a) => hit.add(a))
        return true
      }
      return false
    }
    tree.forEach((r) => walk(r, []))
    return hit
  }, [tree, q])

  const cur = useMemo(() => flatBiz(tree).find((n) => n.code === value), [tree, value])

  const rows: ReactNode[] = []
  const renderNodes = (
    nodes: BizTreeNode[],
    depth: number,
    inherited: { biz: string; dev: string; bizFrom?: string; devFrom?: string; disabled: boolean },
  ) => {
    for (const n of nodes) {
      if (filterSet && !filterSet.has(n.code)) continue
      const kids = n.children ?? []
      const searching = !!filterSet
      const isCollapsed = !searching && !!collapsed[n.code]
      const disabled = inherited.disabled || !n.enabled
      const checked = value === n.code

      const ownBiz = shortOwners(n.bizOwners)
      const ownDev = shortOwners(n.devOwners)
      const bizText = ownBiz || (inherited.biz ? `${shortOwners(inherited.biz)} ↑` : '—')
      const devText = ownDev || (inherited.dev ? `${shortOwners(inherited.dev)} ↑` : '—')

      rows.push(
        <div
          key={n.code}
          data-biz={n.code}
          className={`dd-i tree${checked ? ' on' : ''}${disabled ? ' off' : ''}`}
          onClick={() => { if (disabled) return; onChange(n.code); setOpen(false) }}
          style={{ paddingLeft: 10 + depth * 18 }}
        >
          {kids.length > 0 ? (
            <button
              className="tw-arrow"
              onClick={(e) => { e.stopPropagation(); setCollapsed((c) => ({ ...c, [n.code]: !c[n.code] })) }}
            >
              <Icon name="chevron" size={12} className={isCollapsed ? '' : 'op'} />
            </button>
          ) : (
            <span className="tw-gap" />
          )}
          <span className="tn">{n.name}</span>
          <span className="tc">{n.code}</span>
          {!n.enabled && <span className="toff">停用</span>}
          <span className="tbz">
            <span className={ownBiz ? '' : 'inh'} title={ownBiz ? undefined : inherited.biz ? `沿父级 ${inherited.bizFrom ?? ''} 继承` : undefined}>
              业务 {bizText}
            </span>
            <span className={ownDev ? '' : 'inh'} title={ownDev ? undefined : inherited.dev ? `沿父级 ${inherited.devFrom ?? ''} 继承` : undefined}>
              开发 {devText}
            </span>
          </span>
          {checked && <Icon name="check" size={13} className="tck" />}
        </div>,
      )
      if (kids.length > 0 && !isCollapsed) {
        renderNodes(kids, depth + 1, {
          biz: firstOf(n.bizOwners) ? n.bizOwners ?? '' : inherited.biz,
          dev: firstOf(n.devOwners) ? n.devOwners ?? '' : inherited.dev,
          bizFrom: firstOf(n.bizOwners) ? n.name : inherited.bizFrom,
          devFrom: firstOf(n.devOwners) ? n.name : inherited.devFrom,
          disabled,
        })
      }
    }
  }
  renderNodes(tree, 0, { biz: '', dev: '', disabled: false })

  return (
    <div ref={ref} className={`dd${open ? ' open' : ''}`} style={{ width: '100%' }}>
      <button type="button" className={`dd-btn${open ? ' on' : ''}`} data-picker="biz" onClick={() => setOpen(!open)}>
        <span className="dd-l" style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          {cur ? (
            <>
              <span className="tn">{cur.name}</span>
              <span className="tc">{cur.code}</span>
            </>
          ) : (
            <span className="tph">自动分拣（按标题与描述判定）</span>
          )}
        </span>
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="dd-menu tree" style={{ width: 560, maxWidth: '100%' }}>
          <div className="dd-search">
            <Icon name="search" size={14} />
            <input placeholder="搜索业务域 / 负责人" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          <div className="dd-tree">
            <div
              data-biz=""
              className={`dd-i tree${value ? '' : ' on'}`}
              onClick={() => { onChange(''); setOpen(false) }}
            >
              <span className="tw-gap" />
              <span className="tn">自动分拣（按标题与描述判定）</span>
              {!value && <Icon name="check" size={13} className="tck" />}
            </div>
            {rows.length === 0 ? <div className="dd-empty">没有匹配的业务域</div> : rows}
          </div>
        </div>
      )}
    </div>
  )
}
