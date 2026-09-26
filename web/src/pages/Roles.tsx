import { useMemo, useState } from 'react'
import { Icon } from '../icons'
import { Empty, Kpi, Modal, PageH, Panel, useToast } from '../ui'
import { fetchRoles, saveRolePerm, useAsync } from '../api'
import { ROLES, permLevelLabel, roleLabel } from '../constants'
import type { PermLevel, RolePermission } from '../types'

/* 点击循环：完整 → 部分 → 无 → 完整 */
const CYCLE: PermLevel[] = ['full', 'part', 'none']
const SYM: Record<PermLevel, string> = { full: '●', part: '◐', none: '○' }

export default function Roles() {
  const { toast } = useToast()
  const { data, loading, reload } = useAsync<RolePermission[]>(() => fetchRoles(), [])
  const [overrides, setOverrides] = useState<Record<string, PermLevel>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newCap, setNewCap] = useState('')
  const [savingNew, setSavingNew] = useState(false)

  /* capability 顺序按后端返回首次出现顺序 */
  const capabilities = useMemo(() => {
    const seen: string[] = []
    for (const p of data ?? []) if (!seen.includes(p.capability)) seen.push(p.capability)
    return seen
  }, [data])

  const levelOf = (cap: string, role: string): PermLevel => {
    const key = `${cap}|${role}`
    if (overrides[key]) return overrides[key]
    const hit = (data ?? []).find((p) => p.capability === cap && p.role === role)
    return hit?.level ?? 'none'
  }

  const stats = useMemo(() => {
    const all = data ?? []
    const total = all.length
    const full = all.filter((p) => p.level === 'full').length
    return { total, full, rate: total ? Math.round((full / total) * 100) : 0 }
  }, [data])

  const cycle = async (cap: string, role: string) => {
    const cur = levelOf(cap, role)
    const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length]
    const key = `${cap}|${role}`
    setOverrides((o) => ({ ...o, [key]: next }))
    setBusy(key)
    try {
      await saveRolePerm({ role, capability: cap, level: next })
      toast(`${roleLabel[role] ?? role} · ${cap} → ${permLevelLabel[next]}`)
    } catch (e) {
      setOverrides((o) => ({ ...o, [key]: cur }))
      toast(`保存失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  const addCapability = async () => {
    const name = newCap.trim()
    if (!name) { toast('请填写能力项名称'); return }
    if (capabilities.includes(name)) { toast('该能力项已存在'); return }
    setSavingNew(true)
    try {
      for (const r of ROLES) {
        await saveRolePerm({ role: r, capability: name, level: r === 'admin' ? 'full' : 'none' })
      }
      setAdding(false)
      setNewCap('')
      setOverrides({})
      reload()
      toast(`能力项「${name}」已新增`)
    } catch (e) {
      toast(`新增失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSavingNew(false)
    }
  }

  return (
    <div>
      <PageH
        title="权限管理"
        desc="六类角色 × 能力项的授权矩阵，点击单元格即可切换授权等级，修改实时生效。"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} />新增能力项
          </button>
        }
      />

      <div className="grid g3" style={{ marginBottom: 18 }}>
        <Kpi icon="shield" label="角色" value={String(ROLES.length)} delta="RBAC 模型" dir="flat" color="#4f46e5" />
        <Kpi icon="key" label="能力项" value={String(capabilities.length)} delta="可扩展" dir="flat" color="#0f766e" glow="rgba(15,118,110,.2)" />
        <Kpi icon="lock" label="完整授权占比" value={`${stats.rate}%`} delta={`${stats.full} / ${stats.total} 条`} dir="flat" color="#b45309" glow="rgba(180,83,9,.2)" />
      </div>

      <Panel
        title="角色能力矩阵"
        sub="点击单元格切换：● 完整 → ◐ 部分 → ○ 无"
        flush
      >
        {loading && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>}
        {!loading && data === null && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>接口请求失败，请确认后端已启动（:8080）</div>}
        {!loading && data !== null && (capabilities.length === 0 ? <Empty text="暂无权限配置" /> : (
          <table className="mtx">
            <thead>
              <tr>
                <th style={{ paddingLeft: 14 }}>能力</th>
                {ROLES.map((r) => <th key={r}>{roleLabel[r]}</th>)}
              </tr>
            </thead>
            <tbody>
              {capabilities.map((cap) => (
                <tr key={cap}>
                  <td style={{ paddingLeft: 14 }}>{cap}</td>
                  {ROLES.map((r) => {
                    const lv = levelOf(cap, r)
                    const key = `${cap}|${r}`
                    return (
                      <td key={key}>
                        <button
                          className={`perm-cell lv-${lv}`}
                          disabled={busy === key}
                          title={`${roleLabel[r]} · ${cap} → 点击切换`}
                          onClick={() => cycle(cap, r)}
                        >
                          <span className="sym">{SYM[lv]}</span>{permLevelLabel[lv]}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </Panel>

      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.8 }}>
        ● 完整：可查看并执行该能力下的全部操作　◐ 部分：仅限本人业务域或需上级确认　○ 无：入口不可见
      </div>

      {adding && (
        <Modal
          title="新增能力项"
          width={480}
          onClose={() => setAdding(false)}
          footer={
            <>
              <button className="btn btn-sm" onClick={() => setAdding(false)}>取消</button>
              <button className="btn btn-primary btn-sm" disabled={savingNew} onClick={addCapability}>
                {savingNew ? '保存中…' : '新增'}
              </button>
            </>
          }
        >
          <div className="field"><label>能力项名称</label>
            <input value={newCap} placeholder="如 知识库删除" onChange={(e) => setNewCap(e.target.value)} /></div>
          <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 14, lineHeight: 1.7 }}>
            新增后默认仅「管理员」为完整授权，其余角色为无；可回到矩阵中逐格调整。
          </div>
        </Modal>
      )}
    </div>
  )
}
