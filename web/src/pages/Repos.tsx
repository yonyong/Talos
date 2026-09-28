import { useMemo, useState } from 'react'
import { Icon } from '../icons'
import { BRANDS, BrandMark } from '../brands'
import { Empty, Kpi, Modal, PageH, Panel, Search, Stepper, Switch, Tag, useToast } from '../ui'
import { deleteRepo, fetchBizTree, fetchClients, fetchRepos, saveRepo, useAsync } from '../api'
import type { BizTreeNode, ClientNode, Repo } from '../types'
import { BizTreeSelect, flatBiz } from '../components/BizTreeSelect'

const EMPTY: Repo = {
  project: '', bizCodes: [], repoUrl: '', baselineBranch: 'main', branchPrefix: 'feature/',
  language: 'Java', buildCmd: 'mvn -DskipTests package', testCmd: 'mvn test',
  sensitive: false, requiredBackend: '', enabled: true,
}
const BACKENDS = [
  { v: '', l: '不限制（按 Agent 配置）' },
  { v: 'claude', l: 'Claude Code（CLI）' },
  { v: 'cursor', l: 'Cursor（CLI）' },
  { v: 'codex', l: 'Codex（CLI）' },
  { v: 'codebuddy', l: 'CodeBuddy（内网 SDK）' },
]

export default function Repos() {
  const { toast } = useToast()
  const { data, loading, reload } = useAsync<Repo[]>(() => fetchRepos(), [])
  const { data: treeData } = useAsync<BizTreeNode[]>(() => fetchBizTree(), [])
  const { data: clientData } = useAsync<ClientNode[]>(() => fetchClients(), [])
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<Repo | null>(null)
  /** 编辑前仓库的项目名：业务域绑定的占用判断以它为准（编辑中改项目名不影响） */
  const [editProject, setEditProject] = useState('')
  const [step, setStep] = useState(0)
  const [pendingDelete, setPendingDelete] = useState<Repo | null>(null)
  const [saving, setSaving] = useState(false)

  const list = data ?? []
  const clientIds = useMemo(() => (clientData ?? []).map((c) => c.id).filter(Boolean), [clientData])
  const bizList = useMemo(() => flatBiz(treeData ?? []), [treeData])
  const bizName = (code: string) => bizList.find((b) => b.code === code)?.name ?? code

  /** 仓库 → 归属业务域列表（绑定存在业务域侧，反查得到） */
  const boundOf = (project?: string) =>
    project ? bizList.filter((b) => b.repoProject === project) : []

  const orphans = useMemo(
    () => bizList.filter((b) => b.enabled && !b.repoProject),
    [bizList],
  )

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return list
    return list.filter((r) => r.project.toLowerCase().includes(kw)
      || (r.repoUrl || '').toLowerCase().includes(kw)
      || boundOf(r.project).some((b) => b.code.toLowerCase().includes(kw) || b.name.toLowerCase().includes(kw)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, q, bizList])

  /** 编辑中已被其他仓库占用的业务域：树形多选里禁用并标注占用方 */
  const boundElsewhere = useMemo(() => {
    const m: Record<string, string> = {}
    for (const b of bizList) {
      if (b.repoProject && b.repoProject !== editProject) m[b.code] = b.repoProject
    }
    return m
  }, [bizList, editProject])

  const openDraft = (r: Repo | null) => {
    if (r) {
      setEditProject(r.project ?? '')
      setDraft({ ...r, bizCodes: boundOf(r.project).map((b) => b.code) })
    } else {
      setEditProject('')
      setDraft({ ...EMPTY, bizCodes: [] })
    }
    setStep(0)
  }

  const submit = async () => {
    if (!draft) return
    if (!draft.project.trim()) { toast('项目名不能为空'); setStep(0); return }
    if (!draft.repoUrl.trim()) { toast('Git 地址不能为空'); setStep(1); return }
    setSaving(true)
    try {
      const res = await saveRepo({ ...draft, project: draft.project.trim(), repoUrl: draft.repoUrl.trim() })
      setDraft(null)
      reload()
      toast(res.created ? `${draft.project} 已创建` : `${draft.project} 已更新`)
    } catch (e) {
      toast(`保存失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (r: Repo) => {
    try {
      await saveRepo({ ...r, enabled: !r.enabled })
      reload()
      toast(`${r.project} 已${r.enabled ? '停用' : '启用'}`)
    } catch (e) {
      toast(`操作失败：${e instanceof Error ? e.message : e}`)
    }
  }

  const confirmDelete = async () => {
    if (pendingDelete?.id == null) { toast('该仓库缺少 id，无法删除'); setPendingDelete(null); return }
    setSaving(true)
    try {
      await deleteRepo(pendingDelete.id)
      toast(`${pendingDelete.project} 已删除`)
      setPendingDelete(null)
      reload()
    } catch (e) {
      toast(`删除失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageH
        title="仓库管理"
        desc="仓库可服务多个业务域，一个业务域只对应一个仓库：分拣命中业务域后按绑定取 git 地址、基线分支与构建命令，子业务域未绑定时沿父链继承。"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => openDraft(null)}>
            <Icon name="plus" size={15} />新增仓库
          </button>
        }
      />

      <div className="grid g3" style={{ marginBottom: 18 }}>
        <Kpi icon="git" label="仓库总数" value={String(list.length)} delta="分拣落地目标" dir="flat" />
        <Kpi icon="layers" label="已绑定仓库的业务域" value={String(bizList.filter((b) => b.repoProject).length)}
          delta="可自动定位" dir="flat" color="#0f766e" />
        <Kpi icon="lock" label="敏感仓库" value={String(list.filter((r) => r.sensitive).length)}
          delta="仅内网客户端可执行" dir="flat" color="#b45309" />
      </div>

      {orphans.length > 0 && (
        <div style={{
          display: 'flex', gap: 10, alignItems: 'flex-start', border: '1px solid var(--line)',
          borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 12.5, lineHeight: 1.7,
        }}>
          <Icon name="warn" size={16} />
          <div>
            <strong>以下业务域尚未绑定仓库，且父级也未提供继承：</strong>
            <span style={{ color: 'var(--ink-3)', marginLeft: 6 }}>
              {orphans.map((b) => `${b.name}（${b.code}）`).join('、')}
            </span>
          </div>
        </div>
      )}

      <Panel
        title="仓库列表"
        sub={`共 ${shown.length} 个`}
        flush
        actions={<Search placeholder="搜索项目 / Git 地址 / 业务域" value={q} onChange={setQ} />}
      >
        {loading && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>}
        {!loading && data === null && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>接口请求失败，请确认后端已启动（:8080）</div>}
        {!loading && data !== null && (shown.length === 0 ? <Empty text="还没有仓库，先新增一个" /> : (
          <table>
            <thead>
              <tr>
                <th>项目</th><th>归属业务域</th><th>Git 地址</th><th>基线 · 分支前缀</th>
                <th>构建命令</th><th>安全</th><th>强制后端</th><th>启用</th>
                <th style={{ textAlign: 'right', paddingRight: 14 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const bound = boundOf(r.project)
                return (
                  <tr key={r.id ?? r.project}>
                    <td style={{ fontWeight: 550, fontFamily: 'var(--mono)', fontSize: 12.5, whiteSpace: 'nowrap' }}>{r.project}</td>
                    <td style={{ maxWidth: 220 }}>
                      {bound.length === 0 && <span style={{ color: 'var(--ink-4)' }}>未绑定</span>}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {bound.map((b) => (
                          <span key={b.code} className="kw" title={`${b.code} · 分拣命中后落到本仓库`}>
                            {b.name}
                            <span style={{ color: 'var(--ink-4)', fontFamily: 'var(--mono)', fontSize: 10.5 }}>{b.code}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-3)', maxWidth: 250, wordBreak: 'break-all' }}>{r.repoUrl}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {r.baselineBranch} <span style={{ color: 'var(--ink-4)' }}>·</span> {r.branchPrefix}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-3)', maxWidth: 200, wordBreak: 'break-all' }}>{r.buildCmd || '—'}</td>
                    <td>{r.sensitive ? <Tag tone="err">敏感</Tag> : <Tag tone="mut">普通</Tag>}</td>
                    <td style={{ fontSize: 12 }}>
                      {r.requiredBackend
                        ? <span className="backend-label">{BRANDS[r.requiredBackend] && <BrandMark backend={r.requiredBackend} size={13} />}{BRANDS[r.requiredBackend]?.title ?? r.requiredBackend}</span>
                        : '—'}
                    </td>
                    <td><Switch on={r.enabled} onClick={() => toggle(r)} /></td>
                    <td style={{ textAlign: 'right', paddingRight: 14, whiteSpace: 'nowrap' }}>
                      <button className="btn btn-xs btn-outline" style={{ marginRight: 6 }} onClick={() => openDraft(r)}>
                        <Icon name="edit" size={13} />编辑
                      </button>
                      <button className="btn btn-xs btn-outline" onClick={() => setPendingDelete(r)}>
                        <Icon name="trash" size={13} />删除
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ))}
      </Panel>

      {draft && (
        <Modal
          title={draft.id ? `编辑仓库 · ${draft.project}` : '新增仓库'}
          size="full"
          onClose={() => setDraft(null)}
          footer={
            <>
              <button className="btn btn-sm" onClick={() => setDraft(null)}>取消</button>
              {step > 0 && <button className="btn btn-sm" onClick={() => setStep(step - 1)}>上一步</button>}
              {step < 3
                ? <button className="btn btn-primary btn-sm" onClick={() => setStep(step + 1)}>下一步</button>
                : <button className="btn btn-primary btn-sm" disabled={saving} onClick={submit}>
                    {saving ? '保存中…' : '保存'}
                  </button>}
            </>
          }
        >
          <Stepper
            steps={[
              { label: '基本标识', hint: '项目名 · 归属业务域' },
              { label: 'Git 与分支', hint: '地址 · 基线 · 前缀' },
              { label: '构建与测试', hint: '构建 · 测试命令' },
              { label: '执行策略', hint: '安全 · 后端 · 客户端' },
            ]}
            current={step}
            onSelect={setStep}
          />

          {step === 0 && (
            <>
              <div className="fsect first"><b>基本标识</b></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '0 16px' }}>
                <div className="field" style={{ marginTop: 14 }}>
                  <label>项目名</label>
                  <input value={draft.project} placeholder="如 quote-service" onChange={(e) => setDraft({ ...draft, project: e.target.value })} />
                </div>
                <div className="field" style={{ marginTop: 14 }}>
                  <label>归属业务域</label>
                  <BizTreeSelect
                    tree={treeData ?? []}
                    value={draft.bizCodes ?? []}
                    onChange={(codes) => setDraft({ ...draft, bizCodes: codes })}
                    boundElsewhere={boundElsewhere}
                  />
                  <div className="fhelp">可勾选多个业务域；一个业务域只能归属一个仓库，已被占用的会置灰标注</div>
                </div>
              </div>
              <div className="field" style={{ marginTop: 14 }}>
                <label>说明</label>
                <textarea rows={2} value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="fsect first"><b>Git 与分支</b></div>
              <div className="field" style={{ marginTop: 14 }}>
                <label>Git 地址</label>
                <input value={draft.repoUrl} placeholder="git@git.yonyong.dev:quote/quote-service.git"
                  onChange={(e) => setDraft({ ...draft, repoUrl: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' }}>
                <div className="field" style={{ marginTop: 14 }}>
                  <label>基线分支</label>
                  <input value={draft.baselineBranch ?? ''} placeholder="main" onChange={(e) => setDraft({ ...draft, baselineBranch: e.target.value })} />
                </div>
                <div className="field" style={{ marginTop: 14 }}>
                  <label>工作分支前缀</label>
                  <input value={draft.branchPrefix ?? ''} placeholder="feature/" onChange={(e) => setDraft({ ...draft, branchPrefix: e.target.value })} />
                  <div className="fhelp">工作分支 = 前缀 + Issue 编号（小写）</div>
                </div>
                <div className="field" style={{ marginTop: 14 }}>
                  <label>主语言</label>
                  <input value={draft.language ?? ''} placeholder="Java" onChange={(e) => setDraft({ ...draft, language: e.target.value })} />
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="fsect first"><b>构建与测试</b></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <div className="field" style={{ marginTop: 14 }}>
                  <label>构建命令</label>
                  <input value={draft.buildCmd ?? ''} placeholder="mvn -DskipTests package" onChange={(e) => setDraft({ ...draft, buildCmd: e.target.value })} />
                </div>
                <div className="field" style={{ marginTop: 14 }}>
                  <label>测试命令</label>
                  <input value={draft.testCmd ?? ''} placeholder="mvn test" onChange={(e) => setDraft({ ...draft, testCmd: e.target.value })} />
                </div>
              </div>
              <div className="fhelp" style={{ marginTop: 16, lineHeight: 1.7 }}>
                工作分支由服务端按「分支前缀 + Issue 编号」生成并下发；构建与测试命令在客户端工作区内执行，
                命令失败会让执行节点按 failed 分支流转。
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="fsect first"><b>执行策略</b><span>低频配置</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' }}>
                <div className="field" style={{ marginTop: 14 }}>
                  <label>敏感等级</label>
                  <select value={draft.sensitive ? 'yes' : 'no'} onChange={(e) => setDraft({ ...draft, sensitive: e.target.value === 'yes' })}>
                    <option value="no">普通（不限客户端）</option>
                    <option value="yes">敏感（仅内网客户端）</option>
                  </select>
                </div>
                <div className="field" style={{ marginTop: 14 }}>
                  <label>强制后端</label>
                  <select value={draft.requiredBackend ?? ''} onChange={(e) => setDraft({ ...draft, requiredBackend: e.target.value })}>
                    {BACKENDS.map((b) => <option key={b.v} value={b.v}>{b.l}</option>)}
                  </select>
                  <div className="fhelp">敏感仓库建议强制内网后端，避免模型出网</div>
                </div>
                <div className="field" style={{ marginTop: 14 }}>
                  <label>默认执行客户端</label>
                  {clientIds.length > 0 ? (
                    <select value={draft.defaultClientId ?? ''}
                      onChange={(e) => setDraft({ ...draft, defaultClientId: e.target.value || undefined })}>
                      <option value="">（不指定，按业务域派发）</option>
                      {clientIds.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : (
                    <input value={draft.defaultClientId ?? ''} placeholder="如 dev-windows-07"
                      onChange={(e) => setDraft({ ...draft, defaultClientId: e.target.value })} />
                  )}
                  <div className="fhelp">优先级：仓库 &gt; 业务域 &gt; 开发负责人绑定</div>
                </div>
              </div>
              <div className="fhelp" style={{ marginTop: 16, lineHeight: 1.7 }}>
                敏感等级为「敏感 / 核心」时，Issue 只会派发到满足约束的客户端；强制后端与默认执行客户端冲突时，
                以后端约束为准。
              </div>
            </>
          )}
        </Modal>
      )}

      {pendingDelete && (
        <Modal
          title="删除仓库"
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
            即将删除仓库 <strong>{pendingDelete.project}</strong>。
            <div style={{ color: 'var(--ink-3)', marginTop: 8 }}>
              {boundOf(pendingDelete.project).length > 0
                ? `绑定它的 ${boundOf(pendingDelete.project).length} 个业务域（${boundOf(pendingDelete.project).map((b) => b.name).join('、')}）将自动解绑，回到「沿父链继承 / 未配置」状态。`
                : '当前没有业务域绑定该仓库。'}
              解绑或删除后，相关 Issue 分拣结果中的仓库与分支会变为空。
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
