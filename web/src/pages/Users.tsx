import { useMemo, useState } from 'react'
import { Icon } from '../icons'
import { Chips, Empty, Kpi, Modal, PageH, Panel, Search, Tag, useToast } from '../ui'
import { deleteUser, fetchBizTree, fetchClients, fetchUsers, saveUser, useAsync } from '../api'
import { ROLES, roleLabel } from '../constants'
import type { BizTreeNode, UserRow } from '../types'
import { BizTreeSelect, flatBiz } from '../components/BizTreeSelect'

const ROLE_TONE: Record<string, 'info' | 'ok' | 'warn' | 'mut'> = {
  admin: 'info', pm: 'info', lead: 'ok', dev: 'mut', qa: 'mut', guest: 'mut',
}

/** 归属业务域与仓库一致：多选编码列表，来自业务树 */
type Draft = { id?: number; name: string; email: string; role: string; bizCodes: string[]; client: string }
const EMPTY_DRAFT: Draft = { name: '', email: '', role: 'dev', bizCodes: [], client: '' }
export default function Users() {
  const { toast } = useToast()
  const { data, loading, reload } = useAsync<UserRow[]>(() => fetchUsers(), [])
  const [role, setRole] = useState<string>('all')
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pendingDelete, setPendingDelete] = useState<UserRow | null>(null)
  const [saving, setSaving] = useState(false)
  /** 编辑时的原始绑定：已绑定的用户不允许在此改绑，只能到「客户端」页解绑 */
  const [boundOrig, setBoundOrig] = useState('')

  const list = data ?? []
  const clients = useAsync(() => fetchClients(), [])
  const clientIds = useMemo(() => (clients.data ?? []).map((c) => c.id).filter(Boolean), [clients.data])
  const { data: treeData } = useAsync<BizTreeNode[]>(() => fetchBizTree(), [])
  const bizList = useMemo(() => flatBiz(treeData ?? []), [treeData])
  const bizName = (code: string) => bizList.find((b) => b.code === code)?.name ?? code
  /** 展示用业务域：优先按编码取名称，存量单值（名称）兜底 */
  const bizText = (u: UserRow) => {
    const codes = u.bizCodes ?? []
    return codes.length ? codes.map(bizName).join('、') : (u.biz || '全部')
  }
  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return list
      .filter((u) => (role === 'all' ? true : u.role === role))
      .filter((u) => !kw || u.name.toLowerCase().includes(kw)
        || (u.email ?? '').toLowerCase().includes(kw)
        || bizText(u).toLowerCase().includes(kw)
        || (u.bizCodes ?? []).some((c) => c.toLowerCase().includes(kw))
        || u.client.includes(kw))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, role, q, bizList])

  const chips = useMemo(() => [
    { v: 'all', l: '全部', n: list.length },
    ...ROLES.map((r) => ({ v: r, l: roleLabel[r], n: list.filter((u) => u.role === r).length })),
  ], [list])

  const submit = async () => {
    if (!draft) return
    if (!draft.name.trim()) { toast('姓名为必填'); return }
    const email = draft.email.trim()
    if (email && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)) { toast('邮箱格式不正确'); return }
    setSaving(true)
    try {
      await saveUser({
        id: draft.id, name: draft.name.trim(), email,
        role: draft.role, bizCodes: draft.bizCodes, clientId: draft.client.trim() || undefined,
      })
      setDraft(null)
      reload()
      toast(draft.id ? `${draft.name} 已更新` : `${draft.name} 已添加`)
    } catch (e) {
      toast(`保存失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete?.id) { toast('该用户缺少 id，无法删除'); setPendingDelete(null); return }
    setSaving(true)
    try {
      await deleteUser(pendingDelete.id)
      toast(`${pendingDelete.name} 已删除`)
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
        title="用户管理"
        desc="按业务域隔离数据可见范围；用户绑定客户端后即可承接对应仓库的自动执行任务。"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            <Icon name="plus" size={15} />新增用户
          </button>
        }
      />

      <div className="grid g3" style={{ marginBottom: 18 }}>
        <Kpi icon="users" label="用户总数" value={String(list.length)} delta="按业务域授权" dir="flat" />
        <Kpi icon="code" label="研发角色" value={String(list.filter((u) => u.role === 'dev' || u.role === 'lead').length)}
          delta="可承接执行" dir="flat" color="#0f766e" />
        <Kpi icon="client" label="已绑定客户端" value={String(list.filter((u) => u.client !== '—').length)}
          delta="可执行任务" dir="flat" color="#b45309" />
      </div>

      <Panel
        title="成员列表"
        sub={`共 ${shown.length} 人`}
        flush
        actions={<div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Chips value={role} items={chips} onChange={setRole} />
          <Search placeholder="搜索姓名 / 邮箱" value={q} onChange={setQ} />
        </div>}
      >
        {loading && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>}
        {!loading && data === null && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>接口请求失败，请确认后端已启动（:8080）</div>}
        {!loading && data !== null && (shown.length === 0 ? <Empty text="没有匹配的用户" /> : (
          <table>
            <thead>
              <tr><th>姓名</th><th>登录邮箱</th><th>角色</th><th>业务域</th><th>绑定客户端</th><th style={{ textAlign: 'right', paddingRight: 14 }}>操作</th></tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id ?? u.email ?? u.name}>
                  <td style={{ fontWeight: 550 }}>{u.name}</td>
                  <td className="tid">{u.email
                    ? u.email
                    : <span className="t-mut" title="未登记邮箱的账号无法登录控制台">未登记</span>}</td>
                  <td><Tag tone={ROLE_TONE[u.role] ?? 'mut'}>{roleLabel[u.role] ?? u.role}</Tag></td>
                  <td>{bizText(u)}</td>
                  <td className="tid">{u.client}</td>
                  <td style={{ textAlign: 'right', paddingRight: 14, whiteSpace: 'nowrap' }}>
                    <button className="btn btn-xs btn-outline" style={{ marginRight: 6 }}
                      onClick={() => {
                        setBoundOrig(u.client === '—' ? '' : u.client)
                        setDraft({ id: u.id, name: u.name, email: u.email ?? '', role: u.role, bizCodes: u.bizCodes ?? [], client: u.client === '—' ? '' : u.client })
                      }}>
                      <Icon name="edit" size={13} />编辑
                    </button>
                    <button className="btn btn-xs btn-outline" onClick={() => setPendingDelete(u)}>
                      <Icon name="trash" size={13} />删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </Panel>

      {draft && (
        <Modal
          title={draft.id ? `编辑用户 · ${draft.name}` : '新增用户'}
          width={620}
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <div className="field"><label>姓名</label>
              <input value={draft.name} placeholder="如 王磊" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
            <div className="field"><label>角色</label>
              <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
              </select></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label>登录邮箱</label>
              <input value={draft.email} placeholder="登录控制台用的邮箱地址"
                onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
              <div className="fhelp">邮箱即用户身份：控制台以「邮箱 + 邮件授权码」登录，个人配置与绑定关系都按邮箱关联。留空则该账号不可登录；同一邮箱只能对应一个账号。</div>
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label>归属业务域</label>
              <BizTreeSelect
                tree={treeData ?? []}
                value={draft.bizCodes}
                onChange={(codes) => setDraft({ ...draft, bizCodes: codes })}
              />
              <div className="fhelp">与仓库一致：可勾选多个业务域，用于数据可见范围与派发；不选表示不限（全部）</div>
            </div>
          </div>
          <div className="field"><label>绑定客户端（可选，研发角色必填才能领任务）</label>
            {boundOrig ? (
              <>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px',
                  background: 'var(--bg-subtle)', fontSize: 13,
                }}>
                  <Icon name="lock" size={14} className="t-mut" />
                  <span className="tid">{boundOrig}</span>
                  <Tag tone="ok" dot>已绑定</Tag>
                </div>
                <div className="fhelp">绑定后不可在此更改；如需更换，请到「客户端」页对该用户解除绑定后重新绑定。</div>
              </>
            ) : clientIds.length > 0 ? (
              <select value={draft.client}
                onChange={(e) => setDraft({ ...draft, client: e.target.value })}>
                <option value="">（不绑定）</option>
                {clientIds.map((c) => {
                  const st = (clients.data ?? []).find((x) => x.id === c)?.state
                  const tag = st === 'on' ? '在线' : st === 'busy' ? '执行中' : '离线'
                  return <option key={c} value={c}>{c}{st ? ` · ${tag}` : ''}</option>
                })}
                {draft.client && !clientIds.includes(draft.client) && (
                  <option value={draft.client}>{draft.client} · 已失效</option>
                )}
              </select>
            ) : (
              <input value={draft.client} placeholder="如 dev-windows-07"
                onChange={(e) => setDraft({ ...draft, client: e.target.value })} />
            )}
            {!boundOrig && <div className="fhelp">候选为已注册客户端，标注在线状态；绑定后个人设置测试与配置下发到该机器。</div>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 14, lineHeight: 1.7 }}>
            角色决定该用户在工作台可见的能力范围，可在「权限管理」中调整。
          </div>
        </Modal>
      )}

      {pendingDelete && (
        <Modal
          title="删除用户"
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
            即将删除用户 <strong>{pendingDelete.name}</strong>（{pendingDelete.email ? `邮箱 ${pendingDelete.email}` : '未登记邮箱'}，角色 {roleLabel[pendingDelete.role] ?? pendingDelete.role}）。
            <div style={{ color: 'var(--ink-3)', marginTop: 8 }}>
              该用户已认领或正在执行的 Issue 不会被回收，但将不再出现在成员列表中。
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
