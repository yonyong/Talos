import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../icons'
import { Kpi, Modal, PageH, Pager, Panel, Search, Tag, useToast } from '../ui'
import { fetchLogs, useAsync } from '../api'
import type { AiCallLog, LogPage, PageFocus } from '../types'

/** 每页条数：服务端分页，前端只渲染当前窗口，DOM 不会随日志量膨胀 */
const PAGE_SIZE = 50

/**
 * AI 调用日志：服务端 LLM 调用的唯一明细查看处。
 * 分页与关键字过滤都在服务端完成，可翻遍全部历史（不再受旧版 100 条上限限制）。
 * 可从作业监控带 issueCode 深链进来（focus），也支持关键字过滤（Issue / 节点 / 后端 / 模型）。
 */
export default function Logs({ focus }: { focus?: PageFocus }) {
  const { toast } = useToast()
  const [cur, setCur] = useState<AiCallLog | null>(null)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  // 服务端分页：q / page 任一变化即重新拉取当前窗口
  const { data: pageData, loading, error } = useAsync<LogPage>(
    () => fetchLogs({ q: q.trim() || undefined, page, size: PAGE_SIZE }),
    [q, page],
  )

  // 从作业监控等页面深链过来时，按 Issue 预置过滤（回到第 1 页）
  useEffect(() => {
    if (focus?.issueCode) { setQ(focus.issueCode); setPage(1) }
  }, [focus?.issueCode])

  // 关键字检索（服务端）变化回到第 1 页
  const onSearch = (v: string) => { setQ(v); setPage(1) }

  const list = pageData?.content ?? []
  const total = pageData?.total ?? 0
  const totalPages = pageData?.totalPages ?? 1
  const filtered = !!q.trim()
  const stats = useMemo(() => {
    const tokenSum = list.reduce((s, l) => s + (parseFloat(l.token) || 0), 0)
    const latSum = list.reduce((s, l) => s + (parseFloat(l.latency) || 0), 0)
    const missing = list.filter((l) => l.missingVars).length
    return {
      count: list.length,
      token: tokenSum > 0 ? `${(tokenSum / 1000).toFixed(2)}M` : '0',
      avgLatency: list.length ? `${(latSum / list.length).toFixed(1)}s` : '—',
      missing,
    }
  }, [list])

  return (
    <div>
      <PageH title="调用日志" desc="每次调用的渲染后 Prompt、模型、用量与耗时，全部可观测。仅统计真正调用模型的节点——拉取 Git 等机械节点不计入，其过程见节点执行日志。" />

      <div className="grid g4" style={{ marginBottom: 18 }}>
        <Kpi icon="spark" label="调用记录" value={String(total)} delta={filtered ? '当前过滤' : '来自服务端'} dir="up" />
        <Kpi icon="bolt" label="Token 消耗" value={stats.token} delta="本页累计" dir="up" color="#16a34a" />
        <Kpi icon="clock" label="平均耗时" value={stats.avgLatency} delta="本页参考" dir="flat" color="#0891b2" />
        <Kpi icon="warn" label="变量缺失" value={String(stats.missing)} delta="需修模板" dir={stats.missing > 0 ? 'down' : 'up'} color="#b45309" />
      </div>

      {!loading && !error && (
        <div style={{ maxWidth: 380, marginBottom: 14 }}>
          <Search placeholder="过滤：Issue / 节点 / 后端 / 模型" value={q} onChange={onSearch} />
        </div>
      )}

      {loading && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>}
      {!loading && error && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>接口请求失败，请确认后端已启动（:8080）</div>}

      {!loading && !error && (
        <Panel
          title="调用明细"
          sub={filtered
            ? `按「${q.trim()}」过滤出 ${total} 条 · 第 ${page}/${totalPages} 页 · 点击「查看」看最终 Prompt 与模型输出`
            : `共 ${total} 条 · 第 ${page}/${totalPages} 页 · 点击「查看」可看到变量替换后的最终 Prompt 与模型输出`}
          flush
        >
          {list.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>暂无调用日志</div>
          ) : (
            <>
              <table>
                <thead>
                  <tr><th>时间</th><th>Issue</th><th>后端</th><th>节点</th><th>模型</th><th>Token</th><th>耗时</th><th></th></tr>
                </thead>
                <tbody>
                  {list.map((l, i) => (
                  <tr key={i}>
                    <td className="tid">{l.time}</td>
                    <td className="tid">{l.issue}</td>
                    <td>{l.backend}</td>
                    <td>{l.node}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{l.model}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{l.token}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{l.latency}</td>
                    <td>
                      {l.missingVars
                        ? <Tag tone="warn">变量缺失</Tag>
                        : <button className="btn btn-xs btn-outline" onClick={() => setCur(l)}>查看</button>}
                    </td>
                  </tr>
                ))}
                </tbody>
              </table>
              {totalPages > 1 && (
                <Pager page={page} totalPages={totalPages} total={total} onChange={setPage} />
              )}
            </>
          )}
        </Panel>
      )}

      {cur && (
        <Modal
          title={`${cur.issue} · ${cur.node} · 调用详情`}
          width={760}
          onClose={() => setCur(null)}
          footer={<button className="btn btn-primary btn-sm" onClick={() => setCur(null)}>关闭</button>}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18, fontSize: 12.5 }}>
            <div><div style={{ color: 'var(--ink-4)' }}>后端 / 模型</div><div style={{ marginTop: 4 }}>{cur.backend} · {cur.model}</div></div>
            <div><div style={{ color: 'var(--ink-4)' }}>Token</div><div style={{ marginTop: 4 }}>{cur.token}</div></div>
            <div><div style={{ color: 'var(--ink-4)' }}>耗时</div><div style={{ marginTop: 4 }}>{cur.latency}</div></div>
            <div><div style={{ color: 'var(--ink-4)' }}>节点</div><div style={{ marginTop: 4 }}>{cur.node}</div></div>
          </div>

          {cur.missingVars && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'var(--warn-soft)', color: 'var(--warn)', fontSize: 12.5, marginBottom: 14 }}>
              <Icon name="warn" size={15} /> 变量 kb.hits 缺失，本次判定置信度下降，建议检查模板变量注入
            </div>
          )}

          <div className="field" style={{ marginTop: 0 }}>
            <label>渲染后 Prompt（输入）</label>
            <div className="codeblk">{cur.prompt || '（空）'}</div>
          </div>

          <div className="field">
            <label>模型输出（output）</label>
            <div className="codeblk">{cur.output}</div>
          </div>

          <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.6 }}>
            Prompt 模板来自服务端配置，变量替换在客户端执行，替换后的完整内容与调用日志一并回传服务端，
            用于调试模板、审计与成本管控。
          </div>
        </Modal>
      )}
    </div>
  )
}
