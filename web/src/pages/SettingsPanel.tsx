import { useEffect, useState } from 'react'
import { Icon } from '../icons'
import { Dropdown, Modal, Seg, Switch, Tag, useToast } from '../ui'
import {
  fetchClients, fetchRepos, fetchUserProfile, fetchUsers, probeGit, probeToolchain,
  saveProfileSettings, saveUser, useAsync,
} from '../api'
import { profileSaveHint } from '../api'
import type { ProbeResult } from '../api'
import type { ClientNode, UserRow } from '../types'
import { getUser } from '../auth'
import {
  ACCENTS, applySettings, loadProfile, saveSettings,
} from '../settings'
import {
  notifyPermission, requestNotifyPermission, sendTestNotification,
} from '../notify'
import type { AccentKey, NotifyPrefs, ScaleKey, Settings, ThemeMode } from '../settings'
// Coding Agent 编辑器与设置面板、「Coding Agent 配置」管理页共用同一份实现，避免两套行为漂移
import { AgentConfigEditor, ProbeView } from '../components/AgentConfigEditor'

type Tab = 'appearance' | 'general' | 'agent' | 'git' | 'tool'

/**
 * 右上角设置面板：偏好 / Coding Agent（多条 + 拖拽排序 + 真机测试）/ Git 凭据 / 本机工具链。
 * Agent 与 Git 的「测试」都经 gRPC 下发到绑定客户端本机执行（C/S 架构下唯一可行路径）。
 */
export default function SettingsPanel({ initial, onboard, onClose }: {
  initial: Settings
  /** 首次登录引导：默认落在 Coding Agent 页，标题与文案不同 */
  onboard?: boolean
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>(onboard ? 'agent' : 'appearance')

  return (
    <Modal
      title={onboard ? '欢迎使用 Talos · 初始配置' : '设置'}
      width={1080}
      height='94vh'
      onClose={onClose}
      /* 普通设置态不设 footer：各 Tab 已有自己的保存按钮，右上角 ✕ / Esc / 点遮罩关闭；
         仅首次登录引导保留「完成并进入控制台」收尾 CTA */
      footer={onboard ? (
        <>
          <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>
            配置保存后随下次配置下发到你的客户端；测试会连到你绑定的客户端本机真实执行。
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" onClick={onClose}>
            完成并进入控制台
          </button>
        </>
      ) : undefined}>
      <Seg<Tab>
        value={tab}
        options={[
          { v: 'appearance', l: '外观' },
          { v: 'general', l: '通用' },
          { v: 'agent', l: 'Coding Agent' },
          { v: 'git', l: 'Git 凭据' },
          { v: 'tool', l: '工具链' },
        ]}
        onChange={setTab}
      />
      <div style={{ marginTop: 18 }}>
        {tab === 'appearance' && <AppearanceTab initial={initial} />}
        {tab === 'general' && <GeneralTab initial={initial} />}
        {tab === 'agent' && <AgentTab />}
        {tab === 'git' && <GitTab />}
        {tab === 'tool' && <ToolTab />}
      </div>
    </Modal>
  )
}

/* ============================ 外观 ============================ */
function AppearanceTab({ initial }: { initial: Settings }) {
  const [s, setS] = useState<Settings>(initial)
  const patch = (p: Partial<Settings>) => {
    const next = { ...s, ...p }
    setS(next)
    saveSettings(next) // 实时持久化 + 应用，改完立刻可见
  }

  return (
    <div>
      <div className="set-sec" style={{ marginTop: 0 }}>
        <div className="set-label">主题色</div>
        <div className="swatches">
          {(Object.keys(ACCENTS) as AccentKey[]).map((k) => (
            <button
              key={k}
              className={`swatch ${s.accent === k ? 'on' : ''}`}
              style={{ background: ACCENTS[k].accent }}
              title={ACCENTS[k].label}
              onClick={() => patch({ accent: k })}
            />
          ))}
        </div>
      </div>

      <div className="set-sec">
        <div className="set-label">明暗主题</div>
        <Seg<ThemeMode>
          value={s.theme}
          options={[
            { v: 'light', l: '浅色' },
            { v: 'dark', l: '深色' },
            { v: 'system', l: '跟随系统' },
          ]}
          onChange={(v) => patch({ theme: v })}
        />
        <div className="fhelp">深色主题下主题色自动提亮一档，保证深色底上的对比度。</div>
      </div>

      <div className="set-sec">
        <div className="set-label">界面缩放</div>
        <Seg<ScaleKey>
          value={s.scale}
          options={[{ v: 'sm', l: '小' }, { v: 'md', l: '标准' }, { v: 'lg', l: '大' }]}
          onChange={(v) => patch({ scale: v })}
        />
      </div>

      <div className="set-sec">
        <div className="set-label">界面密度</div>
        <Seg
          value={s.density}
          options={[{ v: 'comfort' as const, l: '舒适' }, { v: 'compact' as const, l: '紧凑' }]}
          onChange={(v) => patch({ density: v })}
        />
      </div>

      <div className="set-sec">
        <div className="set-label">侧栏默认折叠</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--ink-2)' }}>
          <Switch on={s.sideCollapsed} onClick={() => patch({ sideCollapsed: !s.sideCollapsed })} />
          进入控制台时侧栏只显示图标（侧栏顶部 ⇄ 可随时切换）
        </label>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn btn-outline btn-sm"
          onClick={() => patch({
            accent: 'indigo', density: 'comfort', theme: 'light', scale: 'md', sideCollapsed: false,
          })}>
          恢复外观默认
        </button>
      </div>
    </div>
  )
}

/* ============================ 通用 ============================ */
function GeneralTab({ initial }: { initial: Settings }) {
  const { toast } = useToast()
  const [s, setS] = useState<Settings>(initial)
  /** 浏览器通知授权状态（点「开启权限」后刷新） */
  const [perm, setPerm] = useState(() => notifyPermission())

  /** 工作流自动执行开关（服务端持久化在当前登录用户的个人设置里） */
  const [autoStart, setAutoStart] = useState(true)
  const [autoDirty, setAutoDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const { data } = useAsync(() => fetchUserProfile(), [])
  useEffect(() => {
    if (data) setAutoStart(data.autoStart !== false)
  }, [data])

  const patch = (p: Partial<Settings>) => {
    const next = { ...s, ...p }
    setS(next)
    saveSettings(next) // 实时持久化 + 应用，改完立刻可见
  }
  const patchNotify = (p: Partial<NotifyPrefs>) => patch({ notify: { ...s.notify, ...p } })

  const askPerm = async () => {
    const r = await requestNotifyPermission()
    setPerm(r)
    if (r === 'granted') { patchNotify({ enabled: true }); toast('已开启桌面通知') }
    else if (r === 'denied') toast('浏览器已拒绝通知权限，需在站点设置里手动恢复')
  }

  const testNotify = () => {
    // 无论浏览器是否授权，都会记进右上角通知中心
    if (sendTestNotification()) toast('已发送测试通知')
    else toast('桌面通知未授权，已记入右上角通知中心')
  }

  const save = async () => {
    setSaving(true)
    try {
      await saveProfileSettings({ autoStart })
      setAutoDirty(false)
      toast('已保存通用设置')
    } catch (e) {
      toast(`保存失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <BindClientBar />
      <div style={{ height: 14 }} />
      <div className="set-sec" style={{ marginTop: 0 }}>
        <div className="set-label">工作流自动执行</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <Switch on={autoStart} onClick={() => { setAutoStart((v) => !v); setAutoDirty(true) }} />
          <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>自动执行我提出的 Issue 工作流</span>
        </label>
        <div style={{ fontSize: 12.5, color: 'var(--ink-4)', margin: '8px 0 0', lineHeight: 1.7 }}>
          开启后，你提出的 Issue 一旦通过准入并完成分拣即自动启动工作流，客户端离线时会在其上线后自动补启；
          关闭后停在「分拣中」，需在 Issue 详情手动点击「启动工作流」确认。
        </div>
      </div>

      <div className="set-sec">
        <div className="set-label">登录后默认页</div>
        <Seg
          value={s.homePage}
          options={[{ v: 'dashboard' as const, l: '总览' }, { v: 'issues' as const, l: 'Issue' }, { v: 'monitor' as const, l: '作业监控' }]}
          onChange={(v) => patch({ homePage: v })}
        />
      </div>

      <div className="set-sec">
        <div className="set-label">通知与提醒</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--ink-2)' }}>
          <Switch on={s.notify.enabled} onClick={() => patchNotify({ enabled: !s.notify.enabled })} />
          启用桌面通知（作业与 Issue 状态变化时提醒，每 30 秒检查一次）
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
          {perm === 'unsupported'
            ? <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>当前浏览器不支持桌面通知，仅保留应用内提醒</span>
            : perm === 'granted'
              ? <Tag tone="ok" dot>已授权桌面通知</Tag>
              : perm === 'denied'
                ? <Tag tone="warn" dot>已被浏览器拒绝</Tag>
                : <Tag tone="mut" dot>未授权</Tag>}
          {perm === 'default' && (
            <button className="btn btn-outline btn-sm" onClick={askPerm}>开启桌面通知权限</button>
          )}
          {perm === 'granted' && (
            <button className="btn btn-outline btn-sm" onClick={testNotify}><Icon name="bell" size={13} />发送测试通知</button>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--ink-2)' }}>
            <Switch on={s.notify.jobDone} onClick={() => patchNotify({ jobDone: !s.notify.jobDone })} />
            作业完成
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--ink-2)' }}>
            <Switch on={s.notify.jobFailed} onClick={() => patchNotify({ jobFailed: !s.notify.jobFailed })} />
            作业失败 / 被阻断
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--ink-2)' }}>
            <Switch on={s.notify.newIssue} onClick={() => patchNotify({ newIssue: !s.notify.newIssue })} />
            有新 Issue 录入
          </label>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn btn-primary btn-sm" disabled={saving || !autoDirty} onClick={save}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}

/* ==================== Coding Agent（与「Coding Agent 配置」管理页共用编辑器） ==================== */
/**
 * 本人配置入口：会话级 /profile/me 自动定位当前登录用户，编辑界面完全复用 AgentConfigEditor，
 * 与管理员在「Coding Agent 配置 → 用户配置汇总」里改任意用户是同一份实现。
 */
function AgentTab() {
  return (
    <AgentConfigEditor
      desc={<>
        可配置多个后端，<b>列表顺序即优先级</b>（拖拽 ⠿ 调整）；执行任务时从上往下选第一个可用的。
        服务端不再预设任何默认后端，你配置的后端即该客户端可用的后端，保存后<b>立即重推给你绑定的客户端</b>。
      </>}
    />
  )
}

/* ============================ Git 凭据 ============================ */
function GitTab() {
  const { toast } = useToast()
  const { data, reload } = useAsync(() => fetchUserProfile(), [])
  const { data: repos } = useAsync(() => fetchRepos(), [])

  const [token, setToken] = useState('')
  const [clearToken, setClearToken] = useState(false)
  const [gitUser, setGitUser] = useState('')
  const [gitEmail, setGitEmail] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [repoHydrated, setRepoHydrated] = useState(false)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState(false)
  const [gitResult, setGitResult] = useState<ProbeResult | null>(null)

  useEffect(() => {
    if (!data) return
    setGitUser(data.gitUserName ?? '')
    setGitEmail(data.gitUserEmail ?? '')
  }, [data])

  // 测试仓库地址：已保存值优先，否则回落到第一个启用仓库（只回填一次）
  useEffect(() => {
    if (repoHydrated || !data || !repos?.length) return
    const saved = data.gitTestRepoUrl?.trim()
    if (saved) {
      setRepoUrl(saved)
    } else {
      const first = repos.find((r) => r.enabled !== false)
      if (first?.repoUrl) setRepoUrl(first.repoUrl)
    }
    setRepoHydrated(true)
  }, [data, repos, repoHydrated])

  const save = async () => {
    setSaving(true)
    try {
      const r = await saveProfileSettings({
        gitToken: token.trim(),
        clearGitToken: clearToken,
        gitUserName: gitUser.trim(),
        gitUserEmail: gitEmail.trim(),
        gitTestRepoUrl: repoUrl.trim(),
      })
      setToken('')
      setClearToken(false)
      toast(profileSaveHint(r))
      reload()
    } catch (e) {
      toast(`保存失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  const testGit = async () => {
    setProbing(true)
    try {
      const r = await probeGit(repoUrl.trim(), token.trim() || undefined)
      setGitResult(r)
    } catch (e) {
      setGitResult({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setProbing(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
        <Icon name="git" size={15} />
        <b style={{ fontSize: 13.5 }}>Git 凭据</b>
        {data?.gitTokenSet
          ? <Tag tone="ok" dot>Token 已配置 {data.gitTokenMask}</Tag>
          : <Tag tone="warn" dot>Token 未配置</Tag>}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '8px 0 12px', lineHeight: 1.7 }}>
        Token 用于客户端克隆、拉取与推送私有仓库（https 鉴权）。只存服务端不回显明文，客户端执行任务时经加密通道获取。
      </div>
      <div className="field" style={{ marginTop: 0 }}>
        <label>
          访问令牌（Token）
          {data?.gitTokenSet && !clearToken && (
            <span style={{ fontWeight: 400, color: 'var(--ink-4)', marginLeft: 8 }}>已配置 {data.gitTokenMask}，留空表示不修改</span>
          )}
          {clearToken && <span style={{ fontWeight: 400, color: 'var(--warn-ink, #b45309)', marginLeft: 8 }}>保存后将清空 Token</span>}
        </label>
        <input type="password" value={clearToken ? '' : token} disabled={clearToken}
          placeholder={data?.gitTokenSet ? '输入新 Token 以替换' : 'ghp_... 或平台访问令牌'}
          onChange={(e) => setToken(e.target.value)} />
        {data?.gitTokenSet && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12.5, fontWeight: 400, color: 'var(--ink-3)' }}>
            <input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={clearToken}
              onChange={(e) => { setClearToken(e.target.checked); if (e.target.checked) setToken('') }} />
            清空已保存的 Token
          </label>
        )}
      </div>
      <div className="grid g2" style={{ gap: 12 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>git user.name（提交署名）</label>
          <input value={gitUser} placeholder="如 YangDe" onChange={(e) => setGitUser(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>git user.email</label>
          <input value={gitEmail} placeholder="如 name@company.com" onChange={(e) => setGitEmail(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>
          测试仓库地址（用上面的 Token 真实 ls-remote 一次）
          <span style={{ fontWeight: 400, color: 'var(--ink-4)', marginLeft: 8 }}>随「保存」一起持久化，留空则每次回落到第一个启用仓库</span>
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={repoUrl} placeholder="https://git.example.com/group/repo.git"
            onChange={(e) => setRepoUrl(e.target.value)} />
          <button className="btn btn-outline btn-sm" style={{ whiteSpace: 'nowrap' }} disabled={probing} onClick={testGit}>
            <Icon name="bolt" size={14} />{probing ? '测试中…' : '测试 Git'}
          </button>
        </div>
      </div>
      {gitResult && <ProbeView r={gitResult} />}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button className="btn btn-primary btn-sm" disabled={saving} onClick={save}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}

/* ============================ 本机工具链 ============================ */
function ToolTab() {
  const { toast } = useToast()
  const { data, reload } = useAsync(() => fetchUserProfile(), [])

  const [workDir, setWorkDir] = useState('')
  const [mavenHome, setMavenHome] = useState('')
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState(false)
  const [tcResult, setTcResult] = useState<ProbeResult | null>(null)

  useEffect(() => {
    if (!data) return
    setWorkDir(data.workDir ?? '')
    setMavenHome(data.mavenHome ?? '')
  }, [data])

  const save = async () => {
    setSaving(true)
    try {
      const r = await saveProfileSettings({
        workDir: workDir.trim(),
        mavenHome: mavenHome.trim(),
      })
      toast(profileSaveHint(r))
      reload()
    } catch (e) {
      toast(`保存失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(false)
    }
  }

  const testToolchain = async () => {
    setProbing(true)
    try {
      const r = await probeToolchain(workDir.trim(), mavenHome.trim())
      setTcResult(r)
    } catch (e) {
      setTcResult({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setProbing(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
        <Icon name="cpu" size={15} />
        <b style={{ fontSize: 13.5 }}>本机工具链</b>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '8px 0 12px', lineHeight: 1.7 }}>
        工作目录是客户端的工作区根目录（优先于客户端默认配置），实际检出路径为
        {' '}<code style={{ fontSize: 12 }}>&lt;工作目录&gt;/&lt;Issue 编号&gt;/&lt;仓库名&gt;/</code>。
        每个 Issue 一份独立工作副本，多个需求并行时互不污染。
        Maven 目录的 bin 会在执行 Coding Agent 时前置到 PATH。
      </div>
      <div className="grid g2" style={{ gap: 12 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>工作目录（workDir）</label>
          <input value={workDir} placeholder="如 D:\\Talos\\workspace" onChange={(e) => setWorkDir(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Maven 安装目录</label>
          <input value={mavenHome} placeholder="如 D:\\develop\\tool\\apache-maven-3.9.9"
            onChange={(e) => setMavenHome(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button className="btn btn-outline btn-sm" disabled={probing} onClick={testToolchain}>
          <Icon name="bolt" size={14} />{probing ? '测试中…' : '测试工具链'}
        </button>
      </div>
      {tcResult && <ProbeView r={tcResult} />}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button className="btn btn-primary btn-sm" disabled={saving} onClick={save}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}

/* ============================ 复用小组件 ============================ */

/** 绑定客户端（面板顶部常驻）：Agent/Git 测试与配置下发都经这条绑定关系 */
function BindClientBar() {
  const { toast } = useToast()
  // 当前登录身份：登录态里的邮箱优先（邮箱 = 用户身份，按它到用户表匹配本人记录）
  const myEmail = (getUser()?.email || loadProfile().email).trim().toLowerCase()
  const [userRows, setUserRows] = useState<UserRow[] | null>(null)
  const [userErr, setUserErr] = useState(false)
  const [clientList, setClientList] = useState<ClientNode[]>([])
  const [bindOverride, setBindOverride] = useState<string | null>(null)
  const [bindSaving, setBindSaving] = useState(false)

  useEffect(() => {
    let alive = true
    if (myEmail) {
      fetchUsers().then((us) => { if (alive) setUserRows(us) })
        .catch(() => { if (alive) setUserErr(true) })
    }
    fetchClients().then((cs) => { if (alive) setClientList(cs) }).catch(() => {})
    return () => { alive = false }
  }, [myEmail])

  const me = myEmail ? userRows?.find((u) => u.email && u.email.trim().toLowerCase() === myEmail) ?? null : null
  const serverClient = me ? (me.client === '—' ? '' : me.client) : ''
  const bind = bindOverride ?? serverClient

  const saveBind = async () => {
    if (!me) return
    setBindSaving(true)
    try {
      await saveUser({
        id: me.id, name: me.name, email: me.email, role: me.role,
        bizCodes: me.bizCodes, clientId: bind.trim() || undefined,
      })
      setBindOverride(null)
      setUserRows((rows) => rows
        ? rows.map((u) => (u.id === me.id ? { ...u, client: bind.trim() || '—' } : u))
        : rows)
      toast(bind.trim() ? `已绑定客户端 ${bind.trim()}` : '已解除客户端绑定')
    } catch (e) {
      toast(`绑定失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBindSaving(false)
    }
  }

  return (
    <div style={{
      border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px',
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    }}>
      <Icon name="client" size={15} className="bindbar-ic" />
      <b style={{ fontSize: 13, flex: 'none' }}>绑定客户端</b>
      {!myEmail ? (
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>当前登录账号没有邮箱信息，无法定位用户记录。</span>
      ) : userErr ? (
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>无法读取用户数据（服务未启动或接口异常）。</span>
      ) : userRows === null ? (
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>读取绑定关系中…</span>
      ) : me ? (
        serverClient ? (
          /* 已绑定 → 锁定：绑定关系只能由管理员在「客户端管理」解除 */
          <>
            <Tag tone="ok" dot>{serverClient}</Tag>
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
              已绑定 · 不可自行更换；如需更换，请联系管理员在「客户端」页解除绑定。
            </span>
          </>
        ) : (
          <>
            <Dropdown value={bind} style={{ flex: 1, minWidth: 200 }}
              onChange={setBindOverride}
              options={[
                ...clientList.map((c) => ({
                  v: c.id, l: `${c.id} · ${c.state === 'on' ? '在线' : c.state === 'busy' ? '执行中' : '离线'}`,
                })),
                ...(bind && !clientList.some((c) => c.id === bind) ? [{ v: bind, l: `${bind} · 已失效` }] : []),
              ]}
            />
            <button className="btn btn-outline btn-sm" disabled={bindSaving || bind === serverClient}
              onClick={saveBind}>
              {bindSaving ? '保存中…' : '保存绑定'}
            </button>
            <div style={{ width: '100%', fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.6 }}>
              绑定后，测试与配置将下发到该机器执行；绑定后不可自行更换，如需更换请联系管理员在「客户端」页解除绑定。
            </div>
          </>
        )
      ) : (
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
          登录邮箱 {myEmail} 未在「用户管理」中登记（或该用户未登记邮箱），无法绑定客户端。
        </span>
      )}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.7 }}>
      <Icon name="info" size={16} />
      <div>{children}</div>
    </div>
  )
}
