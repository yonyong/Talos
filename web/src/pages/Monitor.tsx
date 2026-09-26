import { useEffect, useState } from 'react'
import { Icon } from '../icons'
import { PageH, Panel, Tag } from '../ui'
import { fetchClients, fetchLogs, fetchIssues, fetchWorkflowInstances, fetchInstanceNodes, useAsync } from '../api'
import type { ClientNode, TimelineNode, TerminalLine, AiCallLog, Issue } from '../types'

const dotOf: Record<string, string> = { on: 'on', busy: 'busy', off: 'off' }
const stateTag: Record<string, { l: string; tone: 'ok' | 'prog' | 'err' }> = {
  on: { l: '在线', tone: 'ok' }, busy: { l: '执行中', tone: 'prog' }, off: { l: '离线', tone: 'err' },
}
const instStatusTone: Record<string, 'ok' | 'prog' | 'err' | 'warn' | 'mut'> = {
  done: 'ok', running: 'prog', blocked: 'warn', failed: 'err', pending: 'mut',
}

export default function Monitor() {
  const { data: clients } = useAsync<ClientNode[]>(() => fetchClients(), [])
  const { data: logs } = useAsync<AiCallLog[]>(() => fetchLogs(), [])
  const { data: issues } = useAsync<Issue[]>(() => fetchIssues(), [])
  const { data: instances } = useAsync(() => fetchWorkflowInstances(), [])

  const clientList = clients ?? []
  const logList = logs ?? []
  const issueList = issues ?? []
  const instList = instances ?? []

  const [selCode, setSelCode] = useState<string | null>(null)
  useEffect(() => {
    if (instList.length && !selCode) setSelCode(instList[0].instanceCode ?? null)
  }, [instList, selCode])

  const { data: nodes } = useAsync<TimelineNode[]>(
    () => (selCode ? fetchInstanceNodes(selCode) : Promise.resolve([])),
    [selCode],
  )
  const timeline = nodes ?? []

  // 选中实例的标题
  const selInst = instList.find((i) => i.instanceCode === selCode)
  const selIssue = selInst ? issueList.find((i) => i.id === selInst.issueCode) : undefined
  const headerTitle = selInst
    ? `${selInst.issueCode} · ${selIssue?.title ?? '工作流实例'}`
    : '暂无运行中的工作流实例'
  const headerSub = selInst
    ? `责任人 ${selIssue?.owner ?? '—'} · 客户端 ${selInst.clientId ?? '—'} · 后端 ${selInst.templateCode === 'BUG' ? 'CodeBuddy' : 'CodeBuddy'}`
    : '录入并准入 Issue 后将自动拉起实例'

  // 终端日志：最近 12 条 AI 调用
  const termLines: TerminalLine[] = logList.slice(0, 12).map((l) => ({
    ts: l.time, level: l.missingVars ? 'warn' : 'info',
    text: `[${l.node}] ${l.backend} · ${l.issue} · ${l.model}`,
  }))

  const alerts = [
    ...issueList.filter((i) => i.status === 'blocked').map((i) => ({ t: i.id, s: '设计评审未通过', tone: 'warn' as const })),
    ...clientList.filter((c) => c.state === 'off').map((c) => ({ t: c.id, s: `离线 ${c.heartbeat}`, tone: 'err' as const })),
  ].slice(0, 3)

  return (
    <div>
      <PageH title="作业监控" desc="工作流实例的实时进度、客户端连接与执行日志。" />

      <Panel
        title={headerTitle}
        sub={headerSub}
        actions={selInst ? <Tag tone="prog" dot>步骤 {selInst.currentStep ?? 0}/{selInst.totalSteps ?? 0}</Tag> : <Tag tone="mut" dot>空闲</Tag>}
      >
        {timeline.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>暂无节点进度（实例执行后回传）</div>
        ) : (
          <div className="timeline">
            {timeline.map((t) => (
              <div key={t.name} className={`tl ${t.state}`}>
                <div className="tld"><div className="dot"><Icon name={t.icon} size={13} /></div></div>
                <div className="tlb">
                  <div className="tlt">{t.name}</div>
                  <div className="tls">{t.text}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid g2" style={{ marginTop: 18 }}>
        <Panel title="客户端连接状态" sub="心跳 10s · 30s 判离线">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {clientList.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>暂无客户端</div>}
            {clientList.slice(0, 6).map((c) => (
              <div key={c.id} className="client">
                <span className={`cdot ${dotOf[c.state]}`} />
                <div className="ci">
                  <b>{c.id}</b>
                  <span>{c.owner} · 心跳 {c.heartbeat} · {c.version}</span>
                </div>
                <div className="cbadges"><Tag tone={stateTag[c.state].tone}>{stateTag[c.state].l}</Tag></div>
              </div>
            ))}
          </div>
        </Panel>

        <div className="panel">
          <div className="term-head" style={{ borderBottom: '1px solid rgba(255,255,255,.08)', background: '#0a0a0b' }}>
            <span style={{ fontSize: 12.5, color: '#a1a1aa', fontFamily: 'var(--mono)' }}>
              {selInst ? `${selInst.clientId ?? 'client'} · ${selInst.issueCode ?? ''}` : 'AI 调用日志'} · 实时
            </span>
            <span className="live"><span className="dot" />LIVE</span>
          </div>
          <div className="term" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
            {termLines.length === 0 ? (
              <div style={{ padding: 14, fontSize: 12, color: '#71717a' }}>暂无执行日志</div>
            ) : (
              termLines.map((l, i) => (
                <div key={i} className="ln">
                  <span className="ts">{l.ts}</span>
                  <span className={l.level}>{l.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid g3" style={{ marginTop: 18 }}>
        <Panel title="阻塞与告警" sub="需人工介入">
          {alerts.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>暂无阻塞或离线</div>
          ) : (
            alerts.map((a, i) => (
              <div key={i} className="row-between">
                <div className="rl"><b>{a.t}</b><span>{a.s}</span></div>
                <Tag tone={a.tone} dot>{a.tone === 'warn' ? '阻塞' : '离线'}</Tag>
              </div>
            ))
          )}
        </Panel>

        <div className="grid" style={{ gridColumn: 'span 2', gridTemplateColumns: '1fr', gap: 18 }}>
          <Panel title="运行中实例" sub={`${instList.length} 个`} flush>
            {instList.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>暂无运行中的工作流实例</div>
            ) : (
              <table>
                <thead><tr><th>实例</th><th>Issue</th><th>节点</th><th>客户端</th><th>进度</th><th>状态</th></tr></thead>
                <tbody>
                  {instList.map((r) => {
                    const p = r.totalSteps ? Math.round(((r.currentStep ?? 0) / r.totalSteps) * 100) : 0
                    return (
                      <tr key={r.instanceCode} className={selCode === r.instanceCode ? 'on' : ''} style={{ cursor: 'pointer' }} onClick={() => setSelCode(r.instanceCode ?? null)}>
                        <td className="tid">{r.instanceCode}</td>
                        <td>{r.issueCode}</td>
                        <td>{r.currentStep ?? '—'}/{r.totalSteps ?? '—'}</td>
                        <td className="tid">{r.clientId}</td>
                        <td style={{ minWidth: 120 }}>
                          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{p}%</div>
                          <div className="pbar"><i style={{ width: `${p}%` }} /></div>
                        </td>
                        <td>
                          <Tag tone={instStatusTone[r.status ?? ''] ?? 'mut'} dot>
                            {r.status === 'running' ? '执行中' : r.status === 'blocked' ? '阻塞' : r.status === 'done' ? '已完成' : r.status === 'failed' ? '失败' : r.status === 'pending' ? '待启动' : r.status}
                          </Tag>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
