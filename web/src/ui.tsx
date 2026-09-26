import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
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
  icon, label, value, delta, dir = 'up', series, color = '#4f46e5', glow = 'rgba(79,70,229,.25)',
}: {
  icon: string; label: string; value: string; delta?: string; dir?: 'up' | 'down' | 'flat'
  series?: number[]; color?: string; glow?: string
}) {
  const id = label.replace(/\W/g, '')
  return (
    <div className="card card-pad kpi">
      <span className="glow" style={{ background: glow, top: -50, right: -40 }} />
      <div className="kpi-in">
        <div className="kl"><Icon name={icon} size={15} />{label}</div>
        <div className="kv">{value}</div>
        {delta && <div className={`kd ${dir}`}>{dir === 'up' ? '↑' : dir === 'down' ? '↓' : '·'} {delta}</div>}
        {series && <Sparkline points={series} color={color} id={id} />}
      </div>
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

export function Switch({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return <div className={`switch ${on ? 'on' : ''}`} onClick={onClick} />
}

export function Progress({ pct, tone }: { pct: number; tone?: 'warn' | 'err' }) {
  return <div className={`pbar ${tone ?? ''}`} style={{ marginTop: 8 }}><i style={{ width: `${pct}%` }} /></div>
}

/* ============ Modal ============ */
export function Modal({
  title, onClose, children, footer, width,
}: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="mask" onClick={onClose}>
      <div className="modal" style={width ? { maxWidth: width } : undefined} onClick={(e) => e.stopPropagation()}>
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
