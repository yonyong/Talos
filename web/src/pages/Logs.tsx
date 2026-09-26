import { useMemo, useState } from 'react'
import { Icon } from '../icons'
import { Kpi, Modal, PageH, Panel, Tag, useToast } from '../ui'
import { fetchLogs, useAsync } from '../api'
import type { AiCallLog } from '../types'

export default function Logs() {
  const { toast } = useToast()
  const { data: logs, loading } = useAsync<AiCallLog[]>(() => fetchLogs(), [])
  const [cur, setCur] = useState<AiCallLog | null>(null)

  const list = logs ?? []
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
      <PageH title="AI 调用日志" desc="每次调用的渲染后 Prompt、模型、用量与耗时，全部可观测。" />

      <div className="grid g4" style={{ marginBottom: 18 }}>
        <Kpi icon="spark" label="调用记录" value={String(stats.count)} delta="来自服务端" dir="up" />
        <Kpi icon="bolt" label="Token 消耗" value={stats.token} delta="累计" dir="up" color="#16a34a" glow="rgba(22,163,74,.2)" />
        <Kpi icon="clock" label="平均耗时" value={stats.avgLatency} delta="P95 参考" dir="flat" color="#0891b2" glow="rgba(8,145,178,.2)" />
        <Kpi icon="warn" label="变量缺失" value={String(stats.missing)} delta="需修模板" dir={stats.missing > 0 ? 'down' : 'up'} color="#b45309" glow="rgba(180,83,9,.2)" />
      </div>

      {loading && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>}
      {!loading && logs === null && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>接口请求失败，请确认后端已启动（:8080）</div>}

      {!loading && logs !== null && (
        <Panel title="调用明细" sub="点击「查看」可看到变量替换后的最终 Prompt 与模型输出" flush>
          {list.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>暂无调用日志</div>
          ) : (
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
