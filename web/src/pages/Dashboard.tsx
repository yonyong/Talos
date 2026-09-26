import { useMemo } from 'react'
import { Icon } from '../icons'
import { Kpi, PageH, Panel, Ring, Tag } from '../ui'
import { fetchIssues, fetchClients, fetchLogs, fetchWorkflowInstances, useAsync } from '../api'
import { statusMeta } from '../constants'
import type { PageKey } from '../types'

function tokenNum(s: string): number {
  const n = parseFloat(s)
  return isFinite(n) ? n : 0
}

export default function Dashboard({ nav }: { nav: (p: PageKey) => void }) {
  const { data: issues } = useAsync(() => fetchIssues(), [])
  const { data: clients } = useAsync(() => fetchClients(), [])
  const { data: logs } = useAsync(() => fetchLogs(), [])
  const { data: instances } = useAsync(() => fetchWorkflowInstances(), [])

  const issueList = issues ?? []
  const clientList = clients ?? []
  const logList = logs ?? []
  const instList = instances ?? []

  const online = clientList.filter((c) => c.state !== 'off').length
  const totalClients = clientList.length
  const tokenSum = logList.reduce((s, l) => s + tokenNum(l.token), 0)
  const recent = issueList.slice(0, 5)

  const alerts = useMemo(() => {
    const blocked = issueList.filter((i) => i.status === 'blocked')
    const offlineClients = clientList.filter((c) => c.state === 'off')
    return [
      ...blocked.map((i) => ({ t: `${i.id}`, s: '设计评审未通过 / 阻塞', tone: 'warn' as const })),
      ...offlineClients.map((c) => ({ t: c.id, s: `离线 ${c.heartbeat}`, tone: 'err' as const })),
    ].slice(0, 4)
  }, [issueList, clientList])

  return (
    <div>
      <PageH
        title="总览"
        desc="研发流水线的实时健康度。"
        actions={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => nav('issues')}>查看 Issue</button>
            <button className="btn btn-primary btn-sm" onClick={() => nav('issues')}>
              <Icon name="plus" size={15} />新建 Issue
            </button>
          </>
        }
      />

      <div className="grid g4">
        <Kpi icon="issue" label="待处理 Issue" value={String(issueList.length)} delta="服务端实时" dir="up" color="#4f46e5" />
        <Kpi icon="flow" label="进行中工作流" value={String(instList.length)} delta={instList.length ? '实例运行中' : '暂无实例'} dir={instList.length ? 'up' : 'flat'} color="#f59e0b" glow="rgba(245,158,11,.22)" />
        <Kpi icon="client" label="在线客户端" value={`${online} / ${totalClients}`} delta={totalClients - online > 0 ? `${totalClients - online} 离线` : '全部在线'} dir={totalClients - online ? 'down' : 'up'} color="#0891b2" glow="rgba(8,145,178,.22)" />
        <Kpi icon="bolt" label="AI Token 消耗" value={tokenSum > 10000 ? `${(tokenSum / 1000).toFixed(1)}K` : String(tokenSum)} delta={`${logList.length} 次调用`} dir="up" color="#16a34a" glow="rgba(22,163,74,.2)" />
      </div>

      <div className="grid g3" style={{ marginTop: 18, gridTemplateColumns: '2fr 1fr' }}>
        <Panel
          title="近期 Issue"
          sub="按录入顺序"
          flush
          actions={<button className="btn btn-xs btn-outline" onClick={() => nav('issues')}>全部</button>}
        >
          {issueList.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>暂无 Issue</div>
          ) : (
            <table>
              <thead>
                <tr><th>ID</th><th>标题</th><th>类型</th><th>责任人</th><th>状态</th></tr>
              </thead>
              <tbody>
                {recent.map((i) => (
                  <tr key={i.id}>
                    <td className="tid">{i.id}</td>
                    <td>{i.title}</td>
                    <td><Tag tone={i.type === 'REQ' ? 'info' : 'err'}>{i.type === 'REQ' ? '需求' : '缺陷'}</Tag></td>
                    <td>{i.owner}</td>
                    <td><Tag tone={statusMeta[i.status].tone} dot>{statusMeta[i.status].l}</Tag></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Panel title="客户端在线率">
            <Ring
              pct={totalClients ? Math.round((online / totalClients) * 100) : 0}
              color="#16a34a"
              title={<>{online} / {totalClients} 台在线</>}
              desc={<>{totalClients - online > 0 ? `${totalClients - online} 台离线` : '全部在线'}</>}
            />
          </Panel>

          <Panel title="需要关注">
            {alerts.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>暂无阻塞或离线告警</div>
            ) : (
              alerts.map((a, i) => (
                <div key={i} className="row-between">
                  <div className="rl"><b>{a.t}</b><span>{a.s}</span></div>
                  <Tag tone={a.tone} dot>{a.tone === 'warn' ? '阻塞' : '离线'}</Tag>
                </div>
              ))
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
