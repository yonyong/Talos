import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../icons'
import { Search } from '../ui'
import type { BizTreeNode } from '../types'

/** 把业务树拍平成节点列表，供统计与反查复用 */
export function flatBiz(nodes: BizTreeNode[], out: BizTreeNode[] = []): BizTreeNode[] {
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
/** 展示用：最多 2 人，超出折叠为 +N */
function shortOwners(s?: string): string {
  const a = ownerList(s)
  return a.length ? `${a.slice(0, 2).join('、')}${a.length > 2 ? ` +${a.length - 2}` : ''}` : ''
}

/**
 * 业务域树形多选：下拉面板按父子层级缩进展示，支持检索（命中保留祖先链）、
 * 逐层折叠与勾选；被其他资源占用的业务域可置灰不可选并标注占用方。
 * 已选项以胶囊形式回显在输入框内，点击胶囊 x 即移除。
 *
 * 复用于仓库与用户两处，保证业务域选择交互一致。
 */
export function BizTreeSelect({ tree, value, onChange, boundElsewhere }: {
  tree: BizTreeNode[]
  value: string[]
  onChange: (codes: string[]) => void
  /** 被其他资源占用、不可选的业务域编码 -> 占用方说明 */
  boundElsewhere?: Record<string, string>
}) {
  const be = boundElsewhere ?? {}
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', esc) }
  }, [open])

  /** 检索：命中名称 / 编码的节点保留，并带上全部祖先链 */
  const filterSet = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return null
    const hit = new Set<string>()
    const walk = (n: BizTreeNode, ancestors: string[]): boolean => {
      const self = n.name.toLowerCase().includes(kw) || n.code.toLowerCase().includes(kw)
      let childHit = false
      for (const c of n.children ?? []) childHit = walk(c, [...ancestors, n.code]) || childHit
      if (self || childHit) { hit.add(n.code); ancestors.forEach((a) => hit.add(a)); return true }
      return false
    }
    tree.forEach((r) => walk(r, []))
    return hit
  }, [tree, q])

  const toggle = (code: string) => {
    if (be[code]) return
    onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code])
  }

  const nameOf = (code: string) =>
    flatBiz(tree).find((b) => b.code === code)?.name ?? code

  const rows: ReactNode[] = []
  const renderNodes = (nodes: BizTreeNode[], depth: number) => {
    for (const n of nodes) {
      if (filterSet && !filterSet.has(n.code)) continue
      const hasKids = (n.children?.length ?? 0) > 0
      const isCollapsed = collapsed[n.code]
      const disabled = !!be[n.code]
      const checked = value.includes(n.code)
      rows.push(
        <div
          key={n.code}
          onClick={() => toggle(n.code)}
          title={disabled ? `已绑定仓库 ${be[n.code]}（一个业务域只对应一个仓库）` : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px',
            paddingLeft: 10 + depth * 18, borderRadius: 6, fontSize: 12.5, cursor: disabled ? 'not-allowed' : 'pointer',
            background: checked ? 'rgba(15,118,110,.08)' : 'transparent', opacity: disabled ? 0.55 : 1,
          }}
          onMouseEnter={(e) => { if (!disabled && !checked) e.currentTarget.style.background = 'var(--hover, rgba(0,0,0,.04))' }}
          onMouseLeave={(e) => { if (!checked) e.currentTarget.style.background = 'transparent' }}
        >
          {hasKids ? (
            <button
              onClick={(e) => { e.stopPropagation(); setCollapsed({ ...collapsed, [n.code]: !collapsed[n.code] }) }}
              style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', flex: 'none', color: 'var(--ink-4)' }}
            >
              <span style={{ display: 'inline-flex', transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }}>
                <Icon name="chevron" size={12} />
              </span>
            </button>
          ) : (
            <span style={{ width: 12, flex: 'none' }} />
          )}
          <span style={{
            width: 14, height: 14, borderRadius: 4, flex: 'none', display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 10, lineHeight: 1, color: '#fff',
            border: checked ? '1px solid #0f766e' : '1px solid var(--line, #ddd)',
            background: checked ? '#0f766e' : 'transparent',
          }}>{checked ? '✓' : ''}</span>
          <span style={{ fontWeight: 550, flex: 'none' }}>{n.name}</span>
          <span style={{ color: 'var(--ink-4)', fontFamily: 'var(--mono)', fontSize: 11, flex: 'none', marginLeft: 6 }}>{n.code}</span>
          {!n.enabled && <span style={{ fontSize: 10.5, color: 'var(--ink-4)', flex: 'none', marginLeft: 2 }}>停用</span>}
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 9, fontSize: 11, color: 'var(--ink-4)', minWidth: 0 }}>
            <span title={n.bizOwners || '未配置'} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>业务 {shortOwners(n.bizOwners) || '—'}</span>
            <span title={n.devOwners || '未配置'} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>开发 {shortOwners(n.devOwners) || '—'}</span>
            {disabled && (
              <span style={{ flex: 'none', fontFamily: 'var(--mono)' }}>→ {be[n.code]}</span>
            )}
          </span>
        </div>,
      )
      if (hasKids && !isCollapsed) renderNodes(n.children ?? [], depth + 1)
    }
  }
  renderNodes(tree, 0)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          border: '1px solid var(--line, #ddd)', borderRadius: 8, minHeight: 36, padding: '4px 8px',
          display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', cursor: 'pointer', background: 'var(--bg, #fff)',
        }}
      >
        {value.length === 0 && (
          <span style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>点击选择业务域（可多选）</span>
        )}
        {value.map((c) => (
          <span key={c} className="kw clickable on" title="点击移除"
            onClick={(e) => { e.stopPropagation(); toggle(c) }}>
            {nameOf(c)}
            <span style={{ color: 'var(--ink-4)', fontFamily: 'var(--mono)', fontSize: 10.5 }}>{c}</span>
            <Icon name="x" size={11} />
          </span>
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--ink-4)', display: 'inline-flex', flex: 'none', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <Icon name="chevron" size={14} />
        </span>
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 30,
          border: '1px solid var(--line, #ddd)', borderRadius: 10, background: 'var(--bg, #fff)',
          boxShadow: '0 12px 32px rgba(0,0,0,.12)', maxHeight: 320, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '8px 10px 4px' }}>
            <Search placeholder="搜索业务域" value={q} onChange={setQ} />
          </div>
          <div style={{ overflowY: 'auto', padding: '4px 6px 8px' }}>
            {rows.length === 0
              ? <div style={{ padding: '12px 10px', fontSize: 12.5, color: 'var(--ink-4)' }}>没有匹配的业务域</div>
              : rows}
          </div>
        </div>
      )}
    </div>
  )
}
