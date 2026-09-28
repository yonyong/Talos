import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../icons'
import { BRANDS, BrandMark } from '../brands'
import { Modal, PageH, Panel, Search, Seg, Switch, Tabs, Tag, useToast } from '../ui'
import {
  clearClientLogs, fetchAgentRelease, fetchClientAiLogs, fetchClientLogs, fetchClients, fetchClientStats,
  fetchUsers, pullClientLogs, pushClientConfig, reconnectAllClients, reconnectClient, unbindClientUser,
  upgradeAllClients, upgradeClient, useAsync, versionOlder,
} from '../api'
import type { AgentRelease, AiCallLog, ClientLogEntry, ClientNode, PageFocus, PageKey, UserRow } from '../types'
import AgentReleasePanel from '../components/AgentReleasePanel'

const INSTALL_CMD = 'scripts\\install.bat --server talos.yonyong.dev:9443 --token <一次性凭证> --id <客户端ID>'

const dotOf: Record<string, string> = { on: 'on', busy: 'busy', off: 'off' }
const stateTag: Record<string, { l: string; tone: 'ok' | 'prog' | 'err' }> = {
  on: { l: '在线', tone: 'ok' }, busy: { l: '执行中', tone: 'prog' }, off: { l: '离线', tone: 'err' },
}

function hms(iso?: string): string {
  if (!iso) return '--:--:--'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso.slice(11, 19) || iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
function sizeText(bytes?: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function shortSha(sha?: string): string {
  if (!sha) return '—'
  return sha.length <= 16 ? sha : `${sha.slice(0, 8)}…${sha.slice(-4)}`
}

/**
 * 页面级 Tab：三件事彼此独立，同屏并列会互相抢焦点 ——
 *   终端   谁能干活（日常最常看）
 *   版本   发版与升级（管理员偶尔做）
 *   接入   怎么把新机器接进来、谁绑了哪台（新人一次性 / 管理员对账）
 */
type Tab = 'nodes' | 'release' | 'access'
type StateFilter = 'all' | 'on' | 'off'

export default function Clients({ focus, nav }: { focus?: PageFocus; nav: (p: PageKey, f?: PageFocus) => void }) {
  const { toast } = useToast()
  const { data: clients, loading, error, reload: reloadClients } = useAsync<ClientNode[]>(() => fetchClients(), [])
  const { data: stats } = useAsync(() => fetchClientStats(), [])
  const { data: users, reload: reloadUsers } = useAsync<UserRow[]>(() => fetchUsers(), [])
  const [release, setRelease] = useState<AgentRelease | null>(null)
  const [tab, setTab] = useState<Tab>('nodes')
  const [q, setQ] = useState('')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [logFor, setLogFor] = useState<ClientNode | null>(null)
  const [upFor, setUpFor] = useState<ClientNode | null>(null)
  const [unbindFor, setUnbindFor] = useState<{ clientId: string; u: UserRow } | null>(null)
  const [busy, setBusy] = useState('')

  const loadRelease = useCallback(() => {
    fetchAgentRelease().then(setRelease).catch(() => setRelease(null))
  }, [])
  useEffect(() => { loadRelease() }, [loadRelease])

  const list = clients ?? []
  const online = list.filter((c) => c.state !== 'off').length
  const offline = list.length - online
  const target = release?.available ? release.version : undefined
  /** 需人工下发的升级：只有在线终端能立刻收；离线终端上线时客户端会自查版本自动升 */
  const outdated = target ? list.filter((c) => c.state !== 'off' && versionOlder(c.version, target)) : []
  const outdatedOffline = target ? list.filter((c) => c.state === 'off' && versionOlder(c.version, target)) : []

  const stateOptions: { v: StateFilter; l: string }[] = [
    { v: 'all', l: `全部 ${list.length}` },
    { v: 'on', l: `在线 ${online}` },
    { v: 'off', l: `离线 ${offline}` },
  ]

  const shown = list
    .filter((c) => !q || c.id.includes(q) || c.owner.includes(q) || c.ip.includes(q))
    .filter((c) => {
      if (stateFilter === 'all') return true
      if (stateFilter === 'off') return c.state === 'off'
      return c.state !== 'off'
    })

  /** 终端 → 使用人（绑定后用户不可自行改绑，解绑出口在「接入与绑定」Tab） */
  const boundOf = useMemo(() => {
    const m = new Map<string, UserRow[]>()
    for (const u of users ?? []) {
      if (!u.client || u.client === '—') continue
      const arr = m.get(u.client) ?? []
      arr.push(u)
      m.set(u.client, arr)
    }
    return m
  }, [users])
  const boundCount = (users ?? []).filter((u) => u.client && u.client !== '—').length

  /* ---- 来自总览的下钻条件 ---- */
  const handledRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!focus) return
    if (focus.outdated) { setTab('release'); setStateFilter('all') }
    else {
      setTab('nodes')
      if (focus.offline) setStateFilter('off')
      else if (focus.status === 'on') setStateFilter('on')
      else setStateFilter('all')
    }
    if (focus.q) setQ(focus.q)
  }, [focus?.at]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focus?.clientId || !clients) return
    if (handledRef.current === focus.at) return
    const hit = clients.find((c) => c.id === focus.clientId)
    if (!hit) return
    handledRef.current = focus.at
    setTab('nodes')
    setLogFor(hit)
  }, [focus, clients])

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key)
    try { toast(await fn()) } catch (e) { toast(e instanceof Error ? e.message : '操作失败') } finally { setBusy('') }
  }

  const copyCmd = () => {
    navigator.clipboard?.writeText(INSTALL_CMD).catch(() => {})
    toast('已复制接入命令')
  }

  const doUnbind = async () => {
    if (!unbindFor) return
    const { clientId, u } = unbindFor
    if (!u.id) { toast('该用户缺少 id，无法解绑'); return }
    await act('unbind', async () => {
      const r = await unbindClientUser(clientId, u.id!)
      reloadUsers()
      setUnbindFor(null)
      return r.configPushed
        ? `已解除 ${u.name} 与 ${clientId} 的绑定，并已重推配置`
        : `已解除 ${u.name} 与 ${clientId} 的绑定`
    })
  }

  const metaLine = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--ink-4)', flexWrap: 'wrap' }}>
      {stats && <span>在线率 <b style={{ color: 'var(--ink-2)' }}>{stats.onlineRate}%</b></span>}
      <span style={{ color: 'var(--ink-5)' }}>·</span>
      {outdated.length > 0 ? (
        <button
          className="btn btn-xs btn-outline"
          onClick={() => setTab('release')}
          title="切到「版本发布」Tab 批量下发升级"
        >
          <Icon name="warn" size={12} />{outdated.length} 台版本落后 · 去升级
        </button>
      ) : target ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="check" size={13} />已是最新 v{target}
        </span>
      ) : (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="warn" size={13} />尚未发布安装包
        </span>
      )}
    </div>
  )

  const loadFail = (
    <div
      className="card card-pad"
      style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: 'var(--ink-3)', flexWrap: 'wrap' }}
    >
      <Icon name="warn" size={16} />
      <span>客户端列表加载失败：{error}（请确认后端已启动）</span>
      <button className="btn btn-xs btn-outline" onClick={() => reloadClients()}>重试</button>
    </div>
  )
  const loadingLine = <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>

  return (
    <div>
      <PageH
        title="客户端"
        desc="接入 Talos 的研发终端。终端状态、版本发布、接入与绑定分成三块，一次只看一件事。"
        actions={
          tab === 'nodes' ? (
            <button
              className="btn btn-outline btn-sm"
              disabled={busy === 're-all'}
              onClick={() => act('re-all', async () => {
                const r = await reconnectAllClients()
                return `已向 ${r.requested}/${r.online} 台在线客户端下发重连指令`
              })}
            >
              <Icon name="refresh" size={15} />全部重连
            </button>
          ) : tab === 'release' ? (
            outdated.length > 0 ? (
              <button
                className="btn btn-primary btn-sm"
                disabled={busy === 'up-all'}
                onClick={() => act('up-all', async () => {
                  const r = await upgradeAllClients()
                  loadRelease()
                  reloadClients()
                  return r.pushed > 0
                    ? `已向 ${r.pushed} 台客户端下发静默升级 → ${r.target}`
                    : (r.hint ?? '没有需要升级的在线客户端')
                })}
              >
                <Icon name="upload" size={15} />升级全部 {outdated.length} 台
              </button>
            ) : undefined
          ) : (
            <button className="btn btn-outline btn-sm" onClick={copyCmd}>
              <Icon name="copy" size={15} />复制接入命令
            </button>
          )
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { v: 'nodes', l: '终端', n: list.length, hint: '谁在线、谁在跑活、单台重连与查看日志' },
          { v: 'release', l: '版本发布', n: outdated.length, tone: 'warn', hint: '维护发布版本库，向落后终端下发静默升级' },
          { v: 'access', l: '接入与绑定', hint: '接入命令、安装步骤，以及用户与终端的绑定关系' },
        ]}
      />

      {/* ============================ 终端 ============================ */}
      {tab === 'nodes' && (
        error ? loadFail : clients === null ? loadingLine : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <Search placeholder="搜索客户端、责任人、IP" value={q} onChange={setQ} />
                <Seg value={stateFilter} onChange={setStateFilter} options={stateOptions} />
              </div>
              {metaLine}
            </div>

            {stateFilter !== 'all' && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
                border: '1px solid var(--line)', borderLeft: '2px solid var(--accent)',
                borderRadius: 9, padding: '9px 12px', background: 'var(--bg-subtle)', fontSize: 12.5,
              }}>
                <Icon name="filter" size={14} />
                <span>
                  已按状态筛选：<b style={{ marginLeft: 4 }}>{stateFilter === 'on' ? '在线' : '离线'}</b>
                  <span style={{ color: 'var(--ink-4)', marginLeft: 8 }}>命中 {shown.length} 台</span>
                </span>
                <button className="btn btn-xs btn-outline" style={{ marginLeft: 'auto' }} onClick={() => setStateFilter('all')}>
                  <Icon name="x" size={12} />清除筛选
                </button>
              </div>
            )}

            {shown.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 24, textAlign: 'center' }}>
                {stateFilter !== 'all' || q ? (
                  '没有符合筛选条件的客户端'
                ) : (
                  <>
                    暂无客户端接入
                    <div style={{ marginTop: 10 }}>
                      <button
                        className="btn btn-xs btn-outline"
                        style={{ display: 'inline-flex' }}
                        onClick={() => setTab('access')}
                      >
                        <Icon name="key" size={13} />去「接入与绑定」拿接入命令
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="grid g2">
                {shown.map((c) => {
                  const canUpgrade = !!target && versionOlder(c.version, target)
                  const bound = boundOf.get(c.id) ?? []
                  return (
                    <div key={c.id} className="card card-pad">
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                          <span className={`cdot ${dotOf[c.state]}`} />
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>{c.id}</div>
                            <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3 }}>
                              {c.owner} · {c.ip} · v{c.version}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {canUpgrade && (
                            <button
                              className="tag t-warn"
                              style={{ border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 11.5, fontWeight: 600 }}
                              title="切到「版本发布」Tab 下发升级"
                              onClick={() => setTab('release')}
                            >
                              可升级 {target}
                            </button>
                          )}
                          <Tag tone={stateTag[c.state].tone} dot>{stateTag[c.state].l}</Tag>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }}>
                        <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                          心跳 {c.heartbeat} · Agent {c.agents.filter((a) => a !== '—').length} 个
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {c.agents.filter((a) => a !== '—').map((a) => (
                            <span key={a} className="tag t-mut" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <BrandMark backend={a} size={13} />
                              {BRANDS[a]?.title ?? a}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: 'var(--ink-4)', flex: 'none' }}>使用人</span>
                        {bound.length === 0 ? (
                          <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>未绑定 · 用户在「设置」面板自行绑定</span>
                        ) : bound.map((u) => (
                          <span key={u.id ?? u.email ?? u.name} className="tag t-info" title={u.email || undefined}>
                            {u.name}
                          </span>
                        ))}
                      </div>

                      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-outline btn-xs"
                          disabled={busy === `re-${c.id}`}
                          onClick={() => act(`re-${c.id}`, async () => (await reconnectClient(c.id)).hint)}
                        >
                          <Icon name="refresh" size={13} />重连
                        </button>
                        <button
                          className="btn btn-outline btn-xs"
                          disabled={busy === `cfg-${c.id}`}
                          onClick={() => act(`cfg-${c.id}`, async () => {
                            const r = await pushClientConfig(c.id)
                            return r.pushed ? `已向 ${c.id} 下发最新配置` : `${c.id} 离线，配置将在其上线时自动下发`
                          })}
                        >
                          <Icon name="send" size={13} />下发配置
                        </button>
                        <button className="btn btn-outline btn-xs" onClick={() => setLogFor(c)}>
                          <Icon name="terminal" size={13} />查看日志
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )
      )}

      {/* ============================ 版本发布 ============================ */}
      {tab === 'release' && (
        <>
          <div style={{ marginBottom: 18 }}>
            <AgentReleasePanel />
          </div>

          <Panel
            title="待升级终端"
            sub={target
              ? `版本低于当前生效版 v${target} 的在线终端；下发后客户端在后台校验 SHA256、替换 jar 并自动重启。`
              : '服务端还没有可发布的客户端安装包。'}
          >
            {error ? loadFail : clients === null ? loadingLine : outdated.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--ink-3)' }}>
                <Icon name="check" size={16} />
                {target ? `所有在线终端都已是 v${target}，暂无需要手工下发的升级。` : '上传一个安装包后，这里会列出需要升级的终端。'}
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>终端</th><th>责任人</th><th>当前版本</th><th>目标版本</th><th>状态</th>
                    <th style={{ width: 110 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {outdated.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 550 }}>{c.id}</td>
                      <td>{c.owner}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>v{c.version}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--accent-ink)' }}>v{target}</td>
                      <td><Tag tone={stateTag[c.state].tone} dot>{stateTag[c.state].l}</Tag></td>
                      <td>
                        <button className="btn btn-outline btn-xs" onClick={() => setUpFor(c)}>
                          <Icon name="upload" size={13} />升级
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {outdatedOffline.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 14, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.7 }}>
                <span style={{ flex: 'none', paddingTop: 2 }}><Icon name="info" size={13} /></span>
                <span>
                  另有 {outdatedOffline.length} 台离线终端版本落后。它们上线时会自行发现新版本并静默升级，无需人工下发。
                </span>
              </div>
            )}
          </Panel>
        </>
      )}

      {/* ============================ 接入与绑定 ============================ */}
      {tab === 'access' && (
        <>
          <div style={{ marginBottom: 18 }}>
            <Panel
              title="接入新终端"
              sub="三步把一台研发终端接进平台；安装包与一次性凭证从下载页 / 控制台取得。"
            >
              <div style={{ display: 'grid', gap: 16 }}>
                {[
                  { t: '取得安装包', d: '从下载页取客户端安装包，或直接把安装脚本拷到目标机器（脚本内含保活注册）。' },
                  { t: '执行安装命令', d: '在目标终端执行下面的命令：--token 填一次性接入凭证，--id 指定终端标识（如 T14P-01）。' },
                  { t: '绑定使用人', d: '终端上线后，使用人在控制台「设置」面板自行绑定；需要改绑时，管理员在下方「用户与终端绑定」里解除。' },
                ].map((s, i) => (
                  <div key={s.t} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span style={{
                      flex: 'none', width: 22, height: 22, borderRadius: '50%', marginTop: 1,
                      background: 'var(--accent-soft)', color: 'var(--accent-ink)',
                      fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>{i + 1}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 620 }}>{s.t}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.75 }}>{s.d}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, padding: '10px 12px',
                border: '1px solid var(--line-2)', borderRadius: 9, background: 'var(--bg-subtle)',
              }}>
                <span style={{ flex: 'none', color: 'var(--ink-4)', display: 'inline-flex' }}><Icon name="terminal" size={15} /></span>
                <code style={{ fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'nowrap', overflowX: 'auto', color: 'var(--ink-2)' }}>
                  {INSTALL_CMD}
                </code>
                <button className="btn btn-outline btn-xs" style={{ marginLeft: 'auto', flex: 'none' }} onClick={copyCmd}>
                  <Icon name="copy" size={13} />复制
                </button>
              </div>

              <div style={{ display: 'flex', gap: 18, marginTop: 16, fontSize: 12.5, flexWrap: 'wrap' }}>
                <a href="#/download" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--accent)' }}>
                  打开下载页 <Icon name="arrow" size={12} />
                </a>
                <a href="#/docs/guide" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--accent)' }}>
                  接入指南（保活机制 / 配置字段 / 排障） <Icon name="arrow" size={12} />
                </a>
              </div>
            </Panel>
          </div>

          <Panel
            title="用户与终端绑定"
            sub={`共 ${(users ?? []).length} 名用户，已绑定终端 ${boundCount} 人。用户绑定后不可自行更换，解绑出口在这里。`}
          >
            {users === null ? loadingLine : (
              <table>
                <thead>
                  <tr>
                    <th>用户</th><th>登录邮箱</th><th>绑定终端</th><th>终端状态</th>
                    <th style={{ width: 120 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const cid = u.client && u.client !== '—' ? u.client : ''
                    const node = cid ? list.find((x) => x.id === cid) : undefined
                    return (
                      <tr key={u.id ?? u.email ?? u.name}>
                        <td style={{ fontWeight: 550 }}>{u.name}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--ink-3)' }}>{u.email || '未登记'}</td>
                        <td>
                          {cid
                            ? <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>{cid}</span>
                            : <span style={{ color: 'var(--ink-4)' }}>未绑定</span>}
                        </td>
                        <td>
                          {node
                            ? <Tag tone={stateTag[node.state].tone} dot>{stateTag[node.state].l}</Tag>
                            : <span style={{ color: 'var(--ink-4)' }}>—</span>}
                        </td>
                        <td>
                          {cid ? (
                            <button className="btn btn-outline btn-xs" onClick={() => setUnbindFor({ clientId: cid, u })}>
                              <Icon name="x" size={12} />解除绑定
                            </button>
                          ) : (
                            <span style={{ color: 'var(--ink-5)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}

      {logFor && <LogModal client={logFor} onClose={() => setLogFor(null)} />}
      {upFor && (
        <UpgradeModal
          client={upFor}
          release={release}
          onClose={() => setUpFor(null)}
          onSent={() => { loadRelease(); reloadClients() }}
        />
      )}
      {unbindFor && (
        <Modal
          title="解除用户绑定"
          width={480}
          onClose={() => setUnbindFor(null)}
          footer={
            <>
              <button className="btn btn-sm" onClick={() => setUnbindFor(null)}>取消</button>
              <button className="btn btn-primary btn-sm" disabled={busy === 'unbind'} onClick={doUnbind}>
                {busy === 'unbind' ? '处理中…' : '确认解除'}
              </button>
            </>
          }
        >
          <div style={{ fontSize: 13.5, lineHeight: 1.8 }}>
            即将解除 <strong>{unbindFor.u.name}</strong>（{unbindFor.u.email ? `邮箱 ${unbindFor.u.email}` : '未登记邮箱'}）与终端 <strong>{unbindFor.clientId}</strong> 的绑定。
            <div style={{ color: 'var(--ink-3)', marginTop: 8 }}>
              用户绑定后不可自行更换，这里是唯一解绑出口；解绑后该用户可重新绑定任意终端，
              其个人配置层立即失效，在线终端会自动重推配置。
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ============================ 运行日志弹框 ============================ */

/** 日志区固定高度：切换「服务端事件 / 客户端日志 / AI 调用」时面板尺寸保持不变 */
const LOG_BOX_H = 420

function LogModal({ client, onClose }: { client: ClientNode; onClose: () => void }) {
  const { toast } = useToast()
  const [tab, setTab] = useState<'server' | 'agent' | 'ai'>('server')
  const [entries, setEntries] = useState<ClientLogEntry[]>([])
  const [ai, setAi] = useState<AiCallLog[]>([])
  const [online, setOnline] = useState(client.state !== 'off')
  const [total, setTotal] = useState(0)
  const [live, setLive] = useState(true)
  const [loading, setLoading] = useState(true)
  const [pulling, setPulling] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  const load = useCallback(async () => {
    try {
      const r = await fetchClientLogs(client.id)
      setEntries(r.entries)
      setTotal(r.total)
      setOnline(r.online)
    } catch {
      // 轮询失败静默重试，不打扰用户
    } finally {
      setLoading(false)
    }
  }, [client.id])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!live) return
    const t = window.setInterval(load, 3000)
    return () => window.clearInterval(t)
  }, [live, load])
  useEffect(() => {
    if (tab !== 'ai') return
    fetchClientAiLogs(client.id).then(setAi).catch(() => setAi([]))
  }, [tab, client.id])
  useEffect(() => {
    const el = bodyRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [entries, tab])

  const onScroll = () => {
    const el = bodyRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const shown = entries.filter((e) => (e.source === 'agent' ? tab === 'agent' : tab === 'server'))
  const agentCount = entries.filter((e) => e.source === 'agent').length

  const pull = async () => {
    setPulling(true)
    try {
      const r = await pullClientLogs(client.id)
      toast(r.hint)
      if (r.requested) {
        setTab('agent')
        window.setTimeout(load, 1500)
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '拉取失败')
    } finally {
      setPulling(false)
    }
  }

  const copyAll = () => {
    const text = shown.map((e) => `[${e.ts}] ${e.level.toUpperCase()} ${e.message}`).join('\n')
    navigator.clipboard?.writeText(text).catch(() => {})
    toast(`已复制 ${shown.length} 行日志`)
  }

  const clear = async () => {
    try {
      const r = await clearClientLogs(client.id)
      toast(`已清空 ${r.cleared} 条缓冲日志`)
      load()
    } catch {
      toast('清空失败')
    }
  }

  return (
    <Modal
      title={`运行日志 · ${client.id}`}
      width={920}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline btn-sm" onClick={clear}><Icon name="trash" size={15} />清空</button>
          <button className="btn btn-outline btn-sm" onClick={copyAll}><Icon name="copy" size={15} />复制</button>
          <button className="btn btn-primary btn-sm" disabled={pulling} onClick={pull}>
            <Icon name="download" size={15} />{pulling ? '已下发拉取…' : '拉取本地日志'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <Seg
          value={tab}
          onChange={setTab}
          options={[
            { v: 'server', l: '服务端事件' },
            { v: 'agent', l: `客户端日志${agentCount ? ` (${agentCount})` : ''}` },
            { v: 'ai', l: 'AI 调用' },
          ]}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--ink-3)' }}>
            <span className={`cdot ${online ? 'on' : 'off'}`} />
            {online ? '在线' : '离线'}
            <span style={{ color: 'var(--ink-4)' }}>· 缓冲 {total} 条</span>
          </span>
          {tab !== 'ai' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--ink-3)' }}>
              实时
              <Switch on={live} onClick={() => setLive(!live)} />
            </span>
          )}
        </div>
      </div>

      {/* 固定高度容器：三个 Tab 共用，避免切换时面板跳动 */}
      <div style={{ marginTop: 16, height: LOG_BOX_H }}>
        {tab === 'ai' ? (
          <div style={{ height: '100%', overflow: 'auto' }}>
            {ai.length === 0 ? (
              <div
                className="empty"
                style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="bolt" size={30} />
                <div style={{ fontSize: 13, marginTop: 10 }}>该客户端尚未上报 AI 调用</div>
              </div>
            ) : (
              ai.map((l, i) => (
                <div key={i} className="card card-pad" style={{ marginBottom: 10, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--ink-3)' }}>
                    <span style={{ fontFamily: 'var(--mono)' }}>{l.time} · {l.issue}</span>
                    <span>{l.backend}/{l.model} · {l.node} · {l.latency}{l.missingVars ? ' · 变量缺失' : ''}</span>
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-4)', marginTop: 10, maxHeight: 90, overflow: 'hidden', whiteSpace: 'pre-wrap' }}>
                    {l.prompt.slice(0, 320) || '（无渲染 Prompt）'}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div
            className="codeblk"
            ref={bodyRef}
            onScroll={onScroll}
            style={{ height: '100%', maxHeight: 'none', minHeight: 0 }}
          >
            {loading ? (
              '加载中…'
            ) : shown.length === 0 ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                <div>
                  {tab === 'agent'
                    ? '暂无客户端本机日志。\n点击右下角「拉取本地日志」，客户端会把 logs/agent.log 的尾部回传上来。'
                    : '暂无服务端事件。\n客户端上线、配置下发、任务下发与回执都会记录在这里。'}
                </div>
              </div>
            ) : (
              shown.map((e, i) => (
                <div className="ln" key={`${e.ts}-${i}`}>
                  <span className="ts">{hms(e.ts)}</span>
                  <span className={e.level}>
                    {e.source === 'agent' ? '· ' : ''}{e.message}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 提示行三 Tab 共用同一文案与行数，确保弹框高度不随 Tab 变化 */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, fontSize: 12.5, lineHeight: 1.7, color: 'var(--ink-4)' }}>
        <span style={{ flex: 'none', paddingTop: 2 }}><Icon name="info" size={14} /></span>
        <span>
          服务端事件为平台侧观测（上线、配置下发、任务回执、离线）；客户端日志需点「拉取本地日志」从终端
          <code style={{ fontFamily: 'var(--mono)' }}>logs/agent.log</code>
          取回；AI 调用由客户端在工作流执行时上报。
        </span>
      </div>
    </Modal>
  )
}

/* ============================ 静默升级弹框 ============================ */
function UpgradeModal({
  client, release, onClose, onSent,
}: { client: ClientNode; release: AgentRelease | null; onClose: () => void; onSent: () => void }) {
  const { toast } = useToast()
  const [sending, setSending] = useState(false)
  const outdated = release?.available ? versionOlder(client.version, release.version) : false

  const send = async () => {
    setSending(true)
    try {
      const r = await upgradeClient(client.id)
      toast(r.hint)
      if (r.pushed) onSent()
      if (r.pushed) onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : '下发失败')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      title={`静默升级 · ${client.id}`}
      width={600}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline btn-sm" onClick={onClose}>取消</button>
          <button className="btn btn-primary btn-sm" disabled={sending || !release?.available} onClick={send}>
            <Icon name="upload" size={15} />{sending ? '下发中…' : '确认升级'}
          </button>
        </>
      }
    >
      {!release?.available ? (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.75 }}>
          服务端还没有可发布的客户端安装包。
          <div style={{ marginTop: 10, color: 'var(--ink-4)' }}>
            发布目录：<code style={{ fontFamily: 'var(--mono)' }}>{release?.releaseDir ?? 'client/target'}</code>
          </div>
          <div style={{ marginTop: 10, color: 'var(--ink-4)' }}>
            执行 <code style={{ fontFamily: 'var(--mono)' }}>client\build-package.bat</code> 打包后即可在这里看到版本。
          </div>
        </div>
      ) : (
        <>
          <div className="grid g2">
            <div className="card card-pad" style={{ padding: 16 }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-4)', letterSpacing: '.04em' }}>当前版本</div>
              <div style={{ fontSize: 22, fontWeight: 660, marginTop: 8, fontFamily: 'var(--mono)' }}>
                {client.version === '—' ? '未知' : client.version}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 6 }}>
                {outdated ? '低于服务端发布版' : '已是最新'}
              </div>
            </div>
            <div className="card card-pad" style={{ padding: 16 }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-4)', letterSpacing: '.04em' }}>目标版本</div>
              <div style={{ fontSize: 22, fontWeight: 660, marginTop: 8, fontFamily: 'var(--mono)', color: '#4f46e5' }}>
                {release.version}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 6 }}>{release.updatedAt}</div>
            </div>
          </div>

          <table style={{ marginTop: 16 }}>
            <tbody>
              <tr><td style={{ width: 120, color: 'var(--ink-4)' }}>安装包</td><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{release.fileName}</td></tr>
              <tr><td style={{ color: 'var(--ink-4)' }}>大小</td><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{sizeText(release.size)}</td></tr>
              <tr><td style={{ color: 'var(--ink-4)' }}>SHA256</td><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{shortSha(release.sha256)}</td></tr>
            </tbody>
          </table>

          <div style={{ marginTop: 18, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.8 }}>
            下发后客户端在后台完成下列动作，研发人员无感：
            <div style={{ marginTop: 8, color: 'var(--ink-4)' }}>
              1. 从服务端下载安装包 → 2. 校验 SHA256，不匹配立即中止
              → 3. 写入 <code style={{ fontFamily: 'var(--mono)' }}>upgrade\</code> 暂存
              → 4. 由独立进程替换 jar 并自动重启 → 5. 结果回传服务端「查看日志」
            </div>
            <div style={{ marginTop: 8, color: 'var(--ink-4)' }}>
              提示：客户端 <code style={{ fontFamily: 'var(--mono)' }}>client.allowUpgrade: false</code> 时会拒绝远程升级，
              需在该终端手工执行 <code style={{ fontFamily: 'var(--mono)' }}>scripts\upgrade.bat</code>。
            </div>
          </div>
        </>
      )}
    </Modal>
  )
}
