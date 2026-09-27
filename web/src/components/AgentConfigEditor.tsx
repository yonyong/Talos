import { useEffect, useState } from 'react'
import { Icon } from '../icons'
import { BrandMark } from '../brands'
import { Dropdown, Modal, Switch, Tag, useToast } from '../ui'
import { fetchUserProfile, probeAgent, profileSaveHint, saveProfileAgents, useAsync } from '../api'
import type { ProbeResult, UserAgentCfg, ProfileSaveResult } from '../api'

/** 后端展示名：本机实测可用的四个 CLI 后端（与客户端 agentSummary() 上报值一致） */
export const BACKEND_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  cursor: 'Cursor',
  codex: 'Codex',
  codebuddy: 'CodeBuddy',
}

export const BACKEND_OPTIONS = Object.keys(BACKEND_NAMES)

/** 各后端的默认 CLI 命令名（Windows 本机实测可用的裸命令，走 cmd /c 解析 PATH） */
export const DEFAULT_EXEC: Record<string, string> = {
  claude: 'claude',
  cursor: 'cursor-agent',
  codex: 'codex',
  codebuddy: 'codebuddy', // npm 全局 CodeBuddy Code；桌面版自带 CLI 为 buddycn（bin/buddycn.cmd）
}

/** 命令预览：占位符换可读标记 */
export function uaCmdPreview(a: UserAgentCfg): string {
  const args = (a.argsTemplate ?? '')
    .replace('{prompt}', '<rendered-prompt>')
    .replace('{repo}', '<repo-path>')
    .replace('{branch}', '<feature-branch>')
    .replace('{model}', a.model || '—')
  const exec = a.execPath || a.backend
  const dir = a.workDir || '.'
  return `${exec} ${args}`.trim() + (dir && dir !== '.' ? `\n  working dir: ${dir}` : '')
}

export function ProbeView({ r }: { r: ProbeResult }) {
  return (
    <div style={{ marginTop: 10 }}>
      <Tag tone={r.ok ? 'ok' : 'err'} dot>{r.ok ? '测试通过' : '测试失败'}</Tag>
      {r.message && <span style={{ fontSize: 12.5, color: 'var(--ink-2)', marginLeft: 8 }}>{r.message}</span>}
      {r.output && (
        <div className="codeblk" style={{ marginTop: 8, maxHeight: 140, whiteSpace: 'pre-wrap' }}>{r.output}</div>
      )}
    </div>
  )
}

const DEFAULT_DESC = (
  <>
    可配置多个后端，<b>列表顺序即优先级</b>（拖拽 ⠿ 调整）；执行任务时从上往下选第一个可用的。
    服务端不再预设任何默认后端，这里配置的后端即该客户端可用的后端，保存后<b>立即重推给绑定客户端</b>。
  </>
)

/**
 * Coding Agent 编辑器：多条配置 + 拖拽排序 + 经客户端真机测试。
 *
 * 「设置面板 → Coding Agent」（改本人）与「Coding Agent 配置 → 用户配置汇总」（管理员改任意人）
 * 共用同一份逻辑与界面，避免两套编辑器行为漂移。写入走 POST /api/profile/{empNo}/agents（整表重写，顺序即优先级），
 * 测试经 gRPC 下发到该工号绑定的客户端本机执行。
 */
export function AgentConfigEditor({ empNo, desc, onSaved }: {
  empNo: string
  /** 顶部说明文案（默认面向管理员汇总场景） */
  desc?: React.ReactNode
  /** 保存成功回调（管理页据此刷新汇总列表） */
  onSaved?: (r: ProfileSaveResult) => void
}) {
  const { toast } = useToast()
  const { data, loading, reload } = useAsync(
    () => (empNo ? fetchUserProfile(empNo) : Promise.reject(new Error('未指定工号'))),
    [empNo],
  )
  /** 仅首屏未拿到数据时占位；保存后的 reload 不遮挡已渲染的列表 */
  const initialLoading = loading && data === null

  const [list, setList] = useState<UserAgentCfg[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState<number | null>(null)
  const [results, setResults] = useState<Record<number, ProbeResult>>({})
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  /** 正在弹框编辑的条目下标 */
  const [editing, setEditing] = useState<number | null>(null)

  useEffect(() => {
    if (data?.agents) {
      setList(data.agents.map((a) => ({ ...a, enabled: a.enabled !== false })))
      setDirty(false)
      setResults({})
    }
  }, [data])

  const patch = (i: number, p: Partial<UserAgentCfg>) => {
    setList((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)))
    setDirty(true)
  }

  const add = () => {
    const used = new Set(list.map((a) => a.backend))
    const backend = BACKEND_OPTIONS.find((b) => !used.has(b)) ?? 'claude'
    setList((l) => [...l, { backend, execPath: DEFAULT_EXEC[backend] ?? '', argsTemplate: '', workDir: '', envVars: '', enabled: true }])
    setDirty(true)
  }

  const remove = (i: number) => {
    setList((l) => l.filter((_, j) => j !== i))
    setDirty(true)
  }

  /** 拖拽换位：dragEnter 时实时交换，松手即定序 */
  const dragEnter = (i: number) => {
    if (dragIdx === null || dragIdx === i) return
    setList((l) => {
      const next = [...l]
      const [moved] = next.splice(dragIdx, 1)
      next.splice(i, 0, moved)
      return next
    })
    setDragIdx(i)
    setDirty(true)
  }

  const save = async () => {
    if (!empNo) return
    const invalid = list.find((a) => a.enabled && !a.execPath?.trim())
    if (invalid) { toast(`「${BACKEND_NAMES[invalid.backend] ?? invalid.backend}」已启用但未填 CLI 路径`); return }
    setSaving(true)
    try {
      const r = await saveProfileAgents(empNo, list)
      setDirty(false)
      reload()
      toast(`${profileSaveHint(r)}，优先级即列表顺序`)
      onSaved?.(r)
    } catch (e) {
      toast(`保存失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  const test = async (i: number) => {
    if (!empNo) return
    const a = list[i]
    if (!a.execPath?.trim()) { toast('先填 CLI 路径再测试'); return }
    setProbing(i)
    try {
      const r = await probeAgent(empNo, a)
      setResults((prev) => ({ ...prev, [i]: r }))
    } catch (e) {
      setResults((prev) => ({ ...prev, [i]: { ok: false, message: e instanceof Error ? e.message : String(e) } }))
    } finally {
      setProbing(null)
    }
  }

  return (
    <div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '0 0 12px', lineHeight: 1.7 }}>
        {desc ?? DEFAULT_DESC}
      </div>

      {initialLoading && (
        <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: '10px 0' }}>读取配置中…</div>
      )}

      {!initialLoading && list.length === 0 && (
        <div style={{
          border: '1px dashed var(--line)', borderRadius: 10, padding: '20px 16px',
          textAlign: 'center', fontSize: 12.5, color: 'var(--ink-4)', marginBottom: 10,
        }}>
          还没有配置任何后端。点下方「添加后端」开始配置。
        </div>
      )}

      {!initialLoading && list.map((a, i) => {
        const r = results[i]
        return (
          <div
            key={`${a.backend}-${i}`}
            draggable
            onDragStart={() => setDragIdx(i)}
            onDragEnter={() => dragEnter(i)}
            onDragOver={(e) => e.preventDefault()}
            onDragEnd={() => setDragIdx(null)}
            className="ua-item"
            style={{
              border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', marginBottom: 10,
              background: 'var(--surface)', opacity: dragIdx === i ? 0.55 : 1,
              transition: 'opacity .15s', cursor: 'grab',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--ink-4)', fontSize: 14, letterSpacing: 1 }} title="拖拽排序">⠿</span>
              <span className="ua-order">{i + 1}</span>
              <Dropdown value={a.backend} width={180} disabled={!a.enabled}
                options={[
                  ...BACKEND_OPTIONS.map((b) => ({ v: b, l: BACKEND_NAMES[b] ?? b, i: <BrandMark backend={b} size={16} /> })),
                  ...(!BACKEND_OPTIONS.includes(a.backend) ? [{ v: a.backend, l: a.backend }] : []),
                ]}
                onChange={(nb) => {
                  // 换后端时若 CLI 路径为空或恰好是另一个后端的默认命令，自动带出默认值
                  const prevDefault = Object.values(DEFAULT_EXEC).includes(a.execPath ?? '')
                  patch(i, { backend: nb, execPath: !a.execPath?.trim() || prevDefault ? (DEFAULT_EXEC[nb] ?? a.execPath ?? '') : a.execPath })
                }}
              />
              <span style={{
                flex: 1, minWidth: 120, fontSize: 11.5, color: 'var(--ink-4)', fontFamily: 'var(--mono)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }} title={a.execPath || a.backend}>
                {a.execPath || a.backend}{a.model ? ` · ${a.model}` : ''}
              </span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 400, color: 'var(--ink-2)' }}>
                <Switch on={a.enabled} onClick={() => patch(i, { enabled: !a.enabled })} />
                启用
              </label>
              <button className="btn btn-sm btn-outline" disabled={probing === i} onClick={() => test(i)}
                title="在绑定的客户端本机执行 <CLI> --version">
                <Icon name="bolt" size={14} />{probing === i ? '测试中…' : '测试'}
              </button>
              <button className="btn btn-sm btn-outline" onClick={() => setEditing(i)}
                title="配置执行参数">
                <Icon name="settings" size={13} />配置
              </button>
              <button className="iconbtn" onClick={() => remove(i)} title="删除">
                <Icon name="trash" size={15} />
              </button>
            </div>

            {r && <ProbeView r={r} />}
          </div>
        )
      })}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
        <button className="btn btn-outline btn-sm" onClick={add}><Icon name="plus" size={14} />添加后端</button>
        <div style={{ flex: 1 }} />
        {dirty && <span style={{ fontSize: 12, color: 'var(--warn)', alignSelf: 'center' }}>有未保存的修改</span>}
        <button className="btn btn-primary btn-sm" disabled={saving || !dirty} onClick={save}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {editing !== null && list[editing] && (() => {
        const a = list[editing]
        const i = editing
        return (
          <Modal
            title={`配置执行方式 · ${BACKEND_NAMES[a.backend] ?? a.backend}`}
            width={640}
            onClose={() => setEditing(null)}
            footer={<button className="btn btn-sm btn-primary" onClick={() => setEditing(null)}>完成</button>}
          >
            <div className="grid g2" style={{ gap: 14 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>CLI 路径 (execPath)</label>
                <input value={a.execPath ?? ''} placeholder="命令名或完整路径，如 buddycn / claude"
                  onChange={(e) => patch(i, { execPath: e.target.value })} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>工作目录 (workDir)</label>
                <input value={a.workDir ?? ''} placeholder="留空 = 仓库根"
                  onChange={(e) => patch(i, { workDir: e.target.value })} />
              </div>
            </div>

            <div className="field">
              <label>启动参数模板 (argsTemplate)</label>
              <input value={a.argsTemplate ?? ''} placeholder={'-p "{prompt}" --cwd {repo}'}
                onChange={(e) => patch(i, { argsTemplate: e.target.value })} />
            </div>

            <div className="grid g2" style={{ gap: 14 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>模型 (model)</label>
                <input value={a.model ?? ''} placeholder="留空 = 沿用客户端默认，如 claude-sonnet-4-5"
                  onChange={(e) => patch(i, { model: e.target.value })} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>单日 token 限额</label>
                <div className="inp-unit">
                  <input type="number" min={0} value={a.tokenLimit ?? ''} placeholder="留空 = 不限，如 200000"
                    onChange={(e) => patch(i, { tokenLimit: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  <span className="unit">tokens / 日</span>
                </div>
                <div className="hint">填写后覆盖该后端的每日 token 上限；留空表示不限制。</div>
              </div>
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <label>环境变量 (envVars)</label>
              <input value={a.envVars ?? ''} placeholder="KEY=VALUE;KEY2=VALUE2"
                onChange={(e) => patch(i, { envVars: e.target.value })} />
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <label>客户端实际执行</label>
              <div className="codeblk" style={{ maxHeight: 130 }}>{uaCmdPreview(a)}</div>
            </div>

            <div style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.7 }}>
              占位符 {'{prompt} {repo} {branch} {model}'} 由客户端在收到任务时注入；非空字段随下发配置覆盖客户端
              agent.yml 的同名默认值，留空则沿用本地默认。
              修改即时反映到列表，点面板底部「保存」后才写入服务端并下发给绑定客户端。
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}
