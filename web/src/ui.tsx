import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons'

/* ============ Toast ============ */
type ToastCtx = { toast: (msg: string) => void }
const ToastContext = createContext<ToastCtx>({ toast: () => {} })
export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState('')
  const [show, setShow] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const toast = useCallback((m: string) => {
    setMsg(m)
    setShow(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setShow(false), 2600)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className={`toast ${show ? 'show' : ''}`}>
        <Icon name="check" size={16} />
        <span>{msg}</span>
      </div>
    </ToastContext.Provider>
  )
}

/* ============ Card / Panel ============ */
export function Card({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={`card card-pad ${className}`} style={style}>{children}</div>
}

export function Panel({
  title, sub, actions, children, flush,
}: { title: string; sub?: string; actions?: React.ReactNode; children: React.ReactNode; flush?: boolean }) {
  return (
    <div className="panel">
      <div className="panel-h">
        <div>
          <h3>{title}</h3>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {actions}
      </div>
      <div className={`panel-b ${flush ? 'flush' : ''}`}>{children}</div>
    </div>
  )
}

/* ============ KPI ============ */
export function Sparkline({ points, color = '#4f46e5', id }: { points: number[]; color?: string; id: string }) {
  const w = 100, h = 30
  const max = Math.max(...points), min = Math.min(...points)
  const span = max - min || 1
  const coords = points.map((p, i) => [(i / (points.length - 1)) * w, h - ((p - min) / span) * (h - 4) - 2])
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0].toFixed(1)} ${c[1].toFixed(1)}`).join(' ')
  const area = `${line} L${w} ${h} L0 ${h} Z`
  return (
    <svg className="kspark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 34, display: 'block' }}>
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor={color} stopOpacity="0.18" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function Kpi({
  icon, label, value, delta, dir = 'flat', series, color = '#4f46e5', onClick, hint,
}: {
  icon: string; label: string; value: string; delta?: string; dir?: 'up' | 'down' | 'flat'
  series?: number[]; color?: string
  /** 兼容旧调用方（视觉已收敛到主题变量，传入不生效） */
  glow?: string
  /** 传入后卡片可点击下钻，鼠标悬停显示 hint */
  onClick?: () => void; hint?: string
}) {
  const id = label.replace(/\W/g, '')
  return (
    <div
      className={`card card-pad kpi ${onClick ? 'clickable' : ''}`}
      onClick={onClick}
      title={hint}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
    >
      <div className="kpi-in">
        <div className="kl"><Icon name={icon} size={15} />{label}</div>
        <div className="kv">{value}</div>
        {delta && <div className={`kd ${dir}`}>{dir === 'up' ? '↑' : dir === 'down' ? '↓' : ''}{delta}</div>}
        {series && <Sparkline points={series} color={color} id={id} />}
      </div>
      {onClick && <span className="kpi-go"><Icon name="arrow" size={14} /></span>}
    </div>
  )
}

/* ============ Pager ============ */
/** 通用分页条：上一页 / 页码信息 / 下一页；仅 totalPages > 1 时由调用方渲染 */
export function Pager({ page, totalPages, total, onChange }: {
  page: number
  totalPages: number
  total: number
  onChange: (p: number) => void
}) {
  return (
    <div className="pager">
      <button className="pager-btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <Icon name="arrowLeft" size={14} />上一页
      </button>
      <span className="pager-info">第 {page} / {totalPages} 页 · 共 {total} 条</span>
      <button className="pager-btn" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        下一页<Icon name="arrow" size={14} />
      </button>
    </div>
  )
}

/* ============ Ring ============ */
export function Ring({
  pct, label, title, desc, color = '#4f46e5', size = 92,
}: { pct: number; label?: string; title?: React.ReactNode; desc?: React.ReactNode; color?: string; size?: number }) {
  const r = size / 2 - 7
  const c = 2 * Math.PI * r
  const off = c * (1 - pct / 100)
  return (
    <div className="ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="7" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x="50%" y="50%" textAnchor="middle" dy="0.36em" fontSize={size * 0.2} fontWeight="650" fill="var(--ink)">
          {label ?? `${pct}%`}
        </text>
      </svg>
      {(title || desc) && (
        <div>
          {title && <div className="rt">{title}</div>}
          {desc && <div className="rs">{desc}</div>}
        </div>
      )}
    </div>
  )
}

/* ============ Tag ============ */
export function Tag({ tone = 'mut', dot = false, children }: { tone?: 'ok' | 'warn' | 'err' | 'info' | 'prog' | 'mut'; dot?: boolean; children: React.ReactNode }) {
  return (
    <span className={`tag t-${tone}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  )
}

/* ============ Controls ============ */
export function Search({ placeholder, value, onChange }: { placeholder: string; value?: string; onChange?: (v: string) => void }) {
  return (
    <div className="search">
      <Icon name="search" size={15} />
      <input placeholder={placeholder} value={value} onChange={(e) => onChange?.(e.target.value)} />
    </div>
  )
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)}>{o.l}</button>
      ))}
    </div>
  )
}

/**
 * 页面级分页签：把同一路由下的多个「重点」拆开，一屏只强调一个。
 * 与 Seg 的区别：Seg 是同一块内容内的筛选/切换，Tabs 是整页主题的切换（下带 1px 基线）。
 */
export function Tabs<T extends string>({ value, items, onChange }: {
  value: T
  items: { v: T; l: string; n?: number; tone?: 'warn' | 'err'; hint?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="tabs">
      {items.map((i) => (
        <button
          key={i.v}
          type="button"
          title={i.hint}
          className={value === i.v ? 'on' : ''}
          onClick={() => onChange(i.v)}
        >
          {i.l}
          {i.n !== undefined && i.n > 0 && <span className={`tcnt ${i.tone ?? ''}`}>{i.n}</span>}
        </button>
      ))}
    </div>
  )
}

export function Chips<T extends string>({ value, items, onChange }: { value: T; items: { v: T; l: string; n?: number }[]; onChange: (v: T) => void }) {
  return (
    <div className="chips">
      {items.map((i) => (
        <button key={i.v} className={`chip ${value === i.v ? 'on' : ''}`} onClick={() => onChange(i.v)}>
          {i.l}{i.n !== undefined && <span className="cnt">{i.n}</span>}
        </button>
      ))}
    </div>
  )
}

/* ============ Dropdown（自绘下拉，替代原生 select 的浏览器默认外观） ============ */
export function Dropdown<T extends string>({ value, options, onChange, width, style, disabled, placeholder }: {
  value: T
  options: { v: T; l: string; i?: React.ReactNode }[]
  onChange: (v: T) => void
  /** 宽度（数字 px 或 '100%' 等字符串） */
  width?: number | string
  style?: React.CSSProperties
  disabled?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])
  const cur = options.find((o) => o.v === value)
  return (
    <div className={`dd ${open ? 'open' : ''}`} ref={ref}
      style={width != null ? { width, ...style } : style}>
      <button type="button" className={`dd-btn ${open ? 'on' : ''}`} disabled={disabled} onClick={() => setOpen(!open)}>
        {cur?.i}
        <span className="dd-l">{cur?.l ?? placeholder ?? '请选择'}</span>
        <Icon name="chevron" size={13} />
      </button>
      {open && (
        <div className="dd-menu">
          {options.map((o) => (
            <button key={o.v} type="button" className={`dd-i ${o.v === value ? 'on' : ''}`}
              onClick={() => { onChange(o.v); setOpen(false) }}>
              {o.i}
              <span className="dd-i-l">{o.l}</span>
              {o.v === value && <Icon name="check" size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 人员单选器：自绘下拉（与 Dropdown 同视觉体系）+ 搜索 + 手输兜底。
 * 触发按钮显示圆形首字母头像与姓名，展开后顶部搜索，候选按关键词过滤；
 * 无精确匹配时可直接选用手输值（代他人录入 / 名单外人员）。
 */
export function PersonSelect({ value, options, onChange, placeholder, width }: {
  value: string
  options: { name: string; sub?: string }[]
  onChange: (v: string) => void
  placeholder?: string
  width?: number | string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])

  const kw = q.trim()
  const klc = kw.toLowerCase()
  const hits = useMemo(
    () => options.filter((o) => o.name.toLowerCase().includes(klc)).slice(0, 8),
    [options, klc],
  )
  /** 手输值：与现有候选不精确同名时，作为「自定义」项置顶 */
  const custom = kw && !options.some((o) => o.name.toLowerCase() === klc) ? kw : ''

  const pick = (name: string) => { onChange(name); setQ(''); setOpen(false) }

  return (
    <div className={`dd ${open ? 'open' : ''}`} ref={ref} style={{ width: width ?? '100%' }}>
      <button
        type="button"
        className={`dd-btn ${open ? 'on' : ''}`}
        onClick={() => { setOpen(!open); setQ('') }}
      >
        {value
          ? <span className="pa">{initials(value)}</span>
          : <span className="pa muted"><Icon name="users" size={12} /></span>}
        <span className="dd-l">{value || placeholder || '请选择'}</span>
        <Icon name="chevron" size={13} />
      </button>
      {open && (
        <div className="dd-menu pick">
          <div className="dd-search">
            <Icon name="search" size={13} />
            <input
              autoFocus
              value={q}
              placeholder="搜索姓名或邮箱"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false)
                if (e.key === 'Enter') { e.preventDefault(); pick(custom || hits[0]?.name || kw) }
              }}
            />
          </div>
          <div className="dd-opts">
            {custom && (
              <button type="button" className="dd-i person" onMouseDown={(e) => { e.preventDefault(); pick(custom) }}>
                <span className="pa">{initials(custom)}</span>
                <span className="pn">{custom}</span>
                <span className="ps">手输</span>
              </button>
            )}
            {hits.map((o) => (
              <button
                type="button" key={o.name}
                className={`dd-i person ${o.name === value ? 'on' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); pick(o.name) }}
              >
                <span className="pa">{initials(o.name)}</span>
                <span className="pn">{o.name}</span>
                {o.sub && <span className="ps">{o.sub}</span>}
                {o.name === value && <Icon name="check" size={13} />}
              </button>
            ))}
            {!custom && hits.length === 0 && <div className="dd-empty">无匹配人员，可直接回车使用手输值</div>}
          </div>
        </div>
      )}
    </div>
  )
}

/** 姓名首字母（中文取前两字，英文取首字母） */
function initials(name: string): string {
  const s = (name || '?').trim()
  return /^[A-Za-z]/.test(s) ? s.slice(0, 2).toUpperCase() : s.slice(0, 2).toUpperCase()
}

export function Switch({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return <div className={`switch ${on ? 'on' : ''}`} onClick={onClick} />
}

export function Progress({ pct, tone }: { pct: number; tone?: 'warn' | 'err' }) {
  return <div className={`pbar ${tone ?? ''}`} style={{ marginTop: 8 }}><i style={{ width: `${pct}%` }} /></div>
}

/* ============ Stepper（分步表单） ============ */
export function Stepper({
  steps, current, onSelect,
}: { steps: { label: string; hint?: string }[]; current: number; onSelect: (i: number) => void }) {
  return (
    <div className="stepper">
      {steps.map((s, i) => (
        <button
          key={s.label} type="button"
          className={`step ${i === current ? 'on' : ''} ${i < current ? 'done' : ''}`}
          onClick={() => onSelect(i)}
        >
          <span className="step-dot">{i < current ? <Icon name="check" size={11} /> : i + 1}</span>
          <span className="step-txt">
            <b>{s.label}</b>
            {s.hint && <i>{s.hint}</i>}
          </span>
        </button>
      ))}
    </div>
  )
}

/* ============ Modal ============ */
/** 打开中的 Modal 栈：嵌套弹框（如设置面板里再开配置弹框）时 Esc 只关最上层 */
const modalStack: symbol[] = []

export function Modal({
  title, onClose, children, footer, width, height, size,
}: {
  title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode
  /** 显式宽度上限（默认 620px）；size="full" 时忽略 */
  width?: number
  /** 显式高度（数字 px 或 '90vh' 等字符串）；不传则按内容自适应（上限 86vh） */
  height?: number | string
  /** 'full' = 近乎铺满视口的详情大窗（95vw × 94vh，上限 1600px） */
  size?: 'full'
}) {
  const id = useMemo(() => Symbol('modal'), [])
  useEffect(() => {
    modalStack.push(id)
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) onClose() }
    window.addEventListener('keydown', h)
    return () => {
      const i = modalStack.indexOf(id)
      if (i >= 0) modalStack.splice(i, 1)
      window.removeEventListener('keydown', h)
    }
  }, [onClose, id])
  const full = size === 'full'
  return (
    <div className={`mask ${full ? 'mask-full' : ''}`} onClick={onClose}>
      <div
        className={`modal ${full ? 'full' : ''}`}
        style={!full && (width || height)
          ? { maxWidth: width, height, maxHeight: height ? '94vh' : undefined }
          : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-h">
          <h3>{title}</h3>
          <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  )
}

/* ============ Drawer（右侧滑出面板） ============ */
/**
 * 从视口右侧滑入的全高面板：适合就地查看长内容（节点执行日志等），
 * 不像模态框那样遮死上下文，看日志时左侧时间线仍可见。
 */
export function Drawer({
  title, sub, nav, onClose, children, width = 720,
}: {
  title: React.ReactNode; sub?: React.ReactNode; onClose: () => void
  children: React.ReactNode
  /** 头部导航区（如上一个/下一个节点切换按钮） */
  nav?: React.ReactNode
  /** 面板宽度上限（默认 720px），窄屏自动收窄到 92vw */
  width?: number
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="mask mask-right" onClick={onClose}>
      <div className="drawer" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-h">
          <div className="drawer-t">
            <h3>{title}</h3>
            {sub && <div className="sub">{sub}</div>}
          </div>
          {nav && <div className="drawer-nav">{nav}</div>}
          <button className="iconbtn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="drawer-b">{children}</div>
      </div>
    </div>
  )
}

/* ============ Empty ============ */
export function Empty({ text = '暂无数据' }: { text?: string }) {
  return (
    <div className="empty">
      <Icon name="grid" size={34} />
      <div style={{ fontSize: 13 }}>{text}</div>
    </div>
  )
}

/* ============ Page header ============ */
export function PageH({ title, desc, actions }: { title: string; desc?: string; actions?: React.ReactNode }) {
  return (
    <div className="page-h">
      <div>
        <h2>{title}</h2>
        {desc && <p>{desc}</p>}
      </div>
      {actions && <div className="acts">{actions}</div>}
    </div>
  )
}
