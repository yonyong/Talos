import { useMemo, useState } from 'react'
import { Icon } from '../icons'
import { Empty, Modal, PageH, Panel, Search, Tag, useToast } from '../ui'
import { deletePrompt, fetchPrompts, savePrompt, useAsync } from '../api'
import type { PromptTemplate } from '../types'

/** 从正文里抠出 {{var}} 占位符 */
function usedVars(content: string): string[] {
  const set = new Set<string>()
  const re = /\{\{\s*([\w.]+)\s*\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content || '')) !== null) set.add(m[1])
  return [...set]
}

/** 声明的变量串 → 数组 */
function declaredVars(vars: string): string[] {
  return (vars || '').split(/[,，、;；\s]+/).map((s) => s.trim()).filter(Boolean)
}

const EMPTY: PromptTemplate = { name: '', scene: '', backend: '服务端LLM', vars: '', content: '', updated: '—' }

const SCENES = ['准入判定', '业务域分拣 · 歧义裁决', '工作流闸门判定', '需求分析 · 概要文档', '详细设计', '问题分析 · 故障报告']

export default function Prompts() {
  const { toast } = useToast()
  const { data, loading, reload } = useAsync<PromptTemplate[]>(() => fetchPrompts(), [])
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<PromptTemplate | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PromptTemplate | null>(null)
  const [saving, setSaving] = useState(false)

  const list = data ?? []
  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return list.filter((t) => !kw
      || t.name.toLowerCase().includes(kw) || t.scene.toLowerCase().includes(kw)
      || t.backend.toLowerCase().includes(kw) || t.vars.toLowerCase().includes(kw))
  }, [list, q])

  const submit = async () => {
    if (!draft) return
    if (!draft.name.trim()) { toast('模板名称为必填'); return }
    if (!/\.md$/.test(draft.name.trim())) { toast('模板名建议以 .md 结尾，例如 admission_judge.md'); return }
    setSaving(true)
    try {
      await savePrompt({
        id: draft.id, name: draft.name.trim(), scene: draft.scene.trim(),
        backend: draft.backend.trim(), vars: draft.vars.trim(), content: draft.content ?? '',
      })
      setDraft(null)
      reload()
      toast(`${draft.name.trim()} 已保存`)
    } catch (e) {
      toast(`保存失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete?.id) { toast('该模板缺少 id，无法删除'); setPendingDelete(null); return }
    setSaving(true)
    try {
      await deletePrompt(pendingDelete.id)
      toast(`${pendingDelete.name} 已删除`)
      setPendingDelete(null)
      reload()
    } catch (e) {
      toast(`删除失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  // 变量一致性：正文用到的 vs 声明的
  const used = draft ? usedVars(draft.content ?? '') : []
  const declared = draft ? declaredVars(draft.vars) : []
  const missing = used.filter((u) => !declared.includes(u))
  const unused = declared.filter((d) => !used.includes(d))

  return (
    <div>
      <PageH
        title="Prompt 模板"
        desc="所有节点 Prompt 都来自这里，变量由系统注入，禁止在代码里硬编码。模板落库后即时生效，客户端与工作流引擎都读同一份。"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setDraft({ ...EMPTY })}>
            <Icon name="plus" size={15} />新建模板
          </button>
        }
      />

      <Panel
        title="模板列表"
        sub={`共 ${shown.length} 个`}
        flush
        actions={<Search placeholder="搜索名称 / 场景 / 后端 / 变量" value={q} onChange={setQ} />}
      >
        {loading && list.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>}
        {!loading && data === null && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>接口请求失败，请确认后端已启动（:8080）</div>}
        {!loading && data !== null && (shown.length === 0 ? <Empty text="还没有模板" /> : (
          <table>
            <thead>
              <tr>
                <th>模板</th><th>场景</th><th>默认后端</th><th>注入变量</th><th>更新</th>
                <th style={{ textAlign: 'right', paddingRight: 14 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id ?? t.name}>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 550 }}>{t.name}</td>
                  <td>{t.scene}</td>
                  <td><Tag tone={t.backend === '服务端LLM' ? 'info' : 'mut'}>{t.backend}</Tag></td>
                  <td style={{ maxWidth: 300, fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-3)' }}
                    title={t.vars}>
                    {(t.vars || '—').slice(0, 46)}{(t.vars || '').length > 46 ? '…' : ''}
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{t.updated}</td>
                  <td style={{ textAlign: 'right', paddingRight: 14, whiteSpace: 'nowrap' }}>
                    <button className="btn btn-xs btn-outline" style={{ marginRight: 6 }} onClick={() => setDraft({ ...t })}>
                      <Icon name="edit" size={13} />编辑
                    </button>
                    <button className="btn btn-xs btn-outline" onClick={() => setPendingDelete(t)}>
                      <Icon name="trash" size={13} />删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </Panel>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 12.5, color: 'var(--ink-4)' }}>
        <Icon name="info" size={14} /> 模板正文用 {'{{变量名}}'} 占位。渲染失败时按空串注入，所以变量声明与正文必须保持一致。
      </div>

      {draft && (
        <Modal
          title={draft.id ? `编辑模板 · ${draft.name}` : '新建 Prompt 模板'}
          width={860}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button className="btn btn-sm" onClick={() => setDraft(null)}>取消</button>
              <button className="btn btn-primary btn-sm" disabled={saving} onClick={submit}>
                {saving ? '保存中…' : '保存'}
              </button>
            </>
          }
        >
          <div className="grid g3" style={{ gap: 14 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>模板名称（唯一，建议 .md 结尾）</label>
              <input value={draft.name} placeholder="admission_judge.md"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>场景</label>
              <input value={draft.scene} list="prompt-scenes" placeholder="准入判定"
                onChange={(e) => setDraft({ ...draft, scene: e.target.value })} />
              <datalist id="prompt-scenes">
                {SCENES.map((s) => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>默认后端</label>
              <input value={draft.backend} list="prompt-backends" placeholder="服务端LLM / codebuddy / 责任人选定"
                onChange={(e) => setDraft({ ...draft, backend: e.target.value })} />
              <datalist id="prompt-backends">
                <option value="服务端LLM" /><option value="codebuddy" /><option value="责任人选定" /><option value="claude" />
              </datalist>
            </div>
          </div>

          <div className="field">
            <label>注入变量（逗号分隔，声明用途与审计口径）</label>
            <input value={draft.vars} placeholder="issue.code,issue.title,issue.desc,kb.hits"
              onChange={(e) => setDraft({ ...draft, vars: e.target.value })} />
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label>模板正文（{'{{变量名}}'} 占位）</label>
            <textarea
              rows={16}
              value={draft.content ?? ''}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              style={{ fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.7 }}
              placeholder={'你是研发需求评审助手。\n\n【编号】{{issue.code}}\n【标题】{{issue.title}}\n\n输出格式（严格遵守）：\n结论：admit 或 reject\n理由：一句话说明理由'}
            />
          </div>

          {(missing.length > 0 || unused.length > 0) && (
            <div style={{ marginTop: 12, padding: '10px 14px', border: '1px solid var(--line)', borderRadius: 10, fontSize: 12.5, lineHeight: 1.8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Icon name="warn" size={14} />
                <strong>变量声明与正文不一致</strong>
              </div>
              {missing.length > 0 && (
                <div style={{ color: 'var(--ink-3)' }}>
                  正文用到但未声明：{missing.map((v) => <code key={v} style={{ marginRight: 6 }}>{v}</code>)}
                </div>
              )}
              {unused.length > 0 && (
                <div style={{ color: 'var(--ink-3)' }}>
                  已声明但正文未使用：{unused.map((v) => <code key={v} style={{ marginRight: 6 }}>{v}</code>)}
                </div>
              )}
            </div>
          )}

          {used.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-4)' }}>
              正文共引用 {used.length} 个变量：{used.join('、')}
            </div>
          )}
        </Modal>
      )}

      {pendingDelete && (
        <Modal
          title="删除 Prompt 模板"
          width={460}
          onClose={() => setPendingDelete(null)}
          footer={
            <>
              <button className="btn btn-sm" onClick={() => setPendingDelete(null)}>取消</button>
              <button className="btn btn-primary btn-sm" disabled={saving} onClick={confirmDelete}>
                {saving ? '处理中…' : '确认删除'}
              </button>
            </>
          }
        >
          <div style={{ fontSize: 13.5, lineHeight: 1.8 }}>
            即将删除模板 <strong>{pendingDelete.name}</strong>。
            <div style={{ color: 'var(--ink-3)', marginTop: 8 }}>
              若该模板仍被工作流节点引用，删除会被拒绝——避免实例推进到该节点时渲染出空模板。
              请先在工作流编排里改掉节点再回来删除。
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
