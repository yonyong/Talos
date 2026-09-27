import { useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { Icon } from './icons'
import type { WorkflowEdge, WorkflowNode } from './types'

/* =========================================================================
 * 工作流 DAG 渲染器
 * 分层布局：按前向边做拓扑排序得到层号，同层节点纵向排列；回退边画成上方弧线。
 * 模板编辑（无状态）与作业监控（带实时状态）共用同一个组件。
 *
 * 交互：节点与条件边都可点击进入编辑；悬停时浮出完整信息卡。
 * 连线本体只有 1.5px，靠 16px 透明描边（hitarea）扩大命中范围。
 * ========================================================================= */

const NODE_W = 116
/**
 * 节点卡高度：卡内三行 = 12(STEP) + 17(名称) + 12(执行) = 41，加行距 6、内边距 14、边框 2，
 * 最小可用高度 63px。这里取 68 留 5px 余量，避免中英混排基线差异把末行挤到底部内边距里（贴边/被切）。
 */
const NODE_H = 68
const GAP_X = 92
const GAP_Y = 16
const PAD = 18
/** 卡内三行的固定行高，避免不同字体/语言基线导致高度抖动 */
const NODE_LH_HEAD = 12
const NODE_LH_NAME = 17
const NODE_LH_FOOT = 12
/** 每条回退边占用的上方弧线带高度（含标签，逐条向上错开） */
const LOOP_BAND = 30
/** 弧线带与节点区之间的留白 */
const LOOP_PAD = 14
/** 条件标签的估算高度与平行边错位步长（标签 10.5px 字号 + 内边距 ≈ 18px 高） */
const LABEL_H = 18
const LABEL_STACK = 24
/** 列间距自适应上限：超过则标签省略号收尾，避免超长表达式把画布撑爆 */
const MAX_GAP_X = 160
/** 悬浮信息卡宽度 */
const CARD_W = 268

const KIND_ICON: Record<string, string> = { git: 'git', doc: 'doc', code: 'code', test: 'test', rev: 'review' }

const TONE_COLOR: Record<string, string> = {
  mut: '#a1a1aa', ok: '#15803d', err: '#b91c1c', info: '#4f46e5', warn: '#b45309',
}
const TONES = ['mut', 'ok', 'err', 'info', 'warn']

/** 条件边的语义色与文案 */
export function condMeta(condition?: string, kind?: string): { tone: string; color: string; text: string; full: string } {
  const raw = (condition ?? 'always').trim()
  const full = raw || 'always'
  const low = raw.toLowerCase()
  if (kind === 'loopback') return { tone: 'warn', color: TONE_COLOR.warn, text: loopText(raw), full }
  if (!raw || low === 'always') return { tone: 'mut', color: TONE_COLOR.mut, text: '默认', full }
  if (low === 'never') return { tone: 'mut', color: TONE_COLOR.mut, text: '永不', full }
  if (low === 'success' || low === 'result:success') return { tone: 'ok', color: TONE_COLOR.ok, text: '执行成功', full }
  if (low === 'failed' || low === 'result:failed') return { tone: 'err', color: TONE_COLOR.err, text: '执行失败', full }
  if (low === 'gate:pass') return { tone: 'ok', color: TONE_COLOR.ok, text: '闸门通过', full }
  if (low === 'gate:blocked') return { tone: 'err', color: TONE_COLOR.err, text: '闸门驳回', full }
  if (low.startsWith('expr:')) return { tone: 'info', color: TONE_COLOR.info, text: raw.slice(5).trim() || '表达式', full }
  return { tone: 'info', color: TONE_COLOR.info, text: raw, full }
}

function loopText(raw: string): string {
  const low = raw.toLowerCase()
  if (low === 'failed') return '执行失败 · 回退'
  if (low === 'gate:blocked') return '闸门驳回 · 回退'
  if (low.startsWith('expr:')) return raw.slice(5).trim()
  return raw && low !== 'always' ? raw : '回退重做'
}

/** 节点状态 → 边框 / 底色；模板视图无状态时走中性样式 */
const STATUS_STYLE: Record<string, { border: string; bg: string; ink: string }> = {
  // 全部走主题变量，亮/暗两套主题自动适配
  success: { border: 'var(--line-2)', bg: 'var(--ok-soft)', ink: 'var(--ok)' },
  failed: { border: 'var(--line-2)', bg: 'var(--err-soft)', ink: 'var(--err)' },
  blocked: { border: 'var(--line-2)', bg: 'var(--err-soft)', ink: 'var(--err)' },
  dispatched: { border: 'var(--line-2)', bg: 'var(--accent-soft)', ink: 'var(--accent-ink)' },
  running: { border: 'var(--line-2)', bg: 'var(--accent-soft)', ink: 'var(--accent-ink)' },
  // 中性态用主题变量，避免暗色主题下变成刺眼白块
  skipped: { border: 'var(--line-2)', bg: 'var(--bg-muted)', ink: 'var(--ink-4)' },
  waiting: { border: 'var(--line-2)', bg: 'var(--surface)', ink: 'var(--ink-3)' },
}

const STATUS_LABEL: Record<string, string> = {
  success: '已完成', failed: '失败', blocked: '阻塞',
  dispatched: '已下发', running: '执行中', skipped: '已跳过', waiting: '待执行',
}

const TERMINAL = ['success', 'failed', 'skipped', 'cancelled']
const ACTIVE = ['dispatched', 'running']

/** 标签横向夹取，避免首尾标签被画布边缘裁掉 */
function clampX(x: number, width: number): number {
  return Math.min(Math.max(x, 58), Math.max(58, width - 58))
}

/**
 * 图上条件标签用的紧凑文本。
 * 注意：只作用于画布标签，悬浮卡与弹窗仍用 condMeta().text 的完整语义。
 */
function shortLabel(text: string): string {
  // 变量都来自 issue 上下文，去掉 issue. 前缀可显著收窄标签
  return text.replace(/issue\./g, '')
}

/** 估算标签渲染宽度：mono 10.5px 下 ASCII≈6.4px、CJK≈10.8px，加左右各 6px 内边距（当前仅潜在调试用，标签不再按宽度分行） */
function estLabelWidth(s: string): number {
  let w = 0
  for (const ch of s) w += /[\u2e80-\u9fff\uff00-\uffef\u3000]/.test(ch) ? 10.8 : 6.4
  return w + 12
}

interface Props {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  onNodeClick?: (n: WorkflowNode) => void
  /** 点连线或条件标签时回调，index 为边在 edges 数组中的下标 */
  onEdgeClick?: (e: WorkflowEdge, index: number) => void
  highlightStep?: number | null
  /** 显示实例实时状态（监控视图） */
  showStatus?: boolean
  /** 整体缩放（编排页放大用）：内容按 transform:scale 放大，横向溢出走滚动 */
  scale?: number
  /** 画布最小高度：内容不足时垂直居中，避免面板下方留大片空白 */
  minHeight?: number
  /** 节点角标动作（监控页：点击 ⟲ 从该节点重新执行）；不传则不渲染角标 */
  onNodeAction?: (n: WorkflowNode) => void
}

/** 前向条件标签的布局单元 */
interface FwdLabel {
  i: number
  e: WorkflowEdge
  m: { tone: string; color: string; text: string; full: string }
  /** 画布上显示的紧凑文本 */
  text: string
  /** 标签中心 x（落在该边离开源节点后的第一段间隙中央） */
  x: number
  /** 连线在该 x 处的高度（标签整体位于连线上方） */
  y: number
  /**
   * 垂直错位量（px，正数向下）。同一源节点的多条平行边（如 priority == P2 / != P2）
   * 会落到同一个 x/y 上互相压盖，按序上下错开。
   */
  dy: number
}

/** 当前悬停对象：节点或条件边，附带卡片落点 */
type HoverState =
  | { kind: 'node'; node: WorkflowNode; x: number; y: number }
  | { kind: 'edge'; edge: WorkflowEdge; x: number; y: number }

export default function WfGraph({ nodes, edges, onNodeClick, onEdgeClick, highlightStep, showStatus, scale, minHeight, onNodeAction }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<HoverState | null>(null)

  const model = useMemo(() => {
    const fwdEdges = edges.filter((e) => e.kind !== 'loopback')
    const loopEdges = edges.filter((e) => e.kind === 'loopback')

    // ---- 拓扑分层 ----
    const indeg = new Map<number, number>()
    const out = new Map<number, number[]>()
    nodes.forEach((n) => { indeg.set(n.step, 0); out.set(n.step, []) })
    fwdEdges.forEach((e) => {
      if (!indeg.has(e.to) || !out.has(e.from)) return
      indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
      out.get(e.from)!.push(e.to)
    })
    const level = new Map<number, number>()
    const queue: number[] = []
    nodes.forEach((n) => { if ((indeg.get(n.step) ?? 0) === 0) { level.set(n.step, 0); queue.push(n.step) } })
    while (queue.length) {
      const s = queue.shift()!
      for (const t of out.get(s) ?? []) {
        level.set(t, Math.max(level.get(t) ?? 0, (level.get(s) ?? 0) + 1))
        indeg.set(t, (indeg.get(t) ?? 0) - 1)
        if ((indeg.get(t) ?? 0) === 0) queue.push(t)
      }
    }
    nodes.forEach((n) => { if (!level.has(n.step)) level.set(n.step, 0) })

    // ---- 列内排布，整体按最长列居中 ----
    const columns = new Map<number, WorkflowNode[]>()
    nodes.forEach((n) => {
      const lv = level.get(n.step) ?? 0
      if (!columns.has(lv)) columns.set(lv, [])
      columns.get(lv)!.push(n)
    })
    const levelKeys = Array.from(columns.keys()).sort((a, b) => a - b)
    const maxRows = Math.max(1, ...Array.from(columns.values()).map((c) => c.length))
    const loopN = loopEdges.length
    /**
     * 列间距按最长的前向条件标签自适应：标签画在间隙正中，
     * 间隙一旦窄于标签就会被两侧节点压住（如 priority != P2 这类表达式条件）。
     * 上限 MAX_GAP_X：表达式可以写得很长，间距不能无限膨胀，超长标签改用省略号收尾。
     */
    const labelW = fwdEdges.reduce((mx, e) => {
      const t = shortLabel(condMeta(e.condition, 'forward').text)
      return Math.max(mx, estLabelWidth(t) + 4)
    }, 0)
    const gapX = Math.min(Math.max(GAP_X, Math.ceil(labelW) + 8), MAX_GAP_X)
    const width = PAD * 2 + levelKeys.length * NODE_W + Math.max(0, levelKeys.length - 1) * gapX
    // 上方预留回退弧线带：弧线与它的标签都落在节点区之上，不会压住节点
    const topOffset = PAD + (loopN ? LOOP_PAD + loopN * LOOP_BAND : 0)
    const bodyH = maxRows * NODE_H + (maxRows - 1) * GAP_Y

    const pos = new Map<number, { x: number; y: number }>()
    levelKeys.forEach((lv) => {
      const col = columns.get(lv)!.slice().sort((a, b) => a.step - b.step)
      const colH = col.length * NODE_H + (col.length - 1) * GAP_Y
      const startY = topOffset + (bodyH - colH) / 2
      col.forEach((n, i) => pos.set(n.step, { x: PAD + lv * (NODE_W + gapX), y: startY + i * (NODE_H + GAP_Y) }))
    })

    /** 回退边逐层收紧弧高，避免多条弧线叠在一起；弧顶始终位于节点区上方 */
    const loopTop = (idx: number) => PAD + (loopN - 1 - idx) * LOOP_BAND

    const geometry = (e: WorkflowEdge, loopIdx: number) => {
      const a = pos.get(e.from)
      const b = pos.get(e.to)
      if (!a || !b) return null
      const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2
      const x2 = b.x, y2 = b.y + NODE_H / 2
      if (e.kind === 'loopback') {
        const top = loopTop(loopIdx)
        return {
          d: `M ${x1} ${y1} C ${x1 + 46} ${top}, ${x2 - 46} ${top}, ${x2} ${y2}`,
          // 三次贝塞尔 t=0.5：(P0 + 3P1 + 3P2 + P3) / 8
          lx: (x1 + 3 * (x1 + 46) + 3 * (x2 - 46) + x2) / 8,
          ly: (y1 + 3 * top + 3 * top + y2) / 8,
        }
      }
      const dx = Math.max(26, (x2 - x1) / 2)
      return {
        d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
        lx: (x1 + 3 * (x1 + dx) + 3 * (x2 - dx) + x2) / 8,
        ly: (y1 + 3 * y1 + 3 * y2 + y2) / 8,
      }
    }

    // ---- 前向条件标签：落在连线上方（源节点右侧第一段间隙中央），不再使用节点下方标签带 ----
    // x 固定取源节点右侧第一段间隙的中点：相邻边天然各占一段间隙，互不重叠；
    // 跨列边（跳过中间节点）也取第一段间隙，避免标签压在中间节点上
    const fwdLabels = fwdEdges
      .map((e, i): FwdLabel | null => {
        const a = pos.get(e.from)
        const b = pos.get(e.to)
        if (!a || !b) return null
        const m = condMeta(e.condition, 'forward')
        const text = shortLabel(m.text)
        const spanX = Math.max(gapX, b.x - a.x - NODE_W)
        const x = clampX(a.x + NODE_W + gapX / 2, width)
        const y = a.y + NODE_H / 2 + ((b.y - a.y) * (gapX / 2)) / spanX
        return { i, e, m, text, x, y, dy: 0 }
      })
      .filter((v): v is FwdLabel => v !== null)

    // ---- 平行边标签错位 ----
    // 同一个源节点发出的多条边共用一个「第一段间隙」，x 完全相同；
    // 若目标也相同（典型：priority == P2 / != P2 这对互补条件），y 也相同，
    // 两个标签会精确重叠成一团。按 x 分组，组内依次上/下错开一行。
    const byColumn = new Map<number, FwdLabel[]>()
    for (const l of fwdLabels) {
      const key = Math.round(l.x)
      const list = byColumn.get(key)
      if (list) list.push(l)
      else byColumn.set(key, [l])
    }
    for (const list of byColumn.values()) {
      if (list.length < 2) continue
      list.sort((a, b) => a.y - b.y || a.i - b.i)
      list.forEach((l, k) => {
        if (k === 0) return
        const step = Math.ceil(k / 2) * LABEL_STACK
        // 上方空间不足时优先往下让，避免标签顶到画布上沿被裁
        const up = l.y - 3 - LABEL_H - step >= 1
        l.dy = k % 2 === 1 && up ? -step : step
      })
    }

    const activeNode = nodes.find((n) => ACTIVE.includes(n.status ?? ''))
      ?? nodes.find((n) => !TERMINAL.includes(n.status ?? ''))

    return {
      fwdEdges, loopEdges, pos, levelKeys, geometry,
      fwdLabels, width, gapX,
      height: topOffset + bodyH + PAD,
      activeStep: activeNode?.step ?? null,
    }
  }, [nodes, edges])

  /* ---------- 悬浮卡落点与交互事件 ---------- */

  /**
   * 卡片浮在元素右侧，右侧空间不足则翻到左侧。
   * 坐标相对外层容器而非滚动画布，因此不会被画布的 overflow 裁剪。
   */
  const cardAt = (el: Element): { x: number; y: number } => {
    const wrap = wrapRef.current
    if (!wrap) return { x: 0, y: 0 }
    const wr = wrap.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    const right = er.right - wr.left + 12
    const left = er.left - wr.left - CARD_W - 12
    return {
      x: right + CARD_W <= wr.width ? right : Math.max(8, left),
      y: Math.max(8, er.top - wr.top - 6),
    }
  }
  const enterNode = (ev: ReactMouseEvent<Element>, node: WorkflowNode) =>
    setHover({ kind: 'node', node, ...cardAt(ev.currentTarget) })
  const enterEdge = (ev: ReactMouseEvent<Element>, edge: WorkflowEdge) =>
    setHover({ kind: 'edge', edge, ...cardAt(ev.currentTarget) })
  const leave = () => setHover(null)
  const edgeIdx = (e: WorkflowEdge) => edges.indexOf(e)

  const hotEdge = (e: WorkflowEdge) => hover?.kind === 'edge' && hover.edge === e
  const hotNode = (s: number) => hover?.kind === 'node' && hover.node.step === s

  /* ---------- 画布缩放：编排页放大展示，监控页保持 1:1 ---------- */
  const zoom = scale ?? 1
  const boxH = Math.max(model.height * zoom, minHeight ?? 0)
  const offY = Math.max(0, (boxH - model.height * zoom) / 2)

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div data-wf-canvas style={{ overflowX: 'auto', overflowY: 'hidden' }}>
        <div style={{ position: 'relative', width: model.width * zoom, height: boxH, minWidth: '100%' }}>
          <div
            style={{
              position: 'absolute', left: 0, top: offY,
              width: model.width, height: model.height,
              transform: zoom !== 1 ? `scale(${zoom})` : undefined,
              transformOrigin: 'top left',
            }}
          >
          <svg width={model.width} height={model.height} style={{ position: 'absolute', inset: 0 }}>
            <defs>
              {TONES.map((t) => (
                <marker
                  key={t} id={`${uid}-arw-${t}`} viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={TONE_COLOR[t]} />
                </marker>
              ))}
            </defs>

            {/* 透明命中区：曲线本体只有 1.5px，用 16px 透明描边把可点范围撑开 */}
            {onEdgeClick && model.fwdEdges.map((e, i) => {
              const g = model.geometry(e, 0)
              if (!g) return null
              return (
                <path
                  key={`fh${i}`} d={g.d} fill="none" stroke="transparent" strokeWidth={16}
                  style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                  onClick={() => onEdgeClick(e, edgeIdx(e))}
                  onMouseEnter={(ev) => enterEdge(ev, e)}
                  onMouseLeave={leave}
                />
              )
            })}
            {onEdgeClick && model.loopEdges.map((e, i) => {
              const g = model.geometry(e, i)
              if (!g) return null
              return (
                <path
                  key={`lh${i}`} d={g.d} fill="none" stroke="transparent" strokeWidth={16}
                  style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                  onClick={() => onEdgeClick(e, edgeIdx(e))}
                  onMouseEnter={(ev) => enterEdge(ev, e)}
                  onMouseLeave={leave}
                />
              )
            })}

            {model.fwdEdges.map((e, i) => {
              const g = model.geometry(e, 0)
              if (!g) return null
              const m = condMeta(e.condition, 'forward')
              // 未走到的分支淡化，已走通/待判定的保持彩色
              const src = nodes.find((n) => n.step === e.from)
              const dim = showStatus && !TERMINAL.includes(src?.status ?? '')
              const hot = hotEdge(e)
              return (
                <path
                  key={`f${i}`} d={g.d} fill="none"
                  stroke={dim ? '#d4d4d8' : m.color}
                  strokeWidth={hot ? 2.4 : 1.5}
                  strokeDasharray={e.condition && e.condition !== 'always' ? '4 3' : undefined}
                  markerEnd={`url(#${uid}-arw-${dim ? 'mut' : m.tone})`}
                  style={{ pointerEvents: 'none', transition: 'stroke-width .14s ease' }}
                />
              )
            })}

            {model.loopEdges.map((e, i) => {
              const g = model.geometry(e, i)
              if (!g) return null
              const hot = hotEdge(e)
              return (
                <path
                  key={`l${i}`} d={g.d} fill="none" stroke={TONE_COLOR.warn}
                  strokeWidth={hot ? 2.2 : 1.4}
                  strokeDasharray="5 4" markerEnd={`url(#${uid}-arw-warn)`}
                  style={{ pointerEvents: 'none', transition: 'stroke-width .14s ease' }}
                />
              )
            })}
          </svg>

          {/* 条件标签：悬在连线上方、源节点侧第一段间隙中央；点击即编辑该边 */}
          {model.fwdLabels.map((l) => {
            const hot = hotEdge(l.e)
            return (
              <div
                key={`fl${l.i}`}
                data-wf-label="fwd"
                data-wf-cond={l.text}
                onClick={() => onEdgeClick?.(l.e, edgeIdx(l.e))}
                onMouseEnter={(ev) => enterEdge(ev, l.e)}
                onMouseLeave={leave}
                title={l.e.label ? `${l.m.full} · ${l.e.label}` : l.m.full}
                style={{
                  position: 'absolute',
                  left: l.x,
                  top: l.y - 3 + l.dy,
                  transform: 'translate(-50%, -100%)',
                  fontSize: 10.5, fontFamily: 'var(--mono)', color: l.m.color,
                  background: 'var(--surface)',
                  border: `1px solid ${hot ? l.m.color : l.m.color + '33'}`,
                  boxShadow: hot ? `0 0 0 3px ${l.m.color}1f` : undefined,
                  borderRadius: 6,
                  padding: '1px 6px', whiteSpace: 'nowrap',
                  // 超长表达式（间距已达上限）截断显示，全文在 title 与悬浮卡里
                  maxWidth: model.gapX - 8, overflow: 'hidden', textOverflow: 'ellipsis',
                  cursor: onEdgeClick ? 'pointer' : 'default',
                  transition: 'border-color .14s ease, box-shadow .14s ease',
                  zIndex: 3,
                }}
              >
                {l.text}
              </div>
            )
          })}
          {model.loopEdges.map((e, i) => {
            const g = model.geometry(e, i)
            if (!g) return null
            const m = condMeta(e.condition, 'loopback')
            const text = shortLabel(m.text)
            const hot = hotEdge(e)
            return (
              <div
                key={`ll${i}`}
                data-wf-label="loop"
                data-wf-cond={text}
                onClick={() => onEdgeClick?.(e, edgeIdx(e))}
                onMouseEnter={(ev) => enterEdge(ev, e)}
                onMouseLeave={leave}
                title={`${m.full}（回退边：命中后重置路径上的节点重做）`}
                style={{
                  position: 'absolute', left: clampX(g.lx, model.width), top: g.ly, transform: 'translate(-50%, -50%)',
                  fontSize: 10.5, fontFamily: 'var(--mono)', color: m.color,
                  background: 'var(--warn-soft)',
                  border: `1px solid ${hot ? m.color : m.color + '55'}`,
                  boxShadow: hot ? `0 0 0 3px ${m.color}1f` : undefined,
                  borderRadius: 6,
                  padding: '1px 6px', whiteSpace: 'nowrap',
                  cursor: onEdgeClick ? 'pointer' : 'default',
                  transition: 'border-color .14s ease, box-shadow .14s ease',
                  zIndex: 3,
                }}
              >
                ⟲ {text}
              </div>
            )
          })}

          {/* 节点 */}
          {nodes.map((node) => {
            const p = model.pos.get(node.step)
            if (!p) return null
            const st = showStatus ? (node.status ?? 'waiting') : undefined
            const style = st ? (STATUS_STYLE[st] ?? STATUS_STYLE.waiting) : null
            const hi = highlightStep === node.step
            const live = showStatus && model.activeStep === node.step && !TERMINAL.includes(st ?? '')
            const hot = hotNode(node.step)
            const gated = !!(node.gate && node.gate !== '—' && node.gate.trim())
            return (
              <div
                key={node.step}
                data-wf-node={node.step}
                data-wf-status={st ?? ''}
                onClick={() => onNodeClick?.(node)}
                onMouseEnter={(ev) => enterNode(ev, node)}
                onMouseLeave={leave}
                style={{
                  position: 'absolute', left: p.x, top: p.y, width: NODE_W, height: NODE_H,
                  borderRadius: 9,
                  border: `1px solid ${hi || live || hot ? '#4f46e5' : style ? style.border : 'var(--line-2)'}`,
                  background: style ? style.bg : 'var(--surface)',
                  boxShadow: hi || live || hot ? '0 0 0 3px rgba(79,70,229,.12)' : 'var(--shadow-sm)',
                  padding: '7px 9px',
                  cursor: onNodeClick ? 'pointer' : 'default',
                  display: 'flex', flexDirection: 'column', gap: 3,
                  opacity: st === 'skipped' ? 0.62 : 1,
                  transition: 'border-color .16s ease, box-shadow .16s ease',
                  zIndex: 2,
                }}
              >
                {/* 节点角标动作（监控页：从该节点重新执行） */}
                {onNodeAction && (
                  <button
                    type="button"
                    data-wf-node-action={node.step}
                    title={`从「${node.name}」重新执行（含下游节点）`}
                    onClick={(e) => { e.stopPropagation(); onNodeAction(node) }}
                    style={{
                      position: 'absolute', top: -9, right: -9, width: 20, height: 20,
                      borderRadius: '50%', border: '1px solid var(--line-2)', background: 'var(--surface)',
                      color: 'var(--ink-3)', cursor: 'pointer', padding: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 1px 5px rgba(10,10,11,.16)', zIndex: 5,
                      transition: 'color .14s ease, border-color .14s ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#4f46e5'; e.currentTarget.style.borderColor = '#4f46e5' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.borderColor = 'var(--line-2)' }}
                  >
                    <Icon name="refresh" size={11} />
                  </button>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, height: NODE_LH_HEAD, lineHeight: `${NODE_LH_HEAD}px`, flex: '0 0 auto' }}>
                  <Icon name={KIND_ICON[node.kind] ?? 'check'} size={12} />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
                    STEP {String(node.step).padStart(2, '0')}
                  </span>
                  {showStatus && st ? (
                    <span style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 650, color: style!.ink }}>
                      {STATUS_LABEL[st] ?? st}
                    </span>
                  ) : gated ? (
                    <span style={{ marginLeft: 'auto', color: 'var(--warn)', display: 'inline-flex' }} title="含闸门判定">
                      <Icon name="shield" size={11} />
                    </span>
                  ) : null}
                </div>
                <div style={{ flex: '1 1 auto', minHeight: NODE_LH_NAME, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  <span style={{ fontSize: 12, fontWeight: 620, letterSpacing: '-.01em', lineHeight: `${NODE_LH_NAME}px`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {node.name}
                  </span>
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--ink-4)',
                  height: NODE_LH_FOOT, lineHeight: `${NODE_LH_FOOT}px`, flex: '0 0 auto', overflow: 'hidden', whiteSpace: 'nowrap',
                }}>
                  <span>{node.exec}</span>
                  {node.backend && node.backend !== '—' && (
                    <span style={{ fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis' }}>· {node.backend}</span>
                  )}
                  {showStatus && node.gateResult && (
                    <span style={{ marginLeft: 'auto', fontWeight: 650, color: node.gateResult === 'pass' ? 'var(--ok)' : 'var(--err)' }}>
                      {node.gateResult === 'pass' ? '闸门通过' : '闸门驳回'}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
          </div>
        </div>
      </div>

      {hover && <HoverCardView card={hover} nodes={nodes} edges={edges} />}

      {model.loopEdges.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 10, lineHeight: 1.7 }}>
          虚线弧线为<b>回退边</b>：命中后会把「目标 → 源」路径上的节点重置重做，轮次有上限，超限转人工介入。
        </div>
      )}
    </div>
  )
}

/* ============================ 悬浮信息卡 ============================ */

function CardRow({ k, v, mono }: { k: string; v?: ReactNode; mono?: boolean }) {
  if (v === undefined || v === null || v === '') return null
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.65 }}>
      <span style={{ color: 'var(--ink-4)', flex: '0 0 70px' }}>{k}</span>
      <span style={{
        color: 'var(--ink-2)', flex: 1, minWidth: 0, wordBreak: 'break-word',
        fontFamily: mono ? 'var(--mono)' : undefined,
      }}>
        {v}
      </span>
    </div>
  )
}

function HoverCardView({ card, nodes, edges }: { card: HoverState; nodes: WorkflowNode[]; edges: WorkflowEdge[] }) {
  const nameOf = (s: number) => nodes.find((n) => n.step === s)?.name || `节点 ${s}`
  const shell: CSSProperties = {
    position: 'absolute', left: card.x, top: card.y, width: CARD_W,
    background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 10,
    boxShadow: '0 10px 28px rgba(10,10,11,.12)', padding: '10px 12px',
    pointerEvents: 'none', zIndex: 20,
  }
  const attrs = { 'data-wf-hover': card.kind } as const
  const foot: CSSProperties = {
    marginTop: 8, paddingTop: 7, borderTop: '1px solid var(--line)',
    fontSize: 11.5, color: 'var(--ink-4)',
  }

  if (card.kind === 'node') {
    const n = card.node
    const ins = edges.filter((e) => e.to === n.step)
    const outs = edges.filter((e) => e.from === n.step)
    return (
      <div style={shell} {...attrs}>
        <div style={{ fontSize: 12.5, fontWeight: 650, letterSpacing: '-.01em', marginBottom: 7 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)', marginRight: 6 }}>
            STEP {String(n.step).padStart(2, '0')}
          </span>
          {n.name}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <CardRow k="类型" v={n.kind.toUpperCase()} mono />
          <CardRow k="执行位置" v={n.exec} />
          <CardRow k="Coding Agent" v={n.backend === '—' ? undefined : n.backend} mono />
          <CardRow k="Prompt" v={n.prompt === '—' ? undefined : n.prompt} mono />
          <CardRow k="闸门" v={n.gate === '—' ? undefined : n.gate} />
          <CardRow k="入边" v={ins.length ? ins.map((e) => e.from).join(', ') : '入口'} mono />
          <CardRow
            k="出边"
            v={outs.length ? outs.map((e) => `${e.to}${e.kind === 'loopback' ? ' ⟲' : ''}`).join(', ') : '终点'}
            mono
          />
        </div>
        <div style={foot}>点击编辑此节点</div>
      </div>
    )
  }

  const e = card.edge
  const m = condMeta(e.condition, e.kind)
  return (
    <div style={shell} {...attrs}>
      <div style={{ fontSize: 12.5, fontWeight: 650, letterSpacing: '-.01em', marginBottom: 7 }}>
        {nameOf(e.from)} → {nameOf(e.to)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <CardRow k="方向" v={e.kind === 'loopback' ? '回退重做' : '前向'} />
        <CardRow k="条件" v={e.condition || 'always'} mono />
        <CardRow k="语义" v={m.text} />
        <CardRow k="说明" v={e.label} />
      </div>
      <div style={foot}>
        {e.kind === 'loopback' ? '点击编辑 · 命中后重置路径节点重做' : '点击编辑此条件边'}
      </div>
    </div>
  )
}
