import { useMemo, useState } from 'react'
import { Icon } from '../icons'
import { Modal, PageH, Panel, Tag, useToast } from '../ui'
import { fetchWorkflowTemplates, saveWorkflowTemplate, useAsync } from '../api'
import type { NodeKind, WorkflowNode } from '../types'

const iconOf: Record<NodeKind, string> = { git: 'git', doc: 'doc', code: 'code', test: 'test', rev: 'review' }

function Pipe({ nodes }: { nodes: WorkflowNode[] }) {
  return (
    <div className="wf-flow">
      {nodes.map((n) => (
        <div key={n.step} className={`wf-node n-${n.kind}`}>
          <div className="ndot"><Icon name={iconOf[n.kind]} size={24} /></div>
          <div className="nstep">{`STEP 0${n.step}`}</div>
          <div className="ntext">{n.name}</div>
          <div className="ntag">{n.tag}</div>
        </div>
      ))}
    </div>
  )
}

const BACKENDS = ['—', 'codebuddy', 'claude', 'cursor', 'codex', '责任人选定', '服务端LLM']
const KINDS: { k: NodeKind; l: string }[] = [
  { k: 'git', l: 'Git' }, { k: 'doc', l: '文档' }, { k: 'code', l: '编码' },
  { k: 'test', l: '测试' }, { k: 'rev', l: '评审' },
]

function NodeTable({ nodes, onEdit }: { nodes: WorkflowNode[]; onEdit: (n: WorkflowNode) => void }) {
  return (
    <table>
      <thead>
        <tr><th>步骤</th><th>节点</th><th>类型</th><th>执行位置</th><th>Coding Agent</th><th>模型 / 温度</th><th>Prompt 模板</th><th>闸门 / 工具</th><th></th></tr>
      </thead>
      <tbody>
        {nodes.map((n) => (
          <tr key={n.step}>
            <td className="tid">0{n.step}</td>
            <td>{n.name}</td>
            <td><Tag tone={n.kind === 'code' ? 'info' : n.kind === 'test' ? 'ok' : n.kind === 'rev' ? 'warn' : 'mut'}>{n.tag}</Tag></td>
            <td>{n.exec}</td>
            <td>{n.backend}</td>
            <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{n.model ? `${n.model} · ${n.temperature ?? 0.7}` : '—'}</td>
            <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{n.prompt}</td>
            <td>{n.gate === '—' && !n.tools ? <span style={{ color: 'var(--ink-4)' }}>—</span> : <Tag tone="warn">{n.tools || n.gate}</Tag>}</td>
            <td><button className="btn btn-xs btn-outline" onClick={() => onEdit(n)}>编辑</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function emptyNode(step: number): WorkflowNode {
  return { step, name: '', kind: 'doc', tag: 'DOC', exec: '客户端', backend: '—', prompt: '—', gate: '—' }
}

export default function Workflow() {
  const { toast } = useToast()
  const [tab, setTab] = useState<'req' | 'bug'>('req')
  const { data, loading, reload } = useAsync<{ REQ: WorkflowNode[]; BUG: WorkflowNode[] }>(() => fetchWorkflowTemplates(), [])
  const [editing, setEditing] = useState<WorkflowNode | null>(null)
  const [saving, setSaving] = useState(false)

  const tabCode = tab === 'req' ? 'REQ' : 'BUG'
  const nodes = useMemo(() => (data?.[tabCode] ?? []).filter((n) => n.step > 0 || n.name), [data, tabCode])

  const commit = async (updated: WorkflowNode) => {
    if (!data) return
    setSaving(true)
    try {
      const next = nodes.map((n) => (n.step === updated.step ? updated : n))
      await saveWorkflowTemplate(tabCode, next)
      reload()
      setEditing(null)
      toast(`节点 ${updated.name} 已保存`)
    } catch (e) {
      toast(`保存失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageH
        title="工作流编排"
        desc="需求与缺陷的标准链路，逐节点配置执行位置、Coding Agent 后端、LLM 参数与 Prompt 模板。"
        actions={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => toast('已克隆模板')}>克隆模板</button>
            <button className="btn btn-primary btn-sm" onClick={() => toast('已进入编辑器')}>新建模板</button>
          </>
        }
      />

      <div className="seg" style={{ marginBottom: 18 }}>
        <button className={tab === 'req' ? 'on' : ''} onClick={() => setTab('req')}>需求模板 · REQ</button>
        <button className={tab === 'bug' ? 'on' : ''} onClick={() => setTab('bug')}>缺陷模板 · BUG</button>
      </div>

      {loading && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>}
      {!loading && data === null && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>接口请求失败，请确认后端已启动（:8080）</div>}

      {!loading && data !== null && (
        <>
          <Panel
            title={tab === 'req' ? '需求工作流' : '缺陷工作流'}
            sub={tab === 'req' ? 'REQ · 从诉求到验收 · langchain4j 编排' : 'BUG · 从定位到修复 · langchain4j 编排'}
          >
            <Pipe nodes={nodes} />
            <div style={{ marginTop: 26, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {tab === 'req' ? (
                <>
                  <Tag tone="info">文档节点 → CodeBuddy（私有化）</Tag>
                  <Tag tone="mut">编码节点 → 责任人选定后端</Tag>
                  <Tag tone="warn">评审 / 验收 → 人工闸门</Tag>
                </>
              ) : (
                <>
                  <Tag tone="err">缺陷 → 敏感仓库强制私有化</Tag>
                  <Tag tone="warn">评审 → 人工闸门</Tag>
                  <Tag tone="mut">测试 → 覆盖率门禁 80%</Tag>
                </>
              )}
            </div>
          </Panel>

          <div style={{ marginTop: 18 }}>
            <Panel title="节点配置" sub="执行位置决定该节点由服务端调度还是下发客户端；点击编辑可改 LLM 参数" flush>
              {nodes.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>暂无节点定义</div>
              ) : (
                <NodeTable nodes={nodes} onEdit={setEditing} />
              )}
            </Panel>
          </div>
        </>
      )}

      {editing && (
        <NodeEditor
          node={editing}
          onClose={() => setEditing(null)}
          onSave={commit}
          saving={saving}
        />
      )}
    </div>
  )
}

function NodeEditor({ node, onClose, onSave, saving }: { node: WorkflowNode; onClose: () => void; onSave: (n: WorkflowNode) => void; saving: boolean }) {
  const [form, setForm] = useState<WorkflowNode>(() => ({ ...node }))

  return (
    <Modal
      title={`编辑节点 · STEP 0${form.step} · ${form.name}`}
      width={720}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline btn-sm" onClick={onClose} disabled={saving}>取消</button>
          <button className="btn btn-primary btn-sm" onClick={() => onSave(form)} disabled={saving}>{saving ? '保存中…' : '保存节点'}</button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        <div className="field">
          <label>节点名称</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <label>节点类型</label>
          <select value={form.kind} onChange={(e) => {
            const kind = e.target.value as NodeKind
            setForm({ ...form, kind, tag: kind.toUpperCase() })
          }}>
            {KINDS.map((k) => <option key={k.k} value={k.k}>{k.l}</option>)}
          </select>
        </div>
        <div className="field">
          <label>执行位置</label>
          <select value={form.exec} onChange={(e) => setForm({ ...form, exec: e.target.value as WorkflowNode['exec'] })}>
            <option>客户端</option><option>服务端</option>
          </select>
        </div>
        <div className="field">
          <label>Coding Agent 后端</label>
          <select value={form.backend} onChange={(e) => setForm({ ...form, backend: e.target.value })}>
            {BACKENDS.map((b) => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div className="field">
          <label>模型 (model)</label>
          <input value={form.model ?? ''} onChange={(e) => setForm({ ...form, model: e.target.value || undefined })} placeholder="如 gpt-4o / claude-opus-4" />
        </div>
        <div className="field">
          <label>温度 (temperature)</label>
          <input type="number" step="0.1" min="0" max="2" value={form.temperature ?? ''} onChange={(e) => setForm({ ...form, temperature: e.target.value ? parseFloat(e.target.value) : undefined })} />
        </div>
        <div className="field">
          <label>最大 Token (maxTokens)</label>
          <input type="number" value={form.maxTokens ?? ''} onChange={(e) => setForm({ ...form, maxTokens: e.target.value ? parseInt(e.target.value) : undefined })} />
        </div>
        <div className="field">
          <label>闸门 / 工具 (gate / tools)</label>
          <input value={form.tools ?? form.gate} onChange={(e) => setForm({ ...form, gate: e.target.value, tools: e.target.value })} />
        </div>
      </div>
      <div className="field" style={{ marginTop: 6 }}>
        <label>Prompt 模板</label>
        <input value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="模板文件名或模板内容标识" />
      </div>
      <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.6 }}>
        提示：服务端采用 langchain4j 编排，节点保存后会更新模板 JSON 中的 model / temperature / maxTokens / tools 等字段，并在下发客户端时注入。
      </div>
    </Modal>
  )
}
