import { useMemo } from 'react'
import { Icon } from '../icons'
import { Kpi, PageH, Panel, Ring, Tag } from '../ui'
import { fetchIssues, fetchClients, fetchLogs, fetchWorkflowInstances, useAsync } from '../api'
import { statusMeta } from '../constants'
import type { PageFocus, PageKey } from '../types'

function tokenNum(s: string): number {
  const n = parseFloat(s)
  return isFinite(n) ? n : 0
}

/** 未走完的生命周期状态：这些 Issue 才算「待处理」 */
const OPEN_STATUS = ['admitting', 'admitted', 'sorting', 'running', 'blocked', 'reviewing']

export default function Dashboard({ nav }: { nav: (p: PageKey, focus?: PageFocus) => void }) {
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
  const offline = totalClients - online
  const tokenSum = logList.reduce((s, l) => s + tokenNum(l.token), 0)
  const recent = issueList.slice(0, 5)

  const openCount = issueList.filter((i) => OPEN_STATUS.includes(i.status)).length
  /** 真正在跑的实例（待启动 / 执行中 / 阻塞也算在流转中） */
  const activeInst = instList.filter((i) => ['running', 'blocked', 'pending'].includes(String(i.status))).length
  const blockedCount = issueList.filter((i) => i.status === 'blocked').length
  const aiNodeCount = logList.length

  const alerts = useMemo(() => {
    const blocked = issueList.filter((i) => i.status === 'blocked')
    const offlineClients = clientList.filter((c) => c.state === 'off')
    return [
      ...blocked.map((i) => ({
        key: `i-${i.id}`, t: `${i.id}`, s: '设计评审未通过 / 阻塞',
        tone: 'warn' as const, badge: '阻塞',
        go: () => nav('issues', { issueCode: i.id, status: 'blocked' }),
      })),
      ...offlineClients.map((c) => ({
        key: `c-${c.id}`, t: c.id, s: `离线 ${c.heartbeat}`,
        tone: 'err' as const, badge: '离线',
        go: () => nav('clients', { clientId: c.id, offline: true }),
      })),
    ].slice(0, 4)
  }, [issueList, clientList]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageH
        title="平台总览"
        desc="全站研发流水线健康度。个人待办请回「我的工作台」。卡片与行可点击下钻。"
        actions={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => nav('workbench')}>我的工作台</button>
            <button className="btn btn-outline btn-sm" onClick={() => nav('issues')}>查看 Issue</button>
            <button className="btn btn-primary btn-sm" onClick={() => nav('issues')}>
              <Icon name="plus" size={15} />新建 Issue
            </button>
          </>
        }
      />

      <div className="grid g4">
        <Kpi
          icon="issue" label="待处理 Issue" value={String(openCount)} delta={`共 ${issueList.length} 条`} dir="up"
          color="#4f46e5" hint="查看未走完的 Issue"
          onClick={() => nav('issues', { status: 'open' })}
        />
        <Kpi
          icon="flow" label="进行中工作流" value={String(activeInst)}
          delta={activeInst ? '实例流转中' : '暂无实例'} dir={activeInst ? 'up' : 'flat'}
          color="#f59e0b" glow="rgba(245,158,11,.22)" hint="前往作业监控查看实例进度"
          onClick={() => nav('monitor')}
        />
        <Kpi
          icon="client" label="在线客户端" value={`${online} / ${totalClients}`}
          delta={offline > 0 ? `${offline} 台离线` : '全部在线'} dir={offline ? 'down' : 'up'}
          color="#0891b2" glow="rgba(8,145,178,.22)" hint="查看客户端连接状态"
          onClick={() => nav('clients', offline > 0 ? { offline: true } : undefined)}
        />
        <Kpi
          icon="bolt" label="AI Token 消耗" value={tokenSum > 10000 ? `${(tokenSum / 1000).toFixed(1)}K` : String(tokenSum)}
          delta={`${aiNodeCount} 次调用`} dir="up" color="#16a34a" glow="rgba(22,163,74,.2)"
          hint="查看调用日志" onClick={() => nav('logs')}
        />
      </div>

      <div className="grid g3" style={{ marginTop: 18, gridTemplateColumns: '2fr 1fr' }}>
        <Panel
          title="近期 Issue"
          sub="按录入顺序 · 点击行打开详情"
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
                  <tr
                    key={i.id}
                    className="row-link"
                    title={`打开 ${i.id} 详情`}
                    onClick={() => nav('issues', { issueCode: i.id, status: i.status })}
                  >
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
          <Panel
            title="客户端在线率"
            actions={offline > 0 ? (
              <button className="btn btn-xs btn-outline" onClick={() => nav('clients', { offline: true })}>
                查看离线
              </button>
            ) : undefined}
          >
            <div
              className={offline > 0 ? 'row-link' : ''}
              style={{ cursor: offline > 0 ? 'pointer' : 'default' }}
              onClick={offline > 0 ? () => nav('clients', { offline: true }) : undefined}
              title={offline > 0 ? '查看离线客户端' : undefined}
            >
              <Ring
                pct={totalClients ? Math.round((online / totalClients) * 100) : 0}
                color="#16a34a"
                title={<>{online} / {totalClients} 台在线</>}
                desc={<>{offline > 0 ? `${offline} 台离线` : '全部在线'}</>}
              />
            </div>
          </Panel>

          <Panel title="需要关注" sub={alerts.length ? '点击行定位到明细' : undefined}>
            {alerts.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>暂无阻塞或离线告警</div>
            ) : (
              alerts.map((a) => (
                <div
                  key={a.key}
                  className="row-between row-link"
                  onClick={a.go}
                  title={`定位到 ${a.t}`}
                >
                  <div className="rl"><b>{a.t}</b><span>{a.s}</span></div>
                  <Tag tone={a.tone} dot>{a.badge}</Tag>
                </div>
              ))
            )}
          </Panel>
        </div>
      </div>

      {(blockedCount > 0 || offline > 0) && (
        <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--ink-4)' }}>
          {blockedCount > 0 && (
            <a style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => nav('issues', { status: 'blocked' })}>
              查看 {blockedCount} 条阻塞 Issue →
            </a>
          )}
          {offline > 0 && (
            <a style={{ color: 'var(--accent)', cursor: 'pointer', marginLeft: 14 }} onClick={() => nav('clients', { offline: true })}>
              查看 {offline} 台离线客户端 →
            </a>
          )}
        </div>
      )}
    </div>
  )
}
