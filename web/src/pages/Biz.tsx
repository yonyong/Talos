import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../icons'
import { Empty, Modal, PageH, Search, Stepper, Tag, useToast } from '../ui'
import { deleteBizDomain, fetchBizTree, fetchClients, fetchRepos, fetchUsers, saveBizDomain, sortPreview, useAsync } from '../api'
import type { BizDomain, BizTreeNode, Repo, SortPreview } from '../types'

const EMPTY: BizDomain = {
  code: '', name: '', parentCode: null, repoProject: null, keywords: '', bizOwners: '', devOwners: '',
  defaultPriority: 'P1', sensitiveLevel: '普通',
  slaHours: 8, enabled: true, description: '',
}

const METHOD_LABEL: Record<string, string> = {
  auto: '关键词唯一命中', llm: 'LLM 歧义裁决', manual: '人工指定', none: '待人工分拣',
}

/** 多人字段拆分：逗号 / 顿号 / 分号 / 空白均可 */
const people = (s?: string | null) =>
  (s || '').split(/[,，、;；\s]+/).map((x) => x.trim()).filter(Boolean)

type Row = { node: BizTreeNode; depth: number }

/** 把树拍平成带层级的行，供父域下拉与统计复用 */
function flatten(nodes: BizTreeNode[], depth = 0, out: Row[] = []): Row[] {
  for (const n of nodes) {
    out.push({ node: n, depth })
    flatten(n.children ?? [], depth + 1, out)
  }
  return out
}

function Meta({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div>
      <div style={{ color: 'var(--ink-4)', fontSize: 12 }}>{label}</div>
      <div style={{
        marginTop: 4, fontSize: 12.5, fontWeight: 550, wordBreak: 'break-all',
        fontFamily: mono ? 'var(--mono)' : undefined,
      }}>
        {value || '—'}
      </div>
    </div>
  )
}

/** 弹窗内分组标题；first 组不带上分隔线 */
function Sect({ title, hint, first }: { title: string; hint?: string; first?: boolean }) {
  return (
    <div className={`fsect ${first ? 'first' : ''}`}>
      <b>{title}</b>
      {hint && <span>{hint}</span>}
    </div>
  )
}

/** 字段 + 下沉说明：label 只留名词，解释放输入框下方的小字 helper */
function F({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="field" style={{ marginTop: 14 }}>
      <label>{label}</label>
      {children}
      {help && <div className="fhelp">{help}</div>}
    </div>
  )
}

/**
 * 搜索式多人选择器：输入姓名即时过滤候选（来自 /api/users），回车或点击加入；
 * 不在花名册的名字也能回车手动添加。已选按顺序展示，序号即优先级（第 1 人为主责），
 * 点击已选胶囊移除。值以逗号分隔字符串存储，与后端多人字段直接对应。
 */
function OwnerPicker({ pool, value, onChange, placeholder }: {
  pool: string[]; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const selected = people(value)
  const kw = q.trim()
  const klc = kw.toLowerCase()

  const options = useMemo(() => {
    const uniq = Array.from(new Set(pool))
    const hit = uniq.filter((n) => !selected.includes(n) && n.toLowerCase().includes(klc)).slice(0, 8)
    const extra = kw && !uniq.some((n) => n.toLowerCase() === klc) && !selected.includes(kw) ? [kw] : []
    return [...extra, ...hit]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, value, klc])

  const add = (name: string) => { onChange([...selected, name].join(',')); setQ('') }
  const remove = (name: string) => onChange(selected.filter((s) => s !== name).join(','))

  return (
    <div className="owner-pick" onBlur={() => window.setTimeout(() => setOpen(false), 140)}>
      {selected.length > 0 && (
        <div className="owner-chips">
          {selected.map((s, i) => (
            <button type="button" key={s} className="kw clickable pick on" title="点击移除" onClick={() => remove(s)}>
              <b>{i + 1}</b>{s}<Icon name="x" size={11} />
            </button>
          ))}
        </div>
      )}
      <div className="owner-search">
        <Icon name="search" size={14} />
        <input
          value={q}
          placeholder={placeholder ?? '输入姓名搜索，回车添加；第 1 人为主责'}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && kw) { e.preventDefault(); add(kw) }
            if (e.key === 'Escape') setOpen(false)
          }}
        />
      </div>
      {open && (
        <div className="owner-drop">
          {options.length === 0 && <div className="owner-empty">无匹配，回车可直接添加「{kw}」</div>}
          {options.map((o) => (
            <button type="button" key={o} onMouseDown={(e) => { e.preventDefault(); add(o) }}>
              {!pool.includes(o) && <Tag tone="info">手动</Tag>}
              <span>{o}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 仓库选择器：触发按钮直接展示当前绑定（project + repoUrl），点击展开搜索式下拉；
 * 每项展示 project、仓库地址与敏感标记，当前项打勾，顶部提供「未绑定」选项。
 * 详情区选中即保存，编辑弹框中仅回写 draft。
 */
function RepoPicker({ repos, value, onPick }: {
  repos: Repo[]; value: string; onPick: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const klc = q.trim().toLowerCase()

  const list = useMemo(() => repos.filter((r) =>
    !klc || r.project.toLowerCase().includes(klc) || (r.repoUrl || '').toLowerCase().includes(klc)
  ), [repos, klc])
  const cur = repos.find((r) => r.project === value)

  return (
    <div
      className="repo-pick"
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false) }}
    >
      <button type="button" className={`repo-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)}
        title={cur ? `绑定仓库 ${cur.project}` : '未绑定仓库'}>
        <Icon name="git" size={14} />
        {cur ? (
          <span className="rb-cur"><b>{cur.project}</b><span>{cur.repoUrl}</span></span>
        ) : (
          <span className="rb-none">未绑定 · 沿父链继承</span>
        )}
        <Icon name="chevron" size={13} />
      </button>
      {open && (
        <div className="repo-drop">
          <div className="repo-find">
            <Icon name="search" size={13} />
            <input autoFocus value={q} placeholder="搜索 project / 仓库地址"
              onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
              onChange={(e) => setQ(e.target.value)} />
          </div>
          <button type="button" className={`repo-opt ${!value ? 'on' : ''}`}
            onMouseDown={(e) => { e.preventDefault(); onPick(''); setOpen(false) }}>
            <span className="ro-name">（未绑定，沿父链继承）</span>
            {!value && <Icon name="check" size={13} className="ro-check" />}
          </button>
          {list.map((r) => (
            <button type="button" key={r.project} className={`repo-opt ${r.project === value ? 'on' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); onPick(r.project); setOpen(false) }}>
              <span className="ro-name"><b>{r.project}</b>{r.sensitive && <Tag tone="warn">敏感</Tag>}</span>
              <span className="ro-url">{r.repoUrl}</span>
              {r.project === value && <Icon name="check" size={13} className="ro-check" />}
            </button>
          ))}
          {list.length === 0 && <div className="repo-empty">无匹配仓库</div>}
        </div>
      )}
    </div>
  )
}

function TreeRow({
  row, selected, expanded, onSelect, onToggle, onContext,
}: {
  row: Row; selected: boolean; expanded: boolean
  onSelect: () => void; onToggle: () => void
  onContext: (node: BizTreeNode, x: number, y: number) => void
}) {
  const { node, depth } = row
  const hasKids = (node.children?.length ?? 0) > 0
  return (
    <div
      className={`tree-row ${selected ? 'on' : ''}`}
      style={{ paddingLeft: 10 + depth * 18 }}
      onClick={onSelect}
      onContextMenu={(e) => { e.preventDefault(); onContext(node, e.clientX, e.clientY) }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect() }}
    >
      {hasKids ? (
        <button
          className={`tree-caret ${expanded ? 'open' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggle() }}
          title={expanded ? '收起' : '展开'}
        >
          <Icon name="chevron" size={13} />
        </button>
      ) : (
        <span className="tree-leaf" />
      )}
      <span className="tree-name">{node.name}</span>
      <span className="tree-code">{node.code}</span>
      {node.repo && (
        <span title={`绑定仓库 ${node.repo.project}`} style={{ display: 'inline-flex', color: 'var(--ink-4)', flex: 'none' }}>
          <Icon name="git" size={12} />
        </span>
      )}
      {!node.enabled && <Tag tone="mut">停用</Tag>}
      {hasKids && <span className="tree-count">{node.children.length}</span>}
    </div>
  )
}

export default function Biz() {
  const { toast } = useToast()
  const { data: tree, loading, reload } = useAsync<BizTreeNode[]>(() => fetchBizTree(), [])
  const { data: userData } = useAsync(() => fetchUsers(), [])
  const { data: clientData } = useAsync(() => fetchClients(), [])
  const { data: repoData } = useAsync<Repo[]>(() => fetchRepos(), [])
  const [sel, setSel] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [tq, setTq] = useState('')
  const [draft, setDraft] = useState<BizDomain | null>(null)
  const [step, setStep] = useState(0)
  const [menu, setMenu] = useState<{ x: number; y: number; node: BizTreeNode } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<BizDomain | null>(null)
  const [saving, setSaving] = useState(false)
  const [probeOpen, setProbeOpen] = useState(false)

  const [probeTitle, setProbeTitle] = useState('')
  const [probeDesc, setProbeDesc] = useState('')
  const [probe, setProbe] = useState<SortPreview | null>(null)
  const [probing, setProbing] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const roots = tree ?? []
  const rows = useMemo(() => flatten(roots), [roots])
  const current = rows.find((r) => r.node.code === sel)?.node ?? null
  const allDomains = useMemo(() => rows.map((r) => r.node), [rows])
  const userPool = useMemo(() => (userData ?? []).map((u) => u.name).filter(Boolean), [userData])
  const clientIds = useMemo(() => (clientData ?? []).map((c) => c.id).filter(Boolean), [clientData])
  const repoList = useMemo(() => repoData ?? [], [repoData])

  /** 业务树上直接绑定 / 解绑仓库：绑定存在业务域侧，空串 = 显式解绑 */
  const bindRepo = async (d: BizDomain, project: string) => {
    try {
      await saveBizDomain({ ...d, repoProject: project })
      reload()
      toast(project ? `${d.name} 已绑定仓库 ${project}` : `${d.name} 已解绑仓库`)
    } catch (e) {
      toast(`操作失败：${e instanceof Error ? e.message : e}`)
    }
  }

  useEffect(() => {
    if (!sel && rows.length > 0) setSel(rows[0].node.code)
    if (sel && rows.length > 0 && !rows.some((r) => r.node.code === sel)) setSel(rows[0].node.code)
  }, [rows, sel])

  useEffect(() => {
    window.clearTimeout(timer.current)
    if (!probeTitle.trim()) { setProbe(null); setProbing(false); return }
    setProbing(true)
    timer.current = window.setTimeout(() => {
      sortPreview({ title: probeTitle, desc: probeDesc })
        .then(setProbe)
        .catch(() => setProbe(null))
        .finally(() => setProbing(false))
    }, 420)
    return () => window.clearTimeout(timer.current)
  }, [probeTitle, probeDesc])

  /** 右键菜单：点击任意处 / Esc 关闭 */
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    window.addEventListener('click', close)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', esc) }
  }, [menu])

  const stats = useMemo(() => ({
    roots: roots.length,
    total: allDomains.length,
    owners: allDomains.filter((d) => d.devOwners || d.bizOwners).length,
    leaf: allDomains.filter((d) => !rows.some((r) => r.node.parentCode === d.code)).length,
  }), [roots.length, allDomains, rows])

  /** 树检索：命中名称 / 编码 / 关键词的节点保留，并带上全部祖先 */
  const filterSet = useMemo(() => {
    const kw = tq.trim().toLowerCase()
    if (!kw) return null
    const hit = new Set<string>()
    const walk = (n: BizTreeNode, ancestors: string[]): boolean => {
      const self = n.name.toLowerCase().includes(kw)
        || n.code.toLowerCase().includes(kw)
        || (n.keywords || '').toLowerCase().includes(kw)
      let childHit = false
      for (const c of n.children ?? []) childHit = walk(c, [...ancestors, n.code]) || childHit
      if (self || childHit) { hit.add(n.code); ancestors.forEach((a) => hit.add(a)); return true }
      return false
    }
    roots.forEach((r) => walk(r, []))
    return hit
  }, [roots, tq])

  const visibleCount = filterSet ? rows.filter((r) => filterSet.has(r.node.code)).length : rows.length

  /** 父域候选：排除自身与自身后代，避免成环 */
  const parentOptions = useMemo(() => {
    const excluded = new Set<string>()
    const mark = (n: BizTreeNode) => { excluded.add(n.code); (n.children ?? []).forEach(mark) }
    const find = (nodes: BizTreeNode[]): BizTreeNode | null => {
      for (const n of nodes) {
        if (n.code === draft?.code) return n
        const r = find(n.children ?? [])
        if (r) return r
      }
      return null
    }
    if (draft) {
      const self = find(roots)
      if (self) mark(self)
    }
    return rows.filter((r) => !excluded.has(r.node.code))
  }, [rows, roots, draft])

  const submit = async () => {
    if (!draft) return
    if (!draft.code.trim() || !draft.name.trim()) { toast('业务编码与业务名称为必填'); setStep(0); return }
    setSaving(true)
    try {
      const res = await saveBizDomain({ ...draft, code: draft.code.trim(), name: draft.name.trim() })
      setDraft(null)
      setSel(res.code)
      reload()
      toast(res.created ? `${res.code} 已创建` : `${res.code} 已更新`)
    } catch (e) {
      toast(`保存失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (d: BizDomain) => {
    try {
      await saveBizDomain({ ...d, enabled: !d.enabled } as BizDomain)
      reload()
      toast(`${d.name} 已${d.enabled ? '停用' : '启用'}`)
    } catch (e) {
      toast(`操作失败：${e instanceof Error ? e.message : e}`)
    }
  }

  const confirmDelete = async () => {
    if (pendingDelete?.id == null) { toast('该业务域缺少 id，无法删除'); setPendingDelete(null); return }
    setSaving(true)
    try {
      await deleteBizDomain(pendingDelete.id)
      toast(`${pendingDelete.name} 已删除`)
      setPendingDelete(null)
      if (pendingDelete.code === sel) setSel('')
      reload()
    } catch (e) {
      toast(`删除失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  const parentName = current?.parentCode
    ? allDomains.find((d) => d.code === current.parentCode)?.name ?? current.parentCode
    : null

  return (
    <div>
      <PageH
        title="业务域"
        desc="业务域是 Issue 分拣的第一依据。支持父子层级：命中子域时，未在子域配置的项自动继承父域。"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => { setDraft({ ...EMPTY, parentCode: current?.code ?? null }); setStep(0) }}>
            <Icon name="plus" size={15} />新增业务域
          </button>
        }
      />

      <div className="biz-stats">
        <span><b>{stats.roots}</b> 个一级业务域</span>
        <i />
        <span><b>{stats.total}</b> 个业务域</span>
        <i />
        <span><b>{stats.leaf}</b> 个细分落点</span>
        <i />
        <span><b>{stats.owners}</b> 个已配负责人</span>
        <i />
      </div>

      <div className="probe-fold">
        <button className="probe-head" onClick={() => setProbeOpen(!probeOpen)}>
          <Icon name="filter" size={15} />
          <b>分拣预演</b>
          <span>输入一条诉求的标题与描述，实时查看会分给谁、进哪个 Git</span>
          <Icon name="chevron" size={15} />
        </button>
        {probeOpen && (
          <div className="probe-body">
            <div className="probe-grid">
              <div>
                <div className="field" style={{ marginTop: 0 }}>
                  <label>诉求标题</label>
                  <input value={probeTitle} placeholder="如：行情快照导出支持分页"
                    onChange={(e) => setProbeTitle(e.target.value)} />
                </div>
                <div className="field" style={{ marginTop: 14 }}>
                  <label>描述（可选）</label>
                  <textarea rows={5} value={probeDesc}
                    placeholder="如：需要支持 offset/limit 分页导出，单次上限 5000 行"
                    onChange={(e) => setProbeDesc(e.target.value)} />
                </div>
                <div className="fhelp">按「人工指定 → 关键词命中 → 父子层级收敛 → LLM 歧义裁决」顺序判定，输入后约 0.4 秒自动触发。</div>
              </div>

              <div className={`probe-out ${probe ? 'filled' : ''}`}>
                {!probeTitle.trim() && (
                  <div className="probe-state">
                    <Icon name="filter" size={22} />
                    左侧输入诉求后，这里展示分拣结论：<br />分给哪个业务域、谁承接、进哪个仓库与分支。
                  </div>
                )}
                {probing && <div className="probe-state">判定中…</div>}
                {!probing && probe?.resolved && (
                  <div>
                    <div className="probe-card-head">
                      <span className="probe-bizname">{probe.bizName ?? '未命名业务域'}</span>
                      {probe.bizCode && <span className="probe-code">{probe.bizCode}</span>}
                      <Tag tone="ok" dot>{METHOD_LABEL[probe.method] ?? probe.method}</Tag>
                      {probe.inheritedFrom && <Tag tone="info">继承自 {probe.inheritedFrom}</Tag>}
                    </div>
                    <div className="probe-reason">{probe.reason}</div>
                    <div className="probe-meta">
                      <Meta label="承接人" value={probe.owner} />
                      <Meta label="默认优先级" value={probe.priority} mono />
                      <Meta label="项目" value={probe.project} mono />
                      <Meta label="工作分支" value={probe.branch} mono />
                      <Meta label="基线分支" value={probe.baselineBranch} mono />
                      <Meta label="执行客户端" value={probe.clientId} mono />
                      <Meta label="仓库" value={probe.repoUrl} mono />
                      <Meta label="安全约束"
                        value={probe.sensitiveRepo || probe.sensitiveLevel === '核心'
                          ? `${probe.sensitiveLevel}${probe.requiredBackend ? ` · 强制 ${probe.requiredBackend}` : ''}`
                          : probe.sensitiveLevel} />
                    </div>
                  </div>
                )}
                {!probing && probe && !probe.resolved && (
                  <div>
                    <div className="probe-card-head">
                      <Icon name="warn" size={16} />
                      <span className="probe-bizname" style={{ fontSize: 14 }}>进入人工分拣队列</span>
                      <Tag tone="warn">{METHOD_LABEL[probe.method] ?? probe.method}</Tag>
                    </div>
                    <div className="probe-reason">{probe.reason}</div>
                    {!!probe.candidates?.length && (
                      <div>
                        <div style={{ color: 'var(--ink-4)', fontSize: 12, marginBottom: 2 }}>候选业务域（命中关键词）</div>
                        {probe.candidates.map((c) => (
                          <div key={c.code} className="probe-cand">
                            <b>{c.name}</b>
                            <code>{c.code}</code>
                            {(c.matched ?? []).map((m) => <span key={m} className="kw">{m}</span>)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="biz-split">
        <div className="biz-tree pane">
          <div className="pane-h">
            <span>业务树</span>
            <span className="pane-sub">{tq.trim() ? `${visibleCount} / ${rows.length} 个节点` : `${rows.length} 个节点`}</span>
          </div>
          <div className="tree-search">
            <Search placeholder="搜索名称 / 编码 / 关键词" value={tq} onChange={setTq} />
          </div>
          <div className="tree-hint">右键节点：新增子域 / 编辑 / 停用 / 删除</div>
          <div className="pane-b">
            {loading && rows.length === 0 && <div className="pane-empty">加载中…</div>}
            {!loading && tree === null && <div className="pane-empty">接口请求失败，请确认后端已启动（:8080）</div>}
            {!loading && tree !== null && rows.length === 0 && <Empty text="还没有业务域，先新增一个" />}
            {!loading && tree !== null && rows.length > 0 && visibleCount === 0 && (
              <Empty text={`没有匹配「${tq.trim()}」的节点`} />
            )}
            {roots.map((root) => (
              <TreeNodeBranch
                key={root.code}
                node={root}
                depth={0}
                sel={sel}
                collapsed={collapsed}
                filterSet={filterSet}
                onSelect={setSel}
                onToggle={(code) => setCollapsed({ ...collapsed, [code]: !collapsed[code] })}
                onContext={(node, x, y) => setMenu({ x, y, node })}
              />
            ))}
          </div>
        </div>

        <div className="biz-detail pane">
          {!current ? (
            <div className="pane-b"><Empty text="从左侧选择业务域查看详情" /></div>
          ) : (
            <>
              <div className="pane-h">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <b style={{ fontSize: 14 }}>{current.name}</b>
                    {!current.enabled && <Tag tone="mut">停用</Tag>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-4)', fontFamily: 'var(--mono)', marginTop: 3 }}>
                    {parentName ? `${current.parentCode} / ` : ''}{current.code}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-xs btn-outline" onClick={() => toggleEnabled(current)}>
                    {current.enabled ? '停用' : '启用'}
                  </button>
                  <button className="btn btn-xs btn-outline" onClick={() => { setDraft({ ...current }); setStep(0) }}>
                    <Icon name="edit" size={13} />编辑
                  </button>
                  <button className="btn btn-xs btn-outline" onClick={() => setPendingDelete(current)}>
                    <Icon name="trash" size={13} />删除
                  </button>
                </div>
              </div>
              <div className="pane-b">
                <div className="grid g2" style={{ gap: 16 }}>
                  <Meta label="业务负责人" value={people(current.bizOwners).join('、') || undefined} />
                  <Meta label="开发负责人"
                    value={people(current.devOwners).length
                      ? people(current.devOwners).map((p, i) => (i === 0 ? `${p}（主责）` : p)).join('、')
                      : undefined} />
                  <Meta label="默认优先级" value={current.defaultPriority} mono />
                  <Meta label="响应时限" value={current.slaHours != null ? `${current.slaHours} 小时` : undefined} />
                  <Meta label="默认执行客户端" value={current.defaultClientId} mono />
                </div>

                <div className="detail-block">
                  <div className="detail-label">
                    仓库
                    {current.repoFrom
                      ? <Tag tone="info">继承自 {current.repoFrom}</Tag>
                      : current.repo ? <Tag tone="ok">自有</Tag> : <Tag tone="warn">未配置</Tag>}
                  </div>
                  {current.effectiveRepo ? (
                    <div style={{ fontSize: 12.5, lineHeight: 1.9 }}>
                      <div style={{ fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>
                        {current.effectiveRepo.repoUrl}
                      </div>
                      <div style={{ color: 'var(--ink-3)', marginTop: 4 }}>
                        {current.effectiveRepo.project} · 基线 {current.effectiveRepo.baselineBranch}
                        {' · 分支前缀 '}{current.effectiveRepo.branchPrefix}
                        {current.effectiveRepo.sensitive ? ' · 敏感仓库' : ''}
                        {current.effectiveRepo.requiredBackend ? ` · 强制 ${current.effectiveRepo.requiredBackend}` : ''}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                      自身与父级均未绑定仓库，下发前需补齐。
                    </div>
                  )}
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, color: 'var(--ink-4)', flex: 'none' }}>绑定仓库</span>
                    <RepoPicker repos={repoList} value={current.repoProject ?? ''}
                      onPick={(v) => bindRepo(current, v)} />
                  </div>
                </div>

                <div className="detail-block">
                  <div className="detail-label">命中关键词</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(current.keywords || '').split(/[,，、;；\s]+/).filter(Boolean).length > 0
                      ? (current.keywords || '').split(/[,，、;；\s]+/).filter(Boolean).map((k) => (
                        <span key={k} className="kw">{k}</span>
                      ))
                      : <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>未配置关键词，该业务域不会参与自动分拣</span>}
                  </div>
                </div>

                {current.children?.length > 0 && (
                  <div className="detail-block">
                    <div className="detail-label">子业务域</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {current.children.map((c) => (
                        <button key={c.code} className="kw clickable" onClick={() => setSel(c.code)}>{c.name}</button>
                      ))}
                    </div>
                  </div>
                )}

                {current.description && (
                  <div className="detail-block">
                    <div className="detail-label">说明</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.75 }}>{current.description}</div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {draft && (
        <Modal
          title={draft.id ? `编辑业务域 · ${draft.name}` : '新增业务域'}
          width={1180}
          height="90vh"
          onClose={() => setDraft(null)}
          footer={
            <>
              <button className="btn btn-sm" onClick={() => setDraft(null)}>取消</button>
              {step > 0 && <button className="btn btn-sm" onClick={() => setStep(step - 1)}>上一步</button>}
              {step < 2
                ? <button className="btn btn-primary btn-sm" onClick={() => setStep(step + 1)}>下一步</button>
                : <button className="btn btn-primary btn-sm" disabled={saving} onClick={submit}>
                    {saving ? '保存中…' : '保存'}
                  </button>}
            </>
          }
        >
          <Stepper
            steps={[
              { label: '基本信息', hint: '编码 · 名称 · 层级' },
              { label: '分拣与负责人', hint: '关键词 · 双负责人' },
              { label: '响应与执行', hint: '优先级 · SLA · 客户端' },
            ]}
            current={step}
            onSelect={setStep}
          />

          {step === 0 && (
            <>
              <Sect title="基本信息" first />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '0 16px' }}>
                <F label="业务编码" help="分拣与仓库关联的唯一键，创建后不建议修改">
                  <input value={draft.code} placeholder="如 quote-snapshot"
                    onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
                </F>
                <F label="业务名称">
                  <input value={draft.name} placeholder="如 行情·快照导出"
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </F>
              </div>

              <F label="父业务域" help="留空即为一级业务域；未配置项自动继承父域">
                <select value={draft.parentCode ?? ''} onChange={(e) => setDraft({ ...draft, parentCode: e.target.value || null })}>
                  <option value="">（一级业务域）</option>
                  {parentOptions.map(({ node, depth }) => (
                    <option key={node.code} value={node.code}>{'　'.repeat(depth)}{node.name}（{node.code}）</option>
                  ))}
                </select>
              </F>

              <F label="说明">
                <textarea rows={2} value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </F>
            </>
          )}

          {step === 1 && (
            <>
              <Sect title="分拣规则" first />
              <F label="命中关键词" help="逗号分隔；分拣时与标题 + 描述做包含匹配">
                <textarea rows={2} value={draft.keywords} placeholder="快照,snapshot,导出,分页"
                  onChange={(e) => setDraft({ ...draft, keywords: e.target.value })} />
              </F>

              <Sect title="负责人" hint="搜索姓名后回车添加，点击已选胶囊移除；序号即优先级，留空继承父域" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <F label="业务负责人" help="需求提出 / 验收侧；候选来自「用户管理」花名册">
                  <OwnerPicker pool={userPool} value={draft.bizOwners}
                    onChange={(v) => setDraft({ ...draft, bizOwners: v })} />
                </F>
                <F label="开发负责人" help="承接 / 执行侧；第 1 人为默认承接人">
                  <OwnerPicker pool={userPool} value={draft.devOwners}
                    onChange={(v) => setDraft({ ...draft, devOwners: v })} />
                </F>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <Sect title="响应与执行" first hint="低频配置" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' }}>
                <F label="默认优先级">
                  <select value={draft.defaultPriority} onChange={(e) => setDraft({ ...draft, defaultPriority: e.target.value })}>
                    <option>P0</option><option>P1</option><option>P2</option>
                  </select>
                </F>
                <F label="响应时限" help="单位：小时，用于超期告警">
                  <input type="number" min={1} value={draft.slaHours ?? ''}
                    onChange={(e) => setDraft({ ...draft, slaHours: e.target.value ? Number(e.target.value) : undefined })} />
                </F>
              </div>

              <F label="绑定仓库" help="本域专属落点，一个仓库可服务多个业务域；留空则沿父链继承。也可在业务树详情区直接改">
                <RepoPicker repos={repoList} value={draft.repoProject ?? ''}
                  onPick={(v) => setDraft({ ...draft, repoProject: v })} />
              </F>

              <F label="默认执行客户端" help="留空 = 按开发负责人绑定的客户端派发；候选为当前已注册客户端">
                {clientIds.length > 0 ? (
                  <select value={draft.defaultClientId ?? ''}
                    onChange={(e) => setDraft({ ...draft, defaultClientId: e.target.value || undefined })}>
                    <option value="">（不指定，按负责人派发）</option>
                    {clientIds.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : (
                  <input value={draft.defaultClientId ?? ''} placeholder="如 dev-windows-07"
                    onChange={(e) => setDraft({ ...draft, defaultClientId: e.target.value })} />
                )}
              </F>

              <div className="fhelp" style={{ marginTop: 12 }}>
                工作流模板无需在此选择：Issue 为「需求」走需求工作流、「缺陷」走缺陷工作流，由诉求类型自动决定。
              </div>
            </>
          )}
        </Modal>
      )}

      {menu && (
        <div className="ctxmenu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="ctx-title">{menu.node.name}（{menu.node.code}）</div>
          <button onClick={() => { setDraft({ ...EMPTY, parentCode: menu.node.code }); setStep(0); setMenu(null) }}>
            <Icon name="plus" size={14} />新增子业务域
          </button>
          <button onClick={() => { setDraft({ ...menu.node }); setStep(0); setMenu(null) }}>
            <Icon name="edit" size={14} />编辑
          </button>
          <button onClick={() => { toggleEnabled(menu.node); setMenu(null) }}>
            <Icon name="settings" size={14} />{menu.node.enabled ? '停用' : '启用'}
          </button>
          <div className="ctx-sep" />
          <button className="danger" onClick={() => { setPendingDelete(menu.node); setMenu(null) }}>
            <Icon name="trash" size={14} />删除
          </button>
        </div>
      )}

      {pendingDelete && (
        <Modal
          title="删除业务域"
          width={460}
          onClose={() => setPendingDelete(null)}
          footer={
            <>
              <button className="btn btn-sm" onClick={() => setPendingDelete(null)}>取消</button>
              <button className="btn btn-primary btn-sm" disabled={saving} onClick={confirmDelete}>
                {saving ? '处理中…' : '确认删除'}
              </button>
            </>
          }
        >
          <div style={{ fontSize: 13.5, lineHeight: 1.8 }}>
            即将删除业务域 <strong>{pendingDelete.name}</strong>（编码 {pendingDelete.code}）。
            <div style={{ color: 'var(--ink-3)', marginTop: 8 }}>
              若该业务域下仍有子业务域或被 Issue 引用，删除会被拒绝——这样历史 Issue 的分拣依据不会丢失；
              仓库绑定会随删除自动解绑。只想暂停分拣命中，请改用「停用」。
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

/** 递归渲染一个分支；折叠状态由父级统一持有；filterSet 非空时只渲染命中（含祖先）且强制展开 */
function TreeNodeBranch({
  node, depth, sel, collapsed, filterSet, onSelect, onToggle, onContext,
}: {
  node: BizTreeNode; depth: number; sel: string
  collapsed: Record<string, boolean>
  filterSet: Set<string> | null
  onSelect: (code: string) => void
  onToggle: (code: string) => void
  onContext: (node: BizTreeNode, x: number, y: number) => void
}) {
  if (filterSet && !filterSet.has(node.code)) return null
  const hasKids = (node.children?.length ?? 0) > 0
  const isCollapsed = !filterSet && !!collapsed[node.code]
  return (
    <>
      <TreeRow
        row={{ node, depth }}
        selected={sel === node.code}
        expanded={!isCollapsed}
        onSelect={() => onSelect(node.code)}
        onToggle={() => onToggle(node.code)}
        onContext={onContext}
      />
      {hasKids && !isCollapsed && node.children.map((c) => (
        <TreeNodeBranch key={c.code} node={c} depth={depth + 1} sel={sel}
          collapsed={collapsed} filterSet={filterSet} onSelect={onSelect} onToggle={onToggle} onContext={onContext} />
      ))}
    </>
  )
}
