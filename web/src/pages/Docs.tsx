import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../icons'
import { Kpi, PageH, Pager, Search, Tag } from '../ui'
import { DocPreview } from '../attach'
import { fetchDocs, fetchIssues, useAsync } from '../api'
import type { DocItem, Issue, PageFocus, PageKey } from '../types'

/* 分类顺序：过程文档按研发阶段归好类，原始材料置底 */
const CAT_LABEL: Record<string, string> = {
  概要: '需求概要',
  详设: '详细设计',
  故障报告: '故障报告',
  修复方案: '修复方案',
  测试报告: '测试报告',
  raw: '原始材料',
  过程文档: '过程文档',
}
const CAT_PRIORITY = ['概要', '详设', '故障报告', '修复方案', '测试报告', 'raw']
/** 过程文档按 kind 归类；原始材料统一归到 raw */
function catKeyOf(d: DocItem): string {
  return d.category === 'RAW' ? 'raw' : (d.kind?.trim() || '过程文档')
}
function sortCats(keys: string[]): string[] {
  return keys.slice().sort((a, b) => {
    const wa = CAT_PRIORITY.indexOf(a)
    const wb = CAT_PRIORITY.indexOf(b)
    const x = wa === -1 ? 99 : wa
    const y = wb === -1 ? 99 : wb
    if (x !== y) return x - y
    return a.localeCompare(b)
  })
}
/** 按分类分组（纯函数，可在 memo 内调用，避免 hook-in-loop） */
function groupCats(list: DocItem[]): { key: string; label: string; docs: DocItem[] }[] {
  const m = new Map<string, DocItem[]>()
  for (const d of list) {
    const k = catKeyOf(d)
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(d)
  }
  return sortCats([...m.keys()]).map((k) => ({ key: k, label: CAT_LABEL[k] || k, docs: m.get(k)! }))
}
/** 文档所属项目：优先取 Issue 分拣结果的项目名，回退业务域，最后未归类 */
function projectOf(issue: Issue | undefined): string {
  return (issue?.project?.trim()) || (issue?.biz?.trim()) || '未归类'
}

type ProjectGroup = {
  name: string
  docs: DocItem[]
  total: number
  process: number
  raw: number
  issueCount: number
  last: string
  issueOptions: { code: string; title: string }[]
}

export default function Docs({ nav }: { nav: (p: PageKey, f?: PageFocus) => void }) {
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [issueFilter, setIssueFilter] = useState<string>('all')
  const [open, setOpen] = useState<DocItem | null>(null)
  const [projPage, setProjPage] = useState(1)
  const [filePage, setFilePage] = useState(1)

  const PROJ_PAGE = 12
  const FILE_PAGE = 20

  const { data: docs, loading } = useAsync<DocItem[]>(() => fetchDocs({}), [])
  const { data: issues } = useAsync<Issue[]>(() => fetchIssues(), [])

  const issueByCode = useMemo(() => {
    const m = new Map<string, Issue>()
    ;(issues ?? []).forEach((i) => m.set(i.id, i))
    return m
  }, [issues])

  const allDocs = docs ?? []
  const ql = q.trim().toLowerCase()

  /** 全局搜索：命中文档名 / Issue 编号 / Issue 标题 / 来源 */
  const filteredDocs = useMemo(() => {
    if (!ql) return allDocs
    return allDocs.filter((d) => {
      const iss = issueByCode.get(d.issue)
      const hay = [d.name, d.issue, iss?.title, d.kind, d.from].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(ql)
    })
  }, [allDocs, ql, issueByCode])

  /** 按项目维度聚合（列表式，非卡片） */
  const projects = useMemo<ProjectGroup[]>(() => {
    const m = new Map<string, DocItem[]>()
    for (const d of filteredDocs) {
      const pk = projectOf(issueByCode.get(d.issue))
      if (!m.has(pk)) m.set(pk, [])
      m.get(pk)!.push(d)
    }
    const arr = [...m.entries()].map(([name, list]) => {
      const process = list.filter((d) => d.category !== 'RAW').length
      const seen = new Map<string, string>()
      list.forEach((d) => {
        if (!seen.has(d.issue)) seen.set(d.issue, issueByCode.get(d.issue)?.title?.trim() || d.issue)
      })
      const issueOptions = [...seen.entries()]
        .map(([code, title]) => ({ code, title }))
        .sort((a, b) => a.code.localeCompare(b.code))
      const last = list.reduce((mx, d) => (d.time > mx ? d.time : mx), '')
      return {
        name,
        docs: list,
        total: list.length,
        process,
        raw: list.length - process,
        issueCount: seen.size,
        last,
        issueOptions,
      }
    })
    arr.sort((a, b) => (a.name === '未归类' ? 1 : b.name === '未归类' ? -1 : b.total - a.total))
    return arr
  }, [filteredDocs, issueByCode])

  const current = selected ? projects.find((p) => p.name === selected) ?? null : null

  /** 当前项目内，按 Issue 筛选后的全部文件 */
  const currentDocs = useMemo(() => {
    if (!current) return []
    return issueFilter === 'all' ? current.docs : current.docs.filter((d) => d.issue === issueFilter)
  }, [current, issueFilter])

  // 筛选 / 搜索 / 切换项目时回到第一页
  useEffect(() => { setProjPage(1) }, [ql])
  useEffect(() => { setFilePage(1) }, [selected, issueFilter])

  const projTotalPages = Math.max(1, Math.ceil(projects.length / PROJ_PAGE))
  const projPageItems = projects.slice((projPage - 1) * PROJ_PAGE, projPage * PROJ_PAGE)

  const fileTotalPages = Math.max(1, Math.ceil(currentDocs.length / FILE_PAGE))
  const filePageItems = currentDocs.slice((filePage - 1) * FILE_PAGE, filePage * FILE_PAGE)
  // 当前页内按分类分组（分页内重新归类，跨页的分类会重新出现小标题）
  const currentCats = useMemo(() => groupCats(filePageItems), [filePageItems])

  const projectsCount = projects.length
  const lastOverall = allDocs.reduce((mx, d) => (d.time > mx ? d.time : mx), '') || '—'

  const selectProject = (name: string) => {
    setSelected(name)
    setIssueFilter('all')
  }

  return (
    <div>
      <PageH
        title="过程文档"
        desc="按项目维度归档：点项目看归好类的文件列表，支持按 Issue 筛选，每个文件可直达对应 Issue。"
        actions={
          <a className="btn btn-outline btn-sm" href="#/docs">
            <Icon name="doc" size={13} />产品文档
          </a>
        }
      />

      <div style={{ marginBottom: 16, maxWidth: 360 }}>
        <Search placeholder="搜索文档名 / Issue 编号 / 标题…" value={q} onChange={setQ} />
      </div>

      <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', marginBottom: 20 }}>
        <Kpi icon="doc" label="文档总数" value={String(allDocs.length)} delta="服务端归档" dir="up" />
        <Kpi icon="layers" label="项目数" value={String(projectsCount)} delta="按项目维度" dir="flat" color="#0891b2" />
        <Kpi icon="issue" label="关联 Issue" value={String(new Set(allDocs.map((d) => d.issue)).size)} delta="可追溯来源" dir="flat" color="#4f46e5" />
        <Kpi icon="clock" label="最近回传" value={lastOverall} delta="客户端经 gRPC 回传" dir="flat" color="#16a34a" />
      </div>

      {loading && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>}
      {!loading && docs === null && (
        <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>接口请求失败，请确认后端已启动（:8080）</div>
      )}

      {!loading && docs !== null && allDocs.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 24, textAlign: 'center' }}>
          暂无文档（客户端执行工作流后回传）
        </div>
      )}

      {/* ===== 项目列表（行，非卡片，分页） ===== */}
      {!loading && docs !== null && allDocs.length > 0 && !current && (
        <div>
          <div className="projlist">
            {projPageItems.map((p) => (
              <button key={p.name} className="projrow" onClick={() => selectProject(p.name)}>
                <span className="dicon sm"><Icon name="layers" size={16} /></span>
                <span style={{ minWidth: 0 }}>
                  <b className="pname">{p.name}</b>
                  <span className="pmeta">{p.issueCount} 个 Issue · 最近 {p.last || '—'}</span>
                </span>
                <span className="pstats">
                  <span><b>{p.total}</b>文档</span>
                  <span><b>{p.process}</b>过程</span>
                  <span><b>{p.raw}</b>原始</span>
                </span>
                <span className="pchev"><Icon name="arrow" size={15} /></span>
              </button>
            ))}
          </div>
          {projTotalPages > 1 && (
            <Pager page={projPage} totalPages={projTotalPages} total={projects.length} onChange={setProjPage} />
          )}
        </div>
      )}

      {/* ===== 单项目：文件列表（行，非卡片）+ Issue 筛选 ===== */}
      {!loading && docs !== null && current && (
        <div>
          <button className="doc-back" onClick={() => setSelected(null)}>
            <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><Icon name="arrow" size={14} /></span>
            全部项目
          </button>
          <div className="doc-crumb">
            项目 <b>{current.name}</b> · 共 {current.total} 份文档（过程 {current.process} · 原始 {current.raw}）· 关联 {current.issueCount} 个 Issue
          </div>

          <div className="doc-toolbar">
            <select
              className="filter-sel"
              value={issueFilter}
              onChange={(e) => setIssueFilter(e.target.value)}
            >
              <option value="all">全部 Issue（{current.issueCount}）</option>
              {current.issueOptions.map((o) => (
                <option key={o.code} value={o.code}>{o.code} · {o.title}</option>
              ))}
            </select>
            <span style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>
              筛选后 {currentDocs.length} 份{fileTotalPages > 1 ? ` · 第 ${filePage}/${fileTotalPages} 页` : ''}
            </span>
          </div>

          {currentDocs.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: '18px 4px' }}>
              该 Issue 下暂无文档
            </div>
          )}

          {currentCats.map((cat) => (
            <section key={cat.key}>
              <div className="cat-h">
                <h3>{cat.label}</h3>
                <span>{cat.docs.length}</span>
              </div>
              <div className="filelist">
                {cat.docs.map((d, i) => {
                  const iss = issueByCode.get(d.issue)
                  return (
                    <div key={d.id ?? i} className="filerow" onClick={() => setOpen(d)}>
                      <span className="dicon sm"><Icon name="doc" size={16} /></span>
                      <span className="fname" title={d.name}>{d.name}</span>
                      <Tag tone="mut">{CAT_LABEL[catKeyOf(d)] || catKeyOf(d)}</Tag>
                      <button
                        className="issuelink"
                        title={iss?.title ? `${d.issue} · ${iss.title}` : d.issue}
                        onClick={(e) => { e.stopPropagation(); nav('issues', { issueCode: d.issue, at: Date.now() }) }}
                      >
                        <Icon name="issue" size={12} />
                        <span className="it">{d.issue}{iss?.title ? ` · ${iss.title}` : ''}</span>
                      </button>
                      <span className="fmta">{d.time} · {d.size}</span>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
          {fileTotalPages > 1 && (
            <Pager page={filePage} totalPages={fileTotalPages} total={currentDocs.length} onChange={setFilePage} />
          )}
        </div>
      )}

      {open && <DocPreview doc={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
