import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../icons'
import { BRANDS, BrandMark } from '../brands'
import { Kpi, Modal, PageH, Search, Seg, Switch, Tag, useToast } from '../ui'
import {
  clearClientLogs, fetchAgentRelease, fetchClientAiLogs, fetchClientLogs, fetchClients, fetchClientStats,
  fetchUsers, pullClientLogs, pushClientConfig, reconnectAllClients, reconnectClient, unbindClientUser,
  upgradeAllClients, upgradeClient, useAsync, versionOlder,
} from '../api'
import type { AgentRelease, AiCallLog, ClientLogEntry, ClientNode, PageFocus, PageKey, UserRow } from '../types'

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

type StateFilter = 'all' | 'on' | 'off' | 'stale'

export default function Clients({ focus, nav }: { focus?: PageFocus; nav: (p: PageKey, f?: PageFocus) => void }) {
  const { toast } = useToast()
  const { data: clients, loading } = useAsync<ClientNode[]>(() => fetchClients(), [])
  const { data: stats } = useAsync(() => fetchClientStats(), [])
  const { data: users, reload: reloadUsers } = useAsync<UserRow[]>(() => fetchUsers(), [])
  const [release, setRelease] = useState<AgentRelease | null>(null)
  const [q, setQ] = useState('')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [logFor, setLogFor] = useState<ClientNode | null>(null)
  const [upFor, setUpFor] = useState<ClientNode | null>(null)
  const [unbindFor, setUnbindFor] = useState<{ c: ClientNode; u: UserRow } | null>(null)
  const [busy, setBusy] = useState('')

  useEffect(() => { fetchAgentRelease().then(setRelease).catch(() => setRelease(null)) }, [])

  const list = clients ?? []
  const online = list.filter((c) => c.state !== 'off').length
  const totalAgents = list.reduce((s, c) => s + (c.agents.filter((a) => a !== '—').length), 0)
  const offline = list.length - online
  const outdated = release?.available
    ? list.filter((c) => c.state !== 'off' && versionOlder(c.version, release.version))
    : []
  const outdatedIds = useMemo(() => new Set(outdated.map((c) => c.id)), [outdated])

  const stateOptions: { v: StateFilter; l: string }[] = [
    { v: 'all', l: `全部 ${list.length}` },
    { v: 'on', l: `在线 ${online}` },
    { v: 'off', l: `离线 ${offline}` },
  ]
  if (outdated.length) stateOptions.push({ v: 'stale', l: `待升级 ${outdated.length}` })

  const shown = list
    .filter((c) => !q || c.id.includes(q) || c.owner.includes(q) || c.ip.includes(q))
    .filter((c) => {
      if (stateFilter === 'all') return true
      if (stateFilter === 'off') return c.state === 'off'
      if (stateFilter === 'on') return c.state !== 'off'
      return outdatedIds.has(c.id)
    })

  /* ---- 来自总览的下钻条件 ---- */
  const handledRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!focus) return
    if (focus.offline) setStateFilter('off')
    else if (focus.outdated) setStateFilter('stale')
    else if (focus.status === 'on') setStateFilter('on')
    if (focus.q) setQ(focus.q)
  }, [focus?.at]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focus?.clientId || !clients) return
    if (handledRef.current === focus.at) return
    const hit = clients.find((c) => c.id === focus.clientId)
    if (!hit) return
    handledRef.current = focus.at
    setLogFor(hit)
  }, [focus, clients])

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key)
    try { toast(await fn()) } catch (e) { toast(e instanceof Error ? e.message : '操作失败') } finally { setBusy('') }
  }

  /** 该客户端绑定的用户（绑定后用户不可自行改绑，这里是唯一解绑出口） */
  const boundOf = (clientId: string) => (users ?? []).filter((u) => u.client === clientId)

  const doUnbind = async () => {
    if (!unbindFor) return
    const { c, u } = unbindFor
    await act('unbind', async () => {
      const r = await unbindClientUser(c.id, u.no)
      reloadUsers()
      setUnbindFor(null)
      return r.configPushed
        ? `已解除 ${u.name} 与 ${c.id} 的绑定，并已重推配置`
        : `已解除 ${u.name} 与 ${c.id} 的绑定`
    })
  }

  return (
    <div>
      <PageH
        title="客户端"
        desc="所有接入 Talos 的研发终端及其连接状态、运行日志与版本。"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            {outdated.length > 0 && (
              <button
                className="btn btn-primary btn-sm"
                disabled={busy === 'up-all'}
                onClick={() => act('up-all', async () => {
                  const r = await upgradeAllClients()
                  fetchAgentRelease().then(setRelease).catch(() => {})
                  return r.pushed > 0
                    ? `已向 ${r.pushed} 台客户端下发静默升级 → ${r.target}`
                    : (r.hint ?? '没有需要升级的在线客户端')
                })}
              >
                <Icon name="upload" size={15} />升级 {outdated.length} 台
              </button>
            )}
            <button
              className="btn btn-outline btn-sm"
              onClick={() => act('re-all', async () => {
                const r = await reconnectAllClients()
                return `已向 ${r.requested}/${r.online} 台在线客户端下发重连指令`
              })}
            >
              <Icon name="refresh" size={15} />全部重连
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => { navigator.clipboard?.writeText(INSTALL_CMD).catch(() => {}); toast('已复制接入命令') }}
            >
              <Icon name="copy" size={15} />复制接入命令
            </button>
          </div>
        }
      />

      {loading && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>}
      {!loading && clients === null && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>接口请求失败，请确认后端已启动（:8080）</div>}

      {!loading && clients !== null && (
        <>
          <div className="grid g4" style={{ marginBottom: 18 }}>
            <Kpi
              icon="client" label="在线" value={String(online)} delta={`/ ${list.length}`} dir="up"
              color="#0891b2" glow="rgba(8,145,178,.2)" hint="只看在线客户端"
              onClick={() => setStateFilter((f) => (f === 'on' ? 'all' : 'on'))}
            />
            <Kpi icon="agent" label="Coding Agent" value={String(totalAgents)} delta="已配置" dir="up" color="#4f46e5" />
            <Kpi
              icon="clock" label="心跳" value={list.length ? '实时' : '—'}
              delta={stats ? `${stats.onlineRate}% 在线率` : '正常'} dir="up" color="#16a34a" glow="rgba(22,163,74,.2)"
              hint="显示全部客户端"
              onClick={() => setStateFilter('all')}
            />
            <Kpi
              icon="warn" label="异常" value={String(offline)} delta="离线 / 超阈" dir={offline > 0 ? 'down' : 'up'}
              color="#b91c1c" glow="rgba(185,28,28,.18)" hint="只看离线客户端"
              onClick={() => setStateFilter((f) => (f === 'off' ? 'all' : 'off'))}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, gap: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Search placeholder="搜索客户端、责任人、IP" value={q} onChange={setQ} />
              <Seg value={stateFilter} onChange={setStateFilter} options={stateOptions} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-4)' }}>
              {release?.available ? (
                <>
                  <Icon name="cloud" size={14} />
                  服务端发布版 <b style={{ color: 'var(--ink-2)' }}>{release.version}</b>
                  <span>·</span>
                  <span>{release.updatedAt}</span>
                </>
              ) : (
                <>
                  <Icon name="warn" size={14} />
                  尚未发布客户端安装包（{release?.releaseDir ?? 'client/target'}）
                </>
              )}
            </div>
          </div>

          {stateFilter !== 'all' && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
              border: '1px solid var(--line)', borderLeft: '2px solid var(--accent)',
              borderRadius: 9, padding: '9px 12px', background: 'var(--bg-subtle)', fontSize: 12.5,
            }}>
              <Icon name="filter" size={14} />
              <span>
                已按状态筛选：<b style={{ marginLeft: 4 }}>
                  {stateFilter === 'on' ? '在线' : stateFilter === 'off' ? '离线' : '待升级（版本低于服务端发布版）'}
                </b>
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
                    <a
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--accent)', cursor: 'pointer' }}
                      onClick={() => nav('guide')}
                    >
                      查看接入指南，完成第一台终端接入 <Icon name="arrow" size={13} />
                    </a>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="grid g2">
              {shown.map((c) => {
                const canUpgrade = !!release?.available && versionOlder(c.version, release.version)
                const bound = boundOf(c.id)
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
                        {canUpgrade && <Tag tone="warn">可升级 {release?.version}</Tag>}
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
                      <span style={{ fontSize: 12, color: 'var(--ink-4)', flex: 'none' }}>绑定用户</span>
                      {bound.length === 0 ? (
                        <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>暂无 · 用户可在「设置」面板自行绑定</span>
                      ) : bound.map((u) => (
                        <span key={u.no ?? u.name} className="tag t-mut" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {u.name} · {u.no}
                          <button
                            title="解除绑定（解绑后用户可重新绑定）"
                            style={{
                              display: 'inline-flex', alignItems: 'center', padding: 2, margin: 0,
                              border: 'none', background: 'none', cursor: 'pointer',
                              color: 'var(--ink-4)', borderRadius: 4,
                            }}
                            onClick={() => setUnbindFor({ c, u })}
                          >
                            <Icon name="x" size={11} />
                          </button>
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
                      <button
                        className="btn btn-outline btn-xs"
                        disabled={busy === `up-${c.id}` || (release?.available && !canUpgrade)}
                        onClick={() => setUpFor(c)}
                      >
                        <Icon name="upload" size={13} />升级
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <a
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 20, fontSize: 12.5, color: 'var(--accent)', cursor: 'pointer' }}
            onClick={() => nav('guide')}
          >
            <Icon name="info" size={14} />
            新终端接入？安装命令、保活机制、配置字段与排障见「接入指南」（文档中心）
            <Icon name="arrow" size={13} />
          </a>
        </>
      )}

      {logFor && <LogModal client={logFor} onClose={() => setLogFor(null)} />}
      {upFor && (
        <UpgradeModal
          client={upFor}
          release={release}
          onClose={() => setUpFor(null)}
          onSent={() => { fetchAgentRelease().then(setRelease).catch(() => {}) }}
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
            即将解除 <strong>{unbindFor.u.name}</strong>（工号 {unbindFor.u.no}）与客户端 <strong>{unbindFor.c.id}</strong> 的绑定。
            <div style={{ color: 'var(--ink-3)', marginTop: 8 }}>
              用户绑定后不可自行更换，这里是唯一解绑出口；解绑后该用户可重新绑定任意客户端，
              其个人配置层立即失效，在线客户端会自动重推配置。
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
