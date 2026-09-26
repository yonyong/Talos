import { useMemo, useState } from 'react'
import { Icon } from '../icons'
import { Chips, Empty, Kpi, Modal, PageH, Panel, Search, Tag, useToast } from '../ui'
import { deleteUser, fetchUsers, saveUser, useAsync } from '../api'
import { ROLES, roleLabel } from '../constants'
import type { UserRow } from '../types'

const ROLE_TONE: Record<string, 'info' | 'ok' | 'warn' | 'mut'> = {
  admin: 'info', pm: 'info', lead: 'ok', dev: 'mut', qa: 'mut', guest: 'mut',
}
const BIZ_OPTIONS = ['全部', '行情', '回测/指标', '账户', '资讯', '交易', '风控']

type Draft = { id?: number; name: string; no: string; role: string; biz: string; client: string }
const EMPTY_DRAFT: Draft = { name: '', no: '', role: 'dev', biz: '行情', client: '' }

export default function Users() {
  const { toast } = useToast()
  const { data, loading, reload } = useAsync<UserRow[]>(() => fetchUsers(), [])
  const [role, setRole] = useState<string>('all')
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pendingDelete, setPendingDelete] = useState<UserRow | null>(null)
  const [saving, setSaving] = useState(false)

  const list = data ?? []
  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return list
      .filter((u) => (role === 'all' ? true : u.role === role))
      .filter((u) => !kw || u.name.toLowerCase().includes(kw) || u.no.includes(kw) || u.biz.includes(kw) || u.client.includes(kw))
  }, [list, role, q])

  const chips = useMemo(() => [
    { v: 'all', l: '全部', n: list.length },
    ...ROLES.map((r) => ({ v: r, l: roleLabel[r], n: list.filter((u) => u.role === r).length })),
  ], [list])

  const submit = async () => {
    if (!draft) return
    if (!draft.name.trim() || !draft.no.trim()) { toast('姓名与工号为必填'); return }
    setSaving(true)
    try {
      await saveUser({
        id: draft.id, name: draft.name.trim(), empNo: draft.no.trim(),
        role: draft.role, bizDomain: draft.biz, clientId: draft.client.trim() || undefined,
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
          delta="可承接执行" dir="flat" color="#0f766e" glow="rgba(15,118,110,.2)" />
        <Kpi icon="client" label="已绑定客户端" value={String(list.filter((u) => u.client !== '—').length)}
          delta="可执行任务" dir="flat" color="#b45309" glow="rgba(180,83,9,.2)" />
      </div>

      <Panel
        title="成员列表"
        sub={`共 ${shown.length} 人`}
        flush
        actions={<div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Chips value={role} items={chips} onChange={setRole} />
          <Search placeholder="搜索姓名 / 工号" value={q} onChange={setQ} />
        </div>}
      >
        {loading && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>}
        {!loading && data === null && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>接口请求失败，请确认后端已启动（:8080）</div>}
        {!loading && data !== null && (shown.length === 0 ? <Empty text="没有匹配的用户" /> : (
          <table>
            <thead>
              <tr><th>姓名</th><th>工号</th><th>角色</th><th>业务域</th><th>绑定客户端</th><th style={{ textAlign: 'right', paddingRight: 14 }}>操作</th></tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id ?? u.no}>
                  <td style={{ fontWeight: 550 }}>{u.name}</td>
                  <td className="tid">{u.no}</td>
                  <td><Tag tone={ROLE_TONE[u.role] ?? 'mut'}>{roleLabel[u.role] ?? u.role}</Tag></td>
                  <td>{u.biz}</td>
                  <td className="tid">{u.client}</td>
                  <td style={{ textAlign: 'right', paddingRight: 14, whiteSpace: 'nowrap' }}>
                    <button className="btn btn-xs btn-outline" style={{ marginRight: 6 }}
                      onClick={() => setDraft({ id: u.id, name: u.name, no: u.no, role: u.role, biz: u.biz, client: u.client === '—' ? '' : u.client })}>
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
          width={520}
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
            <div className="field"><label>工号</label>
              <input value={draft.no} placeholder="如 25102" onChange={(e) => setDraft({ ...draft, no: e.target.value })} /></div>
            <div className="field"><label>角色</label>
              <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
              </select></div>
            <div className="field"><label>业务域</label>
              <select value={draft.biz} onChange={(e) => setDraft({ ...draft, biz: e.target.value })}>
                {BIZ_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select></div>
          </div>
          <div className="field"><label>绑定客户端（可选，研发角色必填才能领任务）</label>
            <input value={draft.client} placeholder="如 dev-windows-07" onChange={(e) => setDraft({ ...draft, client: e.target.value })} /></div>
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
            即将删除用户 <strong>{pendingDelete.name}</strong>（工号 {pendingDelete.no}，角色 {roleLabel[pendingDelete.role] ?? pendingDelete.role}）。
            <div style={{ color: 'var(--ink-3)', marginTop: 8 }}>
              该用户已认领或正在执行的 Issue 不会被回收，但将不再出现在成员列表中。
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
