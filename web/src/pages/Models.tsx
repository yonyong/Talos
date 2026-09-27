import { useState } from 'react'
import { Icon } from '../icons'
import { Modal, PageH, Switch, Tag, useToast } from '../ui'
import { fetchLlmConfigs, saveLlmConfig, testLlmChannel, useAsync } from '../api'
import type { LlmChannel, LlmTestResult } from '../types'

/** 服务商预设：切 provider 时如果 baseUrl 为空或仍是别的预设值，就自动填上 */
const PROVIDERS: { v: string; label: string; baseUrl: string; models: string[] }[] = [
  { v: 'qwen', label: '通义千问（DashScope）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-max', 'qwen-plus', 'qwen-turbo'] },
  { v: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-plus', 'glm-4', 'glm-4-flash'] },
  { v: 'openai-compatible', label: '其它 OpenAI 兼容端点', baseUrl: '', models: [] },
]

const CHANNEL_META: Record<string, { title: string; usage: string; icon: string }> = {
  PUBLIC: { title: '公网通道', usage: '准入判定 · 业务域分拣 · 通用 QA，不涉及代码', icon: 'cloud' },
  PRIVATE: { title: '私有化通道', usage: '故障分析 · 编码 · 文档生成，涉及代码，默认不出内网', icon: 'lock' },
}

function fmtTime(s?: string): string {
  return s ? s.replace('T', ' ').slice(0, 16) : '—'
}

export default function Models() {
  const { toast } = useToast()
  const { data, loading, reload } = useAsync<LlmChannel[]>(() => fetchLlmConfigs(), [])
  const [editing, setEditing] = useState<LlmChannel | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState('')
  const [results, setResults] = useState<Record<string, LlmTestResult>>({})

  const list = data ?? []

  const openEdit = (c: LlmChannel) => {
    setEditing({ ...c })
    setKeyInput('')
    setClearKey(false)
  }

  const setField = (patch: Partial<LlmChannel>) => setEditing((e) => (e ? { ...e, ...patch } : e))

  const onProviderChange = (v: string) => {
    if (!editing) return
    const preset = PROVIDERS.find((p) => p.v === v)
    const oldPreset = PROVIDERS.find((p) => p.baseUrl && p.baseUrl === editing.baseUrl)
    const baseUrl = (!editing.baseUrl || oldPreset) ? (preset?.baseUrl ?? '') : editing.baseUrl
    const model = preset?.models.length && (!editing.model || !editing.model.trim())
      ? preset.models[0] : editing.model
    setField({ provider: v, baseUrl, model })
  }

  const submit = async () => {
    if (!editing) return
    if (!editing.baseUrl?.trim()) { toast('Base URL 不能为空'); return }
    if (!editing.model?.trim()) { toast('模型名不能为空'); return }
    setSaving(true)
    try {
      await saveLlmConfig({
        channel: editing.channel, label: editing.label, provider: editing.provider,
        baseUrl: editing.baseUrl.trim(), model: editing.model.trim(),
        temperature: editing.temperature, timeoutSeconds: editing.timeoutSeconds,
        enabled: editing.enabled, privateOnly: editing.privateOnly,
        apiKey: keyInput.trim() || undefined,
        clearKey,
      })
      setEditing(null)
      reload()
      toast(`${CHANNEL_META[editing.channel]?.title ?? editing.channel} 已保存，即时生效`)
    } catch (e) {
      toast(`保存失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  const test = async (c: LlmChannel) => {
    setTesting(c.channel)
    try {
      const r = await testLlmChannel(c.channel)
      setResults((prev) => ({ ...prev, [c.channel]: r }))
      toast(r.ok ? `连通正常 · ${r.latencyMs}ms` : `连通失败：${r.message}`)
      reload()
    } catch (e) {
      toast(`测试失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setTesting('')
    }
  }

  const toggleEnabled = async (c: LlmChannel) => {
    try {
      await saveLlmConfig({ channel: c.channel, enabled: !c.enabled })
      reload()
      toast(`${CHANNEL_META[c.channel]?.title ?? c.channel} 已${c.enabled ? '停用' : '启用'}`)
    } catch (e) {
      toast(`操作失败：${e instanceof Error ? e.message : e}`)
    }
  }

  return (
    <div>
      <PageH
        title="模型配置"
        desc="服务端自身调用的 LLM（准入判定、业务域分拣、闸门判定）在这里配置。与 Coding Agent 是两回事——后者执行在客户端本地，服务端不持有其密钥。"
      />

      {loading && list.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>}
      {!loading && data === null && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>接口请求失败，请确认后端已启动（:8080）</div>}

      <div className="grid g2" style={{ alignItems: 'start' }}>
        {list.map((c) => {
          const meta = CHANNEL_META[c.channel]
          const r = results[c.channel]
          const ready = c.enabled && c.hasApiKey && !!c.baseUrl && !!c.model
          return (
            <div key={c.channel} className="card card-pad">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="acc-logo neutral"><Icon name={meta?.icon ?? 'cpu'} size={16} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <b style={{ fontSize: 14 }}>{meta?.title ?? c.channel}</b>
                    <Tag tone={ready ? 'ok' : c.enabled ? 'warn' : 'mut'} dot>
                      {ready ? '已接入' : c.enabled ? (c.hasApiKey ? '配置不完整' : '未配置密钥') : '已停用'}
                    </Tag>
                    {c.privateOnly && <Tag tone="info">不出内网</Tag>}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>{meta?.usage}</div>
                </div>
                <Switch on={c.enabled} onClick={() => toggleEnabled(c)} />
              </div>

              <div className="grid g2" style={{ marginTop: 20, gap: 14 }}>
                <Field label="服务商" value={PROVIDERS.find((p) => p.v === c.provider)?.label ?? c.provider ?? '—'} />
                <Field label="模型" value={c.model} mono />
                <Field label="Base URL" value={c.baseUrl} mono span2 />
                <Field label="密钥" value={c.hasApiKey ? c.apiKeyMasked ?? '已配置' : '未配置'} mono />
                <Field label="超时 / 温度"
                  value={`${c.timeoutSeconds ?? '—'}s · ${c.temperature ?? '—'}`} />
              </div>

              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)', fontSize: 12.5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--ink-4)' }}>最近测试</span>
                  {r ? (
                    <span style={{ color: r.ok ? 'var(--ok-ink, #0f766e)' : 'var(--ink-2)', fontWeight: 550 }}>
                      {r.ok ? `连通正常 · ${r.latencyMs}ms` : r.message}
                    </span>
                  ) : c.lastTestResult ? (
                    <span style={{ color: 'var(--ink-3)' }}>{c.lastTestResult}</span>
                  ) : (
                    <span style={{ color: 'var(--ink-4)' }}>尚未测试</span>
                  )}
                  <span style={{ color: 'var(--ink-4)', marginLeft: 'auto' }}>{fmtTime(c.lastTestAt)}</span>
                </div>
                {r?.sample && (
                  <div className="codeblk" style={{ marginTop: 10, maxHeight: 90 }}>{r.sample}</div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                <button className="btn btn-sm btn-outline" disabled={testing === c.channel} onClick={() => test(c)}>
                  <Icon name="bolt" size={14} />{testing === c.channel ? '测试中…' : '测试连通性'}
                </button>
                <button className="btn btn-sm btn-outline" onClick={() => openEdit(c)}>
                  <Icon name="settings" size={14} />配置
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 16, fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.75 }}>
        <Icon name="info" size={14} />
        <div>
          配置保存后<b>即时生效</b>，无需重启——服务端每次调用都会现读一次通道配置。<br />
          {list.some((c) => c.enabled && !c.hasApiKey) && (
            <>当前有通道未配置密钥，此时的判定会走降级应答（不阻塞流程，但结论不可信）。<br /></>
          )}
          密钥只存服务端，接口只回传掩码；私有化通道的密钥同样不出内网。
        </div>
      </div>

      {editing && (
        <Modal
          title={`配置 ${CHANNEL_META[editing.channel]?.title ?? editing.channel}`}
          width={620}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn btn-sm" onClick={() => setEditing(null)}>取消</button>
              <button className="btn btn-primary btn-sm" disabled={saving} onClick={submit}>
                {saving ? '保存中…' : '保存'}
              </button>
            </>
          }
        >
          <div className="field" style={{ marginTop: 0 }}>
            <label>服务商</label>
            <select value={editing.provider ?? ''} onChange={(e) => onProviderChange(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
            </select>
          </div>

          <div className="field">
            <label>Base URL（OpenAI 兼容端点，可带 /v1）</label>
            <input value={editing.baseUrl ?? ''} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
              onChange={(e) => setField({ baseUrl: e.target.value })} />
          </div>

          <div className="grid g2" style={{ gap: 14 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>模型名</label>
              <input value={editing.model ?? ''} list="llm-models" placeholder="qwen-max"
                onChange={(e) => setField({ model: e.target.value })} />
              <datalist id="llm-models">
                {PROVIDERS.flatMap((p) => p.models).map((m) => <option key={m} value={m} />)}
              </datalist>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>超时（秒）</label>
              <input type="number" min={5} value={editing.timeoutSeconds ?? ''} placeholder="60"
                onChange={(e) => setField({ timeoutSeconds: e.target.value ? Number(e.target.value) : undefined })} />
            </div>
          </div>

          <div className="field">
            <label>
              API Key
              {editing.hasApiKey && !clearKey && (
                <span style={{ fontWeight: 400, color: 'var(--ink-4)', marginLeft: 8 }}>
                  已配置 {editing.apiKeyMasked}，留空表示不修改
                </span>
              )}
              {clearKey && <span style={{ fontWeight: 400, color: 'var(--warn-ink, #b45309)', marginLeft: 8 }}>保存后将清空密钥</span>}
            </label>
            <input
              type="password"
              value={clearKey ? '' : keyInput}
              disabled={clearKey}
              placeholder={editing.hasApiKey ? '输入新密钥以替换' : 'sk-...'}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            {editing.hasApiKey && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12.5, fontWeight: 400, color: 'var(--ink-3)' }}>
                <input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={clearKey}
                  onChange={(e) => { setClearKey(e.target.checked); if (e.target.checked) setKeyInput('') }} />
                清空已保存的密钥
              </label>
            )}
          </div>

          <div className="grid g2" style={{ gap: 14 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>温度 (temperature)</label>
              <input type="number" step="0.1" min={0} max={2} value={editing.temperature ?? ''} placeholder="0.2"
                onChange={(e) => setField({ temperature: e.target.value ? Number(e.target.value) : undefined })} />
            </div>
            <div className="field" style={{ margin: 0, display: 'flex', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 0, fontWeight: 400, color: 'var(--ink-2)' }}>
                <Switch on={editing.enabled} onClick={() => setField({ enabled: !editing.enabled })} />
                启用该通道
              </label>
            </div>
          </div>

          <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 14, lineHeight: 1.75 }}>
            结构化输出（准入 / 分拣 / 闸门）建议温度 0~0.3：结论需要可解析的稳定格式。
            保存后可直接用页面上的「测试连通性」验证，无需重启服务。
          </div>
        </Modal>
      )}
    </div>
  )
}

function Field({ label, value, mono, span2 }: { label: string; value?: string; mono?: boolean; span2?: boolean }) {
  return (
    <div style={span2 ? { gridColumn: '1 / -1' } : undefined}>
      <div style={{ color: 'var(--ink-4)', fontSize: 12 }}>{label}</div>
      <div style={{
        marginTop: 4, fontSize: 12.5, fontWeight: 550, wordBreak: 'break-all',
        fontFamily: mono ? 'var(--mono)' : undefined,
      }}>
        {value || '—'}
      </div>
    </div>
  )
}
