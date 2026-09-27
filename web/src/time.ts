/**
 * 节点/实例时间显示的统一工具。
 *
 * 后端 t_task_node 一直有 startedAt（服务端下发时刻）与 finishedAt（回执/跳过/取消时刻），
 * 但以前只有监控页的日志抽屉渲染了它们，两个节点列表都只显示状态和日志摘要 ——
 * 「节点跑了多久、什么时候开始」这件事在列表里完全看不到。这里集中一份实现，避免各页各写一份。
 */

/** 时间点：20:31:05；无值或非法值返回「—」 */
export function hhmmss(iso?: string): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  return isNaN(t) ? '—' : hhmmssOf(t)
}

/** 同上，但入参是时间戳（ms）。用于「更新于 21:40:12」这类由前端自己打的时间 */
export function hhmmssOf(ms?: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleTimeString('zh-CN', { hour12: false })
}

/** 耗时：未传结束时间时按「现在」估算（用于进行中的节点） */
export function duration(a?: string, b?: string): string {
  if (!a) return ''
  const s = new Date(a).getTime()
  const e = b ? new Date(b).getTime() : Date.now()
  if (isNaN(s) || isNaN(e)) return ''
  const ms = Math.max(0, e - s)
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`
}

/** 节点时间戳完整描述：20:31:05 → 20:31:42（进行中则写「进行中」），用于 title 提示 */
export function nodeTimeRange(startedAt?: string, finishedAt?: string): string {
  if (!startedAt) return finishedAt ? `${hhmmss(finishedAt)} 结束` : ''
  return `${hhmmss(startedAt)} → ${finishedAt ? hhmmss(finishedAt) : '进行中'}`
}

/**
 * 节点列表里那一小格时间文案（要短，一行得放得下）：
 * - 已结束：`20:31:05 · 37.1s`
 * - 进行中：`20:31:05 · 进行 3m 12s`
 * - 只有结束时间（被跳过 / 取消）：`20:35:10 结束`
 * - 都没有（未开始）：空串，不占位
 */
export function nodeTime(startedAt?: string, finishedAt?: string, status?: string): string {
  if (!startedAt) return finishedAt ? `${hhmmss(finishedAt)} 结束` : ''
  const d = duration(startedAt, finishedAt)
  if (finishedAt) return d ? `${hhmmss(startedAt)} · ${d}` : hhmmss(startedAt)
  const active = ['dispatched', 'running'].includes(String(status ?? '').toLowerCase())
  return d ? `${hhmmss(startedAt)} · ${active ? '进行 ' : ''}${d}` : hhmmss(startedAt)
}
