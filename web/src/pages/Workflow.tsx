import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../icons'
import { Modal, PageH, Panel, Tag, useToast } from '../ui'
import { fetchWorkflowTemplates, saveWorkflowTemplate, useAsync } from '../api'
import WfGraph from '../wfgraph'
import type { NodeKind, WorkflowEdge, WorkflowGraph, WorkflowNode } from '../types'

const BACKENDS = ['—', 'codebuddy', 'claude', 'cursor', 'codex', '责任人选定', '服务端LLM']
const KINDS: { k: NodeKind; l: string }[] = [
  { k: 'git', l: 'Git' }, { k: 'doc', l: '文档' }, { k: 'code', l: '编码' },
  { k: 'test', l: '测试' }, { k: 'rev', l: '评审' },
]

/** 条件边预设：点击即填入条件输入框，也可手写表达式 */
const COND_PRESETS: { v: string; l: string }[] = [
  { v: 'always', l: '默认' },
  { v: 'gate:pass', l: '闸门通过' },
  { v: 'gate:blocked', l: '闸门驳回' },
  { v: 'success', l: '执行成功' },
  { v: 'failed', l: '执行失败' },
  { v: 'expr:issue.priority == P0', l: '仅 P0' },
  { v: 'expr:issue.priority in P1,P2', l: '非 P0' },
  { v: 'expr:issue.type == BUG', l: '仅缺陷' },
]

const emptyNode = (step: number): WorkflowNode => ({
  step, name: '', kind: 'doc', tag: 'DOC', exec: '客户端', backend: '—', prompt: '—', gate: '—',
})

export default function Workflow() {
  const { toast } = useToast()
  const [tab, setTab] = useState<'req' | 'bug'>('req')
  const { data, loading, reload } = useAsync<{ REQ: WorkflowGraph; BUG: WorkflowGraph }>(
    () => fetchWorkflowTemplates(), [])
  const [graph, setGraph] = useState<WorkflowGraph>({ nodes: [], edges: [] })
  const [editing, setEditing] = useState<WorkflowNode | null>(null)
  const [editingEdge, setEditingEdge] = useState<{ edge: WorkflowEdge; index: number } | null>(null)
  const [saving, setSaving] = useState(false)

  const tabCode: 'REQ' | 'BUG' = tab === 'req' ? 'REQ' : 'BUG'

  useEffect(() => {
    if (!data) return
    setGraph(data[tabCode] ?? { nodes: [], edges: [] })
  }, [data, tabCode])

  /** 与服务端返回的图做对比，判断是否有未保存改动 */
  const dirty = useMemo(() => {
    if (!data) return false
    return JSON.stringify(graph) !== JSON.stringify(data[tabCode] ?? { nodes: [], edges: [] })
  }, [graph, data, tabCode])

  const save = async () => {
    setSaving(true)
    try {
      await saveWorkflowTemplate(tabCode, graph)
      reload()
      toast(`${tabCode} 拓扑已保存 · ${graph.nodes.length} 节点 / ${graph.edges.length} 条件边`)
    } catch (e) {
      toast(`保存失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  /* ---------- 节点编辑 ---------- */
  const applyNode = (updated: WorkflowNode) => {
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.step === updated.step ? updated : n)) }))
    setEditing(null)
  }
  const addNode = () => {
    const step = graph.nodes.reduce((m, n) => Math.max(m, n.step), 0) + 1
    setGraph((g) => ({ ...g, nodes: [...g.nodes, emptyNode(step)] }))
    setEditing(emptyNode(step))
  }
  const removeNode = (step: number) => {
    setGraph((g) => ({
      nodes: g.nodes.filter((n) => n.step !== step),
      edges: g.edges.filter((e) => e.from !== step && e.to !== step),
    }))
    setEditing(null)
    toast(`已删除节点 ${step} 及其相关连线（未保存）`)
  }

  /* ---------- 条件边编辑 ---------- */
  const applyEdge = (edge: WorkflowEdge) => {
    setGraph((g) => {
      const edges = g.edges.slice()
      if (editingEdge && editingEdge.index >= 0) edges[editingEdge.index] = edge
      else edges.push(edge)
      return { ...g, edges }
    })
    setEditingEdge(null)
  }
  const removeEdge = (index: number) => {
    setGraph((g) => ({ ...g, edges: g.edges.filter((_, i) => i !== index) }))
  }
  const addEdge = () => {
    const first = graph.nodes[0]?.step ?? 1
    const second = graph.nodes[1]?.step ?? first
    setEditingEdge({ edge: { from: first, to: second, condition: 'always', label: '', kind: 'forward' }, index: -1 })
  }

  /** 点图上的连线或条件标签 → 打开该边的编辑弹窗（index<0 表示新建） */
  const openEdge = (edge: WorkflowEdge, index: number) => setEditingEdge({ edge: { ...edge }, index })

  return (
    <div>
      <PageH
        title="工作流编排"
        desc="DAG 图定义：节点 + 条件边。点击节点或连线即可编辑，悬停看详情；闸门结论与 Issue 上下文决定走哪条分支，回退边可把节点打回重做。"
        actions={
          <>
            {dirty && <Tag tone="warn" dot>有未保存改动</Tag>}
            <button
              className="btn btn-outline btn-sm" disabled={!dirty || saving}
              onClick={() => { if (data) setGraph(data[tabCode] ?? { nodes: [], edges: [] }); toast('已放弃未保存改动') }}
            >
              <Icon name="refresh" size={14} />放弃修改
            </button>
            <button className="btn btn-primary btn-sm" disabled={!dirty || saving} onClick={save}>
              <Icon name="check" size={15} />{saving ? '保存中…' : '保存拓扑'}
            </button>
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
            sub="点击节点或连线编辑配置，悬停查看详情 · 服务端自研 DAG 引擎，LLM 只做闸门判定不参与选路"
            actions={
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-xs btn-outline" onClick={addNode}>
                  <Icon name="plus" size={13} />新建节点
                </button>
                <button className="btn btn-xs btn-outline" onClick={addEdge} disabled={graph.nodes.length < 2}>
                  <Icon name="plus" size={13} />新建连线
                </button>
              </div>
            }
          >
            {graph.nodes.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>暂无节点定义</div>
            ) : (
              <WfGraph
                nodes={graph.nodes}
                edges={graph.edges}
                onNodeClick={setEditing}
                onEdgeClick={openEdge}
                scale={1.35}
                minHeight={480}
              />
            )}
          </Panel>

          <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.8 }}>
            条件写法：<code style={{ fontFamily: 'var(--mono)' }}>always</code> ·
            <code style={{ fontFamily: 'var(--mono)', margin: '0 4px' }}>gate:pass</code> /
            <code style={{ fontFamily: 'var(--mono)', margin: '0 4px' }}>gate:blocked</code> ·
            <code style={{ fontFamily: 'var(--mono)', margin: '0 4px' }}>success</code> /
            <code style={{ fontFamily: 'var(--mono)', margin: '0 4px' }}>failed</code> ·
            表达式 <code style={{ fontFamily: 'var(--mono)' }}>expr:issue.priority == P0 &amp;&amp; gate == pass</code>
            （支持 <code style={{ fontFamily: 'var(--mono)' }}>&amp;&amp; || ! ( ) == != in</code>，变量含
            issue.priority / issue.type / issue.biz / issue.owner / result / gate / round）。
            解析不出时按「条件不成立」处理，分支走空即转人工，不会静默放行。
          </div>
        </>
      )}

      {editing && (
        <NodeEditor
          node={editing}
          usedSteps={graph.nodes.map((n) => n.step)}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={applyNode}
          onDelete={graph.nodes.length > 1 ? () => removeNode(editing.step) : undefined}
        />
      )}

      {editingEdge && (
        <EdgeEditor
          edge={editingEdge.edge}
          nodes={graph.nodes}
          isNew={editingEdge.index < 0}
          onClose={() => setEditingEdge(null)}
          onSave={applyEdge}
          onDelete={editingEdge.index >= 0 ? () => {
            removeEdge(editingEdge.index)
            setEditingEdge(null)
            toast('已删除连线（未保存）')
          } : undefined}
        />
      )}
    </div>
  )
}

/* ============================ 节点编辑 ============================ */
function NodeEditor({
  node, usedSteps, saving, onClose, onSave, onDelete,
}: {
  node: WorkflowNode; usedSteps: number[]; saving: boolean
  onClose: () => void; onSave: (n: WorkflowNode) => void; onDelete?: () => void
}) {
  const [form, setForm] = useState<WorkflowNode>(() => ({ ...node }))
  const stepTaken = usedSteps.filter((s) => s !== node.step).includes(form.step)
  const nameOk = form.name.trim().length > 0
  /** 机械节点（Git 等）：不接 Coding Agent 后端，也不该有 Prompt 模板 */
  const mechanical = form.kind === 'git'

  return (
    <Modal
      title={`编辑节点 · STEP ${String(form.step).padStart(2, '0')}${node.name ? ` · ${node.name}` : ''}`}
      width={720}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button className="btn btn-outline btn-sm" onClick={onDelete} style={{ marginRight: 'auto', color: 'var(--err)' }}>
              <Icon name="trash" size={14} />删除节点
            </button>
          )}
          <button className="btn btn-outline btn-sm" onClick={onClose} disabled={saving}>取消</button>
          <button className="btn btn-primary btn-sm" onClick={() => onSave(form)} disabled={saving || !nameOk || stepTaken}>确认</button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        <div className="field">
          <label>步骤号（节点唯一标识，连线按它引用）</label>
          <input
            type="number" min="1" value={form.step}
            onChange={(e) => setForm({ ...form, step: parseInt(e.target.value || '1', 10) })}
          />
          {stepTaken && <div style={{ fontSize: 11.5, color: 'var(--err)', marginTop: 6 }}>该步骤号已被占用</div>}
        </div>
        <div className="field">
          <label>节点名称</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 设计评审" />
        </div>
        <div className="field">
          <label>节点类型</label>
          <select
            value={form.kind}
            onChange={(e) => {
              const k = e.target.value as NodeKind
              // Git 是机械节点：不接后端、不要 Prompt 模板，切过去就把这两个字段归位，
              // 免得存成「看起来配了 AI，实际不该有 AI」的空壳配置
              setForm(k === 'git' ? { ...form, kind: k, backend: '—', prompt: '—' } : { ...form, kind: k })
            }}
          >
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
          <select value={form.backend} disabled={mechanical}
            onChange={(e) => setForm({ ...form, backend: e.target.value })}>
            {BACKENDS.map((b) => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div className="field">
          <label>闸门（非空即触发服务端 LLM 判定）</label>
          <input value={form.gate === '—' ? '' : form.gate} placeholder="如 人工闸门 / 覆盖率门禁，留空表示无闸门"
            onChange={(e) => setForm({ ...form, gate: e.target.value || '—' })} />
        </div>
      </div>
      <div className="field" style={{ marginTop: 6 }}>
        <label>Prompt 模板</label>
        <input value={form.prompt} disabled={mechanical} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="模板文件名" />
      </div>
      {mechanical && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginTop: 14, borderRadius: 10, background: 'var(--warn-soft)', color: 'var(--warn)', fontSize: 12.5, lineHeight: 1.7 }}>
          <Icon name="warn" size={15} />
          机械节点：客户端只做确定性操作（clone / fetch / 切工作分支），不调用 Coding Agent、
          不产生 AI 调用日志。仓库准备过程以执行日志回传，可在节点详情里查看。
        </div>
      )}
      <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.7 }}>
        闸门判定由服务端 LLM 完成，结论写回节点的 gateResult，条件边用
        <code style={{ fontFamily: 'var(--mono)', margin: '0 4px' }}>gate:pass</code> /
        <code style={{ fontFamily: 'var(--mono)', margin: '0 4px' }}>gate:blocked</code> 选路；
        图遍历与选路由服务端自研引擎完成，与 langchain4j 无关。
      </div>
    </Modal>
  )
}

/* ============================ 条件边编辑 ============================ */
function EdgeEditor({
  edge, nodes, isNew, onClose, onSave, onDelete,
}: {
  edge: WorkflowEdge; nodes: WorkflowNode[]; isNew: boolean
  onClose: () => void; onSave: (e: WorkflowEdge) => void; onDelete?: () => void
}) {
  const [form, setForm] = useState<WorkflowEdge>(() => ({ ...edge }))
  const sameStep = form.from === form.to
  const target = nodes.find((n) => n.step === form.to)
  const loop = form.to <= form.from

  return (
    <Modal
      title={isNew ? '新建条件边' : `编辑条件边 · ${form.from} → ${form.to}`}
      width={640}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button className="btn btn-outline btn-sm" onClick={onDelete} style={{ marginRight: 'auto', color: 'var(--err)' }}>
              <Icon name="trash" size={14} />删除连线
            </button>
          )}
          <button className="btn btn-outline btn-sm" onClick={onClose}>取消</button>
          <button
            className="btn btn-primary btn-sm"
            disabled={sameStep}
            onClick={() => onSave({ ...form, condition: form.condition.trim() || 'always', kind: loop ? 'loopback' : 'forward' })}
          >
            确认
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        <div className="field">
          <label>源节点</label>
          <select value={form.from} onChange={(e) => setForm({ ...form, from: parseInt(e.target.value, 10) })}>
            {nodes.map((n) => <option key={n.step} value={n.step}>{n.step}. {n.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>目标节点</label>
          <select value={form.to} onChange={(e) => setForm({ ...form, to: parseInt(e.target.value, 10) })}>
            {nodes.map((n) => <option key={n.step} value={n.step}>{n.step}. {n.name}</option>)}
          </select>
        </div>
      </div>

      {sameStep && <div style={{ fontSize: 12.5, color: 'var(--err)', marginTop: 8 }}>不允许节点自环连线。</div>}

      {!sameStep && (
        <div style={{
          marginTop: 12, fontSize: 12.5, lineHeight: 1.7,
          border: `1px solid ${loop ? 'rgba(180,83,9,.28)' : 'var(--line)'}`,
          background: loop ? 'var(--warn-soft)' : 'var(--bg-subtle)',
          borderRadius: 9, padding: '10px 12px',
        }}>
          {loop ? (
            <>
              <b>回退重做边</b>：目标步骤 ≤ 源步骤，命中后会把「{target?.name ?? form.to} → {
                nodes.find((n) => n.step === form.from)?.name ?? form.from}」路径上的节点重置重做。
              轮次上限 3 轮，超限实例转阻塞待人工介入。
            </>
          ) : (
            <>前向边：源节点终结后按条件决定是否流转到 {target?.name ?? form.to}。</>
          )}
        </div>
      )}

      <div className="field" style={{ marginTop: 14 }}>
        <label>条件</label>
        <input
          value={form.condition}
          onChange={(e) => setForm({ ...form, condition: e.target.value })}
          placeholder="always / gate:pass / failed / expr:issue.priority == P0"
          style={{ fontFamily: 'var(--mono)' }}
        />
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {COND_PRESETS.map((p) => (
          <button
            key={p.v}
            className="btn btn-xs btn-outline"
            onClick={() => setForm({ ...form, condition: p.v })}
          >
            {p.l}
          </button>
        ))}
      </div>

      <div className="field" style={{ marginTop: 14 }}>
        <label>说明（显示在连线标签上，可空）</label>
        <input value={form.label ?? ''} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="如 评审通过 / 打回重做" />
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.75 }}>
        支持 <code style={{ fontFamily: 'var(--mono)' }}>always</code>、
        <code style={{ fontFamily: 'var(--mono)', margin: '0 4px' }}>gate:pass</code>/<code style={{ fontFamily: 'var(--mono)' }}>gate:blocked</code>、
        <code style={{ fontFamily: 'var(--mono)', margin: '0 4px' }}>success</code>/<code style={{ fontFamily: 'var(--mono)' }}>failed</code>，
        以及 <code style={{ fontFamily: 'var(--mono)' }}>expr:</code> 表达式（<code style={{ fontFamily: 'var(--mono)' }}>&amp;&amp; || ! ( ) == != in</code>）。
        变量：issue.priority、issue.type、issue.biz、issue.owner、result、gate、round。
      </div>
    </Modal>
  )
}
