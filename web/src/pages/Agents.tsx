import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../icons'
import { PageH, Panel, Progress, Switch, Tag, useToast } from '../ui'
import { fetchAgents, fetchPrompts, saveAgent, pushAllAgents, useAsync } from '../api'
import type { AgentBackend, PromptTemplate } from '../types'

const SCOPES = ['全局默认', 'dev-windows-07', 'dev-mac-03', 'dev-linux-11']

const LOGO_KEY: Record<string, string> = { claude: 'cc', cursor: 'cu', codex: 'cx', codebuddy: 'cb' }

export default function Agents() {
  const { toast } = useToast()
  const [scope, setScope] = useState('全局默认')
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [configs, setConfigs] = useState<Record<string, Partial<AgentBackend>>>({})
  const [open, setOpen] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: agents, loading, reload } = useAsync<AgentBackend[]>(() => fetchAgents(scope), [scope])
  const { data: prompts } = useAsync<PromptTemplate[]>(() => fetchPrompts(), [])

  useEffect(() => {
    if (agents) {
      setEnabled(Object.fromEntries(agents.map((a) => [a.key, a.enabled])))
      setConfigs(Object.fromEntries(agents.map((a) => [a.key, {
        httpEndpoint: a.httpEndpoint, apiKey: a.apiKey, temperature: a.temperature,
      }])))
    }
  }, [agents])

  const list = agents ?? []
  const promptList = prompts ?? []

  const changed = useMemo(() => {
    if (!agents) return false
    return agents.some((a) =>
      enabled[a.key] !== a.enabled ||
      configs[a.key]?.httpEndpoint !== a.httpEndpoint ||
      configs[a.key]?.apiKey !== a.apiKey ||
      configs[a.key]?.temperature !== a.temperature
    )
  }, [agents, enabled, configs])

  const save = async () => {
    setSaving(true)
    try {
      for (const a of list) {
        const cfg = configs[a.key]
        if (
          enabled[a.key] !== a.enabled ||
          cfg?.httpEndpoint !== a.httpEndpoint ||
          cfg?.apiKey !== a.apiKey ||
          cfg?.temperature !== a.temperature
        ) {
          await saveAgent({
            id: a.id, scope: a.scope ?? 'GLOBAL', backend: a.key,
            model: a.model === '—' ? undefined : a.model, enabled: enabled[a.key], privateOnly: a.privateOnly,
            httpEndpoint: cfg?.httpEndpoint, apiKey: cfg?.apiKey, temperature: cfg?.temperature,
          })
        }
      }
      const r = await pushAllAgents()
      reload()
      toast(`配置已保存并下发（${r.pushed} 个在线客户端）`)
    } catch (e) {
      toast(`保存失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageH
        title="Coding Agent 配置"
        desc="服务端统一定义，按客户端差异化下发。所有 Prompt 与模板均来自配置，变量由系统注入。"
        actions={<button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !changed}><Icon name="send" size={15} />{saving ? '下发中…' : '保存并下发'}</button>}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>作用于</span>
        <div className="seg">
          {SCOPES.map((s) => (
            <button key={s} className={scope === s ? 'on' : ''} onClick={() => setScope(s)}>{s}</button>
          ))}
        </div>
        <span style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>
          {scope === '全局默认' ? '所有客户端继承默认配置' : `仅覆盖 ${scope} 的配置，未覆盖项继承全局`}
        </span>
      </div>

      {loading && list.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>}
      {!loading && agents === null && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>接口请求失败，请确认后端已启动（:8080）</div>}

      {list.map((a) => {
        const lk = LOGO_KEY[a.key] ?? a.key.slice(0, 2)
        const cfg = configs[a.key] ?? {}
        return (
          <div key={a.key} className={`acc ${open === a.key ? 'open' : ''}`}>
            <div className="acc-head" onClick={() => setOpen(open === a.key ? '' : a.key)}>
              <div className={`acc-logo ${lk}`}>{a.logo}</div>
              <b>{a.name}</b>
              <span className="am">{a.model}</span>
              <div className="ar">
                {a.privateOnly && <Tag tone="info">私有化</Tag>}
                <Tag tone={enabled[a.key] ? 'ok' : 'mut'}>{enabled[a.key] ? '启用' : '停用'}</Tag>
                <Switch on={enabled[a.key]} onClick={() => setEnabled({ ...enabled, [a.key]: !enabled[a.key] })} />
                <Icon name="chevron" size={16} />
              </div>
            </div>
            <div className="acc-body">
              <div className="grid g3">
                <div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>本月费用</div>
                  <div style={{ fontSize: 18, fontWeight: 620, marginTop: 6 }}>{a.cost}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>额度使用</div>
                  <div style={{ fontSize: 18, fontWeight: 620, marginTop: 6 }}>{a.usage}%</div>
                  <Progress pct={a.usage} tone={a.usage > 90 ? 'err' : a.usage > 70 ? 'warn' : undefined} />
                </div>
                <div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>单任务限额</div>
                  <div style={{ fontSize: 18, fontWeight: 620, marginTop: 6 }}>{a.privateOnly ? '不限' : '200k tokens'}</div>
                </div>
              </div>

              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>HTTP LLM 配置</div>
                <div className="grid g2" style={{ gap: 14 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>接入地址 (baseUrl)</label>
                    <input
                      value={cfg.httpEndpoint ?? ''}
                      onChange={(e) => setConfigs({ ...configs, [a.key]: { ...cfg, httpEndpoint: e.target.value } })}
                      placeholder="https://api.openai.com/v1"
                    />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>API Key</label>
                    <input
                      type="password"
                      value={cfg.apiKey ?? ''}
                      onChange={(e) => setConfigs({ ...configs, [a.key]: { ...cfg, apiKey: e.target.value } })}
                      placeholder="sk-..."
                    />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>温度 (temperature)</label>
                    <input
                      type="number" step="0.1" min="0" max="2"
                      value={cfg.temperature ?? ''}
                      onChange={(e) => setConfigs({ ...configs, [a.key]: { ...cfg, temperature: e.target.value ? parseFloat(e.target.value) : undefined } })}
                    />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>模型</label>
                    <input value={a.model} readOnly style={{ background: 'var(--bg-muted)' }} />
                  </div>
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-4)' }}>
                  留空表示使用客户端本地默认配置；保存后通过 gRPC 下发到在线客户端。
                </div>
              </div>

              <div style={{ marginTop: 18, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.65 }}>
                {a.privateOnly
                  ? 'CodeBuddy 为内网私有化后端，涉及代码的文档生成与编码默认走该通道，不出内网。'
                  : '公网后端由责任人自选，敏感仓库会被服务端策略强制切换到私有化通道。'}
              </div>
            </div>
          </div>
        )
      })}

      <div style={{ marginTop: 18 }}>
        <Panel
          title="Prompt 模板"
          sub="全部来自配置，变量由系统注入，禁止硬编码"
          flush
          actions={<button className="btn btn-xs btn-outline" onClick={() => toast('已打开模板编辑器')}>新建</button>}
        >
          {promptList.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>暂无模板</div>
          ) : (
            <table>
              <thead><tr><th>模板</th><th>场景</th><th>默认后端</th><th>注入变量</th><th>更新</th><th></th></tr></thead>
              <tbody>
                {promptList.map((t) => (
                  <tr key={t.name}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{t.name}</td>
                    <td>{t.scene}</td>
                    <td>{t.backend}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-3)' }}>{t.vars}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{t.updated}</td>
                    <td><button className="btn btn-xs btn-outline" onClick={() => toast(`编辑 ${t.name}`)}>编辑</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 12.5, color: 'var(--ink-4)' }}>
        <Icon name="info" size={14} /> 保存后通过 gRPC ConfigPush 实时下发到在线客户端；离线客户端在下次心跳时补齐。
      </div>
    </div>
  )
}
