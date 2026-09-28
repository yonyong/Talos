import { useState } from 'react'
import { Icon } from '../icons'
import { BrandMark } from '../brands'
import { Modal, PageH, Panel, Tag, useToast } from '../ui'
import { fetchAgentUsers, pushAllAgents, useAsync } from '../api'
// 与「设置面板 → Coding Agent」共用同一份编辑器：管理员改任意用户 == 用户改自己，逻辑完全一致
import { AgentConfigEditor, BACKEND_NAMES } from '../components/AgentConfigEditor'

type UserAgents = {
  id?: number
  email: string
  name: string
  clientId: string
  online: boolean
  agents: { backend: string; execPath: string; model: string; enabled: boolean }[]
}

export default function Agents() {
  const { toast } = useToast()
  const [pushing, setPushing] = useState(false)
  /** 正在配置的用户：弹框里复用设置面板同款编辑器 */
  const [editing, setEditing] = useState<UserAgents | null>(null)
  const { data, loading, error, reload } = useAsync<UserAgents[]>(fetchAgentUsers, [])

  // 已配置后端的用户排在前面，避免"配了却看不见"
  // 防御：旧版后端 /agents/users 可能缺 email 或 agents 字段，缺字段不得让整页白屏
  const users = [...(data ?? [])].sort(
    (a, b) =>
      Number((b.agents?.length ?? 0) > 0) - Number((a.agents?.length ?? 0) > 0)
      || (a.email ?? '').localeCompare(b.email ?? ''),
  )

  const push = async () => {
    setPushing(true)
    try {
      const r = await pushAllAgents()
      reload()
      toast(r.pushed > 0
        ? `已向 ${r.pushed} 个在线客户端下发（每人以其本人配置为准）`
        : '无在线客户端，配置已保存，将在其下次心跳/上线时补齐')
    } catch (e) {
      toast(`下发失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setPushing(false)
    }
  }

  return (
    <div>
      <PageH
        title="Coding Agent 配置"
        desc="按用户采集的 Coding Agent 配置，统一查看与下发。每个用户的后端可在本页直接配置，也可由用户本人在「设置面板 → Coding Agent」中自行配置，服务端不再预设任何默认后端。"
        actions={<button className="btn btn-primary btn-sm" onClick={push} disabled={pushing}>
          <Icon name="send" size={15} />{pushing ? '下发中…' : '保存并下发'}
        </button>}
      />

      <Panel title="用户配置汇总" sub={`共 ${users.length} 个用户 · 后端顺序即各人设置的优先级`} flush>
        {loading && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>}
        {!loading && error && (
          <div style={{
            margin: 16, padding: '10px 12px', borderRadius: 8,
            background: 'var(--err-soft)', color: 'var(--err)',
            fontSize: 12.5, lineHeight: 1.7,
          }}>
            <div style={{ fontWeight: 550, marginBottom: 2 }}>读取用户配置失败</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, opacity: 0.9 }}>{error}</div>
            <div style={{ marginTop: 6, color: 'var(--ink-3)' }}>
              若提示接口不存在，说明服务端仍是旧版本（未包含按用户采集接口），请重新构建并重启服务端后刷新。
            </div>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={reload}>重试</button>
          </div>
        )}
        {!loading && !error && users.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>
            暂无用户。在「用户管理」登记用户后，即可在此为其配置 Coding Agent。
          </div>
        )}
        {!error && users.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>用户</th>
                <th>绑定客户端</th>
                <th>在线</th>
                <th>已配置后端</th>
                <th style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.email || u.name}>
                  <td>
                    <div style={{ fontWeight: 550, fontSize: 13 }}>{u.name || '—'}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-4)', fontFamily: 'var(--mono)' }}>{u.email || '未登记邮箱'}</div>
                  </td>
                  <td>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>{u.clientId || '未绑定'}</span>
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                      <span style={{
                        width: 7, height: 7, borderRadius: '50%',
                        background: u.online ? 'var(--ok, #16a34a)' : 'var(--ink-4)',
                      }} />
                      {u.online ? '在线' : '离线'}
                    </span>
                  </td>
                  <td>
                    {(u.agents?.length ?? 0) === 0
                      ? <span style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>未配置</span>
                      : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {u.agents.map((a, i) => (
                            <span key={i} title={`${a.execPath || a.backend}${a.model ? ' · ' + a.model : ''}`}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                fontSize: 12, padding: '3px 9px 3px 7px', borderRadius: 6,
                                border: '1px solid var(--line)',
                                background: a.enabled ? 'var(--surface)' : 'transparent',
                                color: a.enabled ? 'var(--ink-1)' : 'var(--ink-4)',
                                opacity: a.enabled ? 1 : 0.55,
                                textDecoration: a.enabled ? 'none' : 'line-through',
                              }}>
                              <BrandMark backend={a.backend} size={13} />
                              {BACKEND_NAMES[a.backend] ?? a.backend}
                            </span>
                          ))}
                        </div>
                      )}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm btn-outline" onClick={() => setEditing(u)}>
                      <Icon name={(u.agents?.length ?? 0) > 0 ? 'settings' : 'plus'} size={13} />配置
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 12.5, color: 'var(--ink-4)' }}>
        <Icon name="info" size={14} />
        每行「配置」可直接编辑该用户的 Coding Agent，与用户本人在「设置面板 → Coding Agent」里配置完全等价：保存即写入并重推给其绑定的客户端。
        「保存并下发」做一次性全量下发，各客户端仍各取本人配置。未配置任何后端的用户，其客户端退化为本地 agent.yml 兜底。
      </div>

      {editing && (
        <Modal
          title={`配置 Coding Agent · ${editing.name || editing.email}`}
          width={1000}
          onClose={() => setEditing(null)}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            paddingBottom: 14, marginBottom: 16, borderBottom: '1px solid var(--line)',
          }}>
            <Icon name="agent" size={15} />
            <b style={{ fontSize: 13 }}>{editing.name || '—'}</b>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-4)' }}>{editing.email || '未登记邮箱'}</span>
            <span style={{ width: 1, height: 14, background: 'var(--line)' }} />
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>绑定客户端</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>{editing.clientId || '未绑定'}</span>
            <Tag tone={editing.online ? 'ok' : 'mut'} dot>{editing.online ? '在线' : '离线'}</Tag>
          </div>

          {(!editing.clientId || !editing.online) && (
            <div style={{
              padding: '9px 11px', borderRadius: 8, marginBottom: 14,
              background: 'var(--warn-soft)', color: 'var(--warn)',
              fontSize: 12.5, lineHeight: 1.7,
            }}>
              {!editing.clientId
                ? '该用户还没有绑定客户端：配置会保存，但需先在「用户管理」为其绑定客户端才能下发与测试。'
                : '该用户客户端当前离线：保存仍会写入，并会在其上线时自动下发；「测试」需客户端在线才能执行。'}
            </div>
          )}

          <AgentConfigEditor targetEmail={editing.email || undefined} onSaved={() => reload()} />
        </Modal>
      )}
    </div>
  )
}
