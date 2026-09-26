import { useState } from 'react'
import { Icon } from '../icons'
import { Kpi, PageH, Panel, Search, Tag, useToast } from '../ui'
import { fetchClients, fetchClientStats, useAsync } from '../api'
import type { ClientNode } from '../types'

const dotOf: Record<string, string> = { on: 'on', busy: 'busy', off: 'off' }
const stateTag: Record<string, { l: string; tone: 'ok' | 'prog' | 'err' }> = {
  on: { l: '在线', tone: 'ok' }, busy: { l: '执行中', tone: 'prog' }, off: { l: '离线', tone: 'err' },
}

export default function Clients() {
  const { toast } = useToast()
  const { data: clients, loading } = useAsync<ClientNode[]>(() => fetchClients(), [])
  const { data: stats } = useAsync(() => fetchClientStats(), [])
  const [q, setQ] = useState('')

  const list = clients ?? []
  const shown = list.filter((c) => !q || c.id.includes(q) || c.owner.includes(q) || c.ip.includes(q))
  const online = list.filter((c) => c.state !== 'off').length
  const totalAgents = list.reduce((s, c) => s + (c.agents.filter((a) => a !== '—').length), 0)
  const offline = list.length - online
  const avgHeartbeat = list.length ? '实时' : '—'

  return (
    <div>
      <PageH
        title="客户端"
        desc="所有接入 Talos 的研发终端及其连接状态。"
        actions={<button className="btn btn-outline btn-sm" onClick={() => toast('已复制接入命令')}><Icon name="copy" size={15} />复制接入命令</button>}
      />

      {loading && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>}
      {!loading && clients === null && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>接口请求失败，请确认后端已启动（:8080）</div>}

      {!loading && clients !== null && (
        <>
          <div className="grid g4" style={{ marginBottom: 18 }}>
            <Kpi icon="client" label="在线" value={String(online)} delta={`/ ${list.length}`} dir="up" color="#0891b2" glow="rgba(8,145,178,.2)" />
            <Kpi icon="agent" label="Coding Agent" value={String(totalAgents)} delta="已配置" dir="up" color="#4f46e5" />
            <Kpi icon="clock" label="心跳" value={avgHeartbeat} delta={stats ? `${stats.onlineRate}% 在线率` : '正常'} dir="up" color="#16a34a" glow="rgba(22,163,74,.2)" />
            <Kpi icon="warn" label="异常" value={String(offline)} delta="离线 / 超阈" dir={offline > 0 ? 'down' : 'up'} color="#b91c1c" glow="rgba(185,28,28,.18)" />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, gap: 14, flexWrap: 'wrap' }}>
            <Search placeholder="搜索客户端、责任人、IP" value={q} onChange={setQ} />
            <button className="btn btn-outline btn-sm" onClick={() => toast('已向全部客户端推送重连指令')}>
              <Icon name="refresh" size={15} />全部重连
            </button>
          </div>

          {shown.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 24, textAlign: 'center' }}>暂无客户端接入</div>
          ) : (
            <div className="grid g2">
              {shown.map((c) => (
                <div key={c.id} className="card card-pad">
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <span className={`cdot ${dotOf[c.state]}`} />
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{c.id}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3 }}>
                          {c.owner} · {c.ip} · {c.version}
                        </div>
                      </div>
                    </div>
                    <Tag tone={stateTag[c.state].tone} dot>{stateTag[c.state].l}</Tag>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }}>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                      心跳 {c.heartbeat} · Agent {c.agents.filter((a) => a !== '—').length} 个
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {c.agents.filter((a) => a !== '—').map((a) => <span key={a} className="tag t-mut">{a}</span>)}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button className="btn btn-outline btn-xs" onClick={() => toast(`已请求 ${c.id} 重连`)}>重连</button>
                    <button className="btn btn-outline btn-xs" onClick={() => toast(`已下发配置至 ${c.id}`)}>下发配置</button>
                    <button className="btn btn-outline btn-xs" onClick={() => toast('已打开终端日志')}>查看日志</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Panel title="接入说明" sub="客户端安装后主动建立反向长连接" >
            <div className="codeblk">
              {`# Windows（管理员）
TalosAgent.exe install --server talos.yonyong.dev:9443 --token <一次性凭证>

# 计划任务保活（每 5 分钟检查拉起）
schtasks /create /tn "TalosAgentWatchdog" /sc minute /mo 5 \\
         /tr "C:\\Talos\\TalosAgent.exe --keepalive" /rl HIGHEST /f`}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 12.5, color: 'var(--ink-4)' }}>
              <Icon name="info" size={14} /> 客户端位于 NAT 后，服务端不主动入站；断线后指数退避重连。
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}
