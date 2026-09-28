import { useMemo } from 'react'
import { Icon } from '../icons'
import { Chips, Kpi, PageH, Panel, Tag } from '../ui'
import {
  fetchBizDomains, fetchClients, fetchIssues, fetchLogs, fetchUsers, fetchWorkflowInstances, useAsync,
} from '../api'
import { loadProfile, saveProfile, ACTIVE_ROLE_EVENT } from '../settings'
import type { PageFocus, PageKey } from '../types'
import {
  buildWorkbench, canSeePlatformOverview, identityFromUser, isRoleCode, roleChipLabel, type RoleCode,
} from '../workbench'

export default function Workbench({
  nav, activeRole, onActiveRole,
}: {
  nav: (p: PageKey, focus?: PageFocus) => void
  activeRole: RoleCode
  onActiveRole: (r: RoleCode) => void
}) {
  const profile = useMemo(() => loadProfile(), [activeRole])
  const { data: users } = useAsync(() => fetchUsers(), [])
  const { data: issues } = useAsync(() => fetchIssues(), [])
  const { data: clients } = useAsync(() => fetchClients(), [])
  const { data: domains } = useAsync(() => fetchBizDomains(), [])
  const { data: instances } = useAsync(() => fetchWorkflowInstances(), [])
  const { data: logs } = useAsync(() => fetchLogs(), [])

  const meUser = useMemo(
    () => (users ?? []).find((u) => u.no === profile.no || u.name === profile.name),
    [users, profile.no, profile.name],
  )
  const identity = useMemo(
    () => identityFromUser(meUser, { name: profile.name, no: profile.no }),
    [meUser, profile.name, profile.no],
  )

  const roles = identity.roles.length ? identity.roles : (profile.roles?.length ? profile.roles : [activeRole])
  const effectiveRole: RoleCode = roles.includes(activeRole) ? activeRole : roles[0]

  const activeInst = (instances ?? []).filter((i) => ['running', 'blocked', 'pending'].includes(String(i.status))).length
  const model = useMemo(() => buildWorkbench({
    activeRole: effectiveRole,
    me: {
      name: identity.name,
      no: identity.no,
      bizCodes: identity.bizCodes,
      clientId: identity.clientId,
    },
    issues: issues ?? [],
    clients: clients ?? [],
    domains: domains ?? [],
    activeInst,
    aiCalls: (logs ?? []).length,
  }), [effectiveRole, identity, issues, clients, domains, activeInst, logs])

  const switchRole = (r: RoleCode) => {
    if (r === effectiveRole) return
    onActiveRole(r)
    const p = loadProfile()
    saveProfile({
      ...p,
      roles,
      activeRole: r,
      role: roleChipLabel(r),
    })
    window.dispatchEvent(new CustomEvent(ACTIVE_ROLE_EVENT, { detail: r }))
  }

  return (
    <div>
      <PageH
        title="我的工作台"
        desc={model.headline}
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {model.ctas.map((c) => (
              <button
                key={c.label}
                className={`btn btn-sm ${c.primary ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => nav(c.page, c.focus)}
              >
                {c.icon && <Icon name={c.icon} size={15} />}
                {c.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="wb-hello">
        <div className="wb-hello-text">
          <b>你好，{identity.name || profile.name || '同事'}</b>
          <span>以当前角色查看待办 · 可随时切换</span>
        </div>
        {roles.length > 1 ? (
          <Chips
            value={effectiveRole}
            items={roles.filter(isRoleCode).map((r) => ({ v: r, l: roleChipLabel(r) }))}
            onChange={switchRole}
          />
        ) : (
          <Tag tone="info">{roleChipLabel(effectiveRole)}</Tag>
        )}
      </div>

      <div className="grid g4" style={{ marginTop: 16 }}>
        {model.kpis.map((k) => (
          <Kpi
            key={k.key}
            icon={k.icon}
            label={k.label}
            value={k.value}
            delta={k.delta}
            dir={k.dir ?? 'flat'}
            color={k.color}
            hint={k.focus ? '点击下钻' : undefined}
            onClick={k.focus ? () => nav(k.focus!.page, k.focus!.focus) : undefined}
          />
        ))}
      </div>

      <div className="grid g3" style={{ marginTop: 18, gridTemplateColumns: '2fr 1fr' }}>
        <Panel title="需要我处理" sub={model.todos.length ? '按紧急度排序 · 点击打开' : undefined} flush>
          {model.todos.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>{model.emptyTodo}</div>
          ) : (
            <div className="wb-todos">
              {model.todos.map((t) => (
                <div
                  key={t.key}
                  className="row-between row-link wb-todo"
                  onClick={() => nav(t.page, t.focus)}
                  title={`打开 ${t.title}`}
                >
                  <div className="rl"><b>{t.title}</b><span>{t.sub}</span></div>
                  <Tag tone={t.tone} dot>{t.badge}</Tag>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Panel title={model.sideTitle}>
            {model.sideLines.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>—</div>
            ) : (
              model.sideLines.map((l, idx) => (
                <div
                  key={idx}
                  className={`row-between ${l.go ? 'row-link' : ''}`}
                  style={{ padding: '8px 0' }}
                  onClick={l.go ? () => nav(l.go!.page, l.go!.focus) : undefined}
                >
                  <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{l.text}</span>
                  {l.tone && l.tone !== 'mut' && <Tag tone={l.tone}>{l.tone === 'ok' ? '正常' : l.tone === 'err' ? '异常' : '关注'}</Tag>}
                </div>
              ))
            )}
          </Panel>

          <Panel title="快捷入口">
            <div className="wb-shortcuts">
              {model.shortcuts
                .filter((s) => s.page !== 'dashboard' || canSeePlatformOverview(effectiveRole))
                .map((s) => (
                  <button key={s.label} className="btn btn-outline btn-xs" onClick={() => nav(s.page, s.focus)}>
                    {s.label}
                  </button>
                ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
