import { useMemo, useState } from 'react'
import { Icon } from '../icons'
import { Chips, Empty, Modal, PageH, Panel, Search, Tag, useToast } from '../ui'
import { fetchIssues, createIssue, useAsync } from '../api'
import { statusMeta } from '../constants'
import type { Issue, PageKey } from '../types'

type Filter = 'all' | 'REQ' | 'BUG' | 'mine'

const WIZ_STEPS = ['基本信息', '诉求详情', '指派时限', '确认提交']

export default function Issues({ nav }: { nav: (p: PageKey) => void }) {
  const { toast } = useToast()
  const { data: list, loading, reload } = useAsync<Issue[]>(() => fetchIssues(), [])
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [view, setView] = useState<'list' | 'board'>('list')
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<Issue | null>(null)
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({
    biz: '行情', type: 'REQ', title: '', desc: '',
    reporter: '王磊', owner: '王磊', due: '', priority: 'P1',
  })
  const [saving, setSaving] = useState(false)

  const issues = list ?? []
  const counts = useMemo(() => ({
    all: issues.length,
    REQ: issues.filter((i) => i.type === 'REQ').length,
    BUG: issues.filter((i) => i.type === 'BUG').length,
    mine: issues.filter((i) => i.owner === '王磊').length,
  }), [issues])

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return issues
      .filter((i) => (filter === 'all' ? true : filter === 'mine' ? i.owner === '王磊' : i.type === filter))
      .filter((i) => !kw || i.title.toLowerCase().includes(kw) || i.id.toLowerCase().includes(kw) || i.owner.includes(kw) || i.reporter.includes(kw))
  }, [issues, filter, q])

  const submit = async () => {
    setSaving(true)
    try {
      const created = await createIssue({
        biz: form.biz, type: form.type, title: form.title || '未命名诉求',
        reporter: form.reporter, owner: form.owner, priority: form.priority,
        description: form.desc, dueDate: form.due || undefined, clientId: undefined,
      })
      setOpen(false)
      setStep(0)
      setForm({ biz: '行情', type: 'REQ', title: '', desc: '', reporter: '王磊', owner: '王磊', due: '', priority: 'P1' })
      reload()
      toast(`${created.id} 已提交 · 正在准入判定`)
    } catch (e) {
      toast(`提交失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  const columns: { k: Issue['status']; l: string }[] = [
    { k: 'admitting', l: '准入中' }, { k: 'sorting', l: '分拣中' },
    { k: 'running', l: '执行中' }, { k: 'reviewing', l: '评审待决' }, { k: 'done', l: '已验收' },
  ]

  return (
    <div>
      <PageH
        title="Issue"
        desc="所有录入的诉求与缺陷，录入后自动进入准入判定。"
        actions={<button className="btn btn-primary btn-sm" onClick={() => setOpen(true)} disabled={loading}><Icon name="plus" size={15} />新建 Issue</button>}
      />

      {loading && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>}
      {!loading && list === null && <Empty text="接口请求失败，请确认后端已启动（:8080）" />}

      {!loading && issues.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
            <Chips
              value={filter}
              onChange={setFilter}
              items={[
                { v: 'all', l: '全部', n: counts.all },
                { v: 'REQ', l: '需求', n: counts.REQ },
                { v: 'BUG', l: '缺陷', n: counts.BUG },
                { v: 'mine', l: '我的', n: counts.mine },
              ]}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <Search placeholder="搜索标题、ID、责任人、提出人" value={q} onChange={setQ} />
              <div className="seg">
                <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>列表</button>
                <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>看板</button>
              </div>
            </div>
          </div>

          {view === 'list' ? (
            <Panel title={`共 ${shown.length} 条`} flush>
              {shown.length === 0 ? <Empty text="没有符合条件的 Issue" /> : (
                <table>
                  <thead>
                    <tr><th>ID</th><th>标题</th><th>业务</th><th>类型</th><th>提出人</th><th>责任人</th><th>优先级</th><th>期望完成</th><th>状态</th></tr>
                  </thead>
                  <tbody>
                    {shown.map((i) => (
                      <tr key={i.id} onClick={() => setDetail(i)} style={{ cursor: 'pointer' }}>
                        <td className="tid">{i.id}</td>
                        <td>{i.title}</td>
                        <td>{i.biz}</td>
                        <td><Tag tone={i.type === 'REQ' ? 'info' : 'err'}>{i.type === 'REQ' ? '需求' : '缺陷'}</Tag></td>
                        <td>{i.reporter}</td>
                        <td>{i.owner}</td>
                        <td><span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{i.priority}</span></td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{i.due}</td>
                        <td><Tag tone={statusMeta[i.status].tone} dot>{statusMeta[i.status].l}</Tag></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(180px, 1fr))', gap: 14 }}>
              {columns.map((c) => {
                const items = shown.filter((i) => i.status === c.k)
                return (
                  <div key={c.k} className="panel">
                    <div className="panel-h" style={{ padding: '12px 14px' }}>
                      <h3 style={{ fontSize: 12.5 }}>{c.l}</h3>
                      <span className="tag t-mut">{items.length}</span>
                    </div>
                    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 120 }}>
                      {items.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-4)', textAlign: 'center', padding: '20px 0' }}>—</div>}
                      {items.map((i) => (
                        <div key={i.id} className="card" style={{ padding: 12, cursor: 'pointer' }} onClick={() => setDetail(i)}>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-4)' }}>{i.id}</div>
                          <div style={{ fontSize: 12.5, fontWeight: 550, marginTop: 6 }}>{i.title}</div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 11.5, color: 'var(--ink-4)' }}>
                            <span>提出：{i.reporter}</span><span>{i.due}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {open && (
            <Modal
              title="新建 Issue"
              onClose={() => setOpen(false)}
              footer={
                <>
                  <button className="btn btn-outline btn-sm" onClick={() => (step === 0 ? setOpen(false) : setStep(step - 1))} disabled={saving}>
                    {step === 0 ? '取消' : '上一步'}
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => (step === WIZ_STEPS.length - 1 ? submit() : setStep(step + 1))} disabled={saving}>
                    {saving ? '提交中…' : step === WIZ_STEPS.length - 1 ? '提交' : '下一步'}
                  </button>
                </>
              }
            >
              <div className="wiz-steps">
                {WIZ_STEPS.map((s, i) => (
                  <div key={s} className={`ws ${i === step ? 'on' : i < step ? 'done' : ''}`}>{`0${i + 1} · ${s}`}</div>
                ))}
              </div>

              {step === 0 && (
                <>
                  <div className="field">
                    <label>业务域</label>
                    <select value={form.biz} onChange={(e) => setForm({ ...form, biz: e.target.value })}>
                      {['行情', '回测', '指标', '账户', '资讯'].map((b) => <option key={b}>{b}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>诉求类型</label>
                    <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                      <option value="REQ">需求</option>
                      <option value="BUG">缺陷</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>标题</label>
                    <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="一句话描述诉求" />
                  </div>
                </>
              )}

              {step === 1 && (
                <>
                  <div className="field">
                    <label>详细描述</label>
                    <textarea rows={5} value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} placeholder="现象、影响范围、期望结果（缺陷请附复现步骤）" />
                  </div>
                  <div className="field">
                    <label>优先级</label>
                    <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                      <option>P0</option><option>P1</option><option>P2</option>
                    </select>
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <div className="field">
                    <label>提出人</label>
                    <input value={form.reporter} onChange={(e) => setForm({ ...form, reporter: e.target.value })} placeholder="录入人 / 提出人" />
                  </div>
                  <div className="field">
                    <label>责任人</label>
                    <select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
                      {['王磊', '李娜', '陈昊', '赵敏', '孙悦'].map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>期望完成时间</label>
                    <input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-4)', marginTop: 14, lineHeight: 1.6 }}>
                    选择业务域后系统会自动预填默认责任人；提交后将立即触发 AI 准入判定与项目分拣。
                  </div>
                </>
              )}

              {step === 3 && (
                <div className="codeblk">
                  {`{
  "biz": "${form.biz}",
  "type": "${form.type}",
  "title": "${form.title || '未命名诉求'}",
  "reporter": "${form.reporter}",
  "owner": "${form.owner}",
  "due": "${form.due || '—'}",
  "priority": "${form.priority}"
}`}
                </div>
              )}
            </Modal>
          )}

          {detail && (
            <Modal
              title={`${detail.id} · Issue 详情`}
              width={680}
              onClose={() => setDetail(null)}
              footer={<button className="btn btn-primary btn-sm" onClick={() => setDetail(null)}>关闭</button>}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 18, fontSize: 12.5 }}>
                <div><div style={{ color: 'var(--ink-4)' }}>业务域</div><div style={{ marginTop: 4, fontWeight: 550 }}>{detail.biz}</div></div>
                <div><div style={{ color: 'var(--ink-4)' }}>类型</div><div style={{ marginTop: 4 }}><Tag tone={detail.type === 'REQ' ? 'info' : 'err'}>{detail.type === 'REQ' ? '需求' : '缺陷'}</Tag></div></div>
                <div><div style={{ color: 'var(--ink-4)' }}>优先级</div><div style={{ marginTop: 4, fontFamily: 'var(--mono)' }}>{detail.priority}</div></div>
                <div><div style={{ color: 'var(--ink-4)' }}>提出人</div><div style={{ marginTop: 4, fontWeight: 550 }}>{detail.reporter}</div></div>
                <div><div style={{ color: 'var(--ink-4)' }}>责任人</div><div style={{ marginTop: 4, fontWeight: 550 }}>{detail.owner}</div></div>
                <div><div style={{ color: 'var(--ink-4)' }}>期望完成</div><div style={{ marginTop: 4, fontFamily: 'var(--mono)' }}>{detail.due}</div></div>
                <div><div style={{ color: 'var(--ink-4)' }}>状态</div><div style={{ marginTop: 4 }}><Tag tone={statusMeta[detail.status].tone} dot>{statusMeta[detail.status].l}</Tag></div></div>
                <div><div style={{ color: 'var(--ink-4)' }}>分拣项目</div><div style={{ marginTop: 4, fontWeight: 550 }}>{detail.project || '—'}</div></div>
                <div><div style={{ color: 'var(--ink-4)' }}>仓库</div><div style={{ marginTop: 4, fontFamily: 'var(--mono)', fontSize: 12 }}>{detail.repo || '—'}</div></div>
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label>标题</label>
                <div style={{ fontSize: 14, fontWeight: 550 }}>{detail.title}</div>
              </div>
              <div className="field">
                <label>详细描述</label>
                <div className="codeblk" style={{ maxHeight: 240 }}>{detail.desc || '（无详细描述）'}</div>
              </div>
            </Modal>
          )}

          <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--ink-4)' }}>
            提交后：AI 准入判定 → 项目分拣（识别仓库）→ 匹配工作流模板 → 下发至责任人客户端。
            <a style={{ color: 'var(--accent)', cursor: 'pointer', marginLeft: 8 }} onClick={() => nav('admission')}>查看判定队列 →</a>
          </div>
        </>
      )}
    </div>
  )
}
