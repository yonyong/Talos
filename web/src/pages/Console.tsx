import { useEffect, useRef, useState } from 'react'
import { Icon, Mark } from '../icons'
import { useToast, Modal } from '../ui'
import { navigate } from '../router'
import { startNotifier, stopNotifier } from '../notify'
import type { PageFocus, PageKey } from '../types'
import {
  applySettings, avatarText, loadProfile, loadSettings, saveProfile, saveSettings, SETTINGS_EVENT,
} from '../settings'
import type { Profile, Settings } from '../settings'
import { logout } from '../api'
import { broadcastAuth, clearAuth } from '../auth'
import Dashboard from './Dashboard'
import Issues from './Issues'
import Workflow from './Workflow'
import Monitor from './Monitor'
import Clients from './Clients'
import Agents from './Agents'
import Logs from './Logs'
import Docs from './Docs'
import Kb from './Kb'
import Biz from './Biz'
import Repos from './Repos'
import Prompts from './Prompts'
import Models from './Models'
import Users from './Users'
import Roles from './Roles'
import SettingsPanel from './SettingsPanel'
import NotifCenter from '../notifcenter'

/**
 * 侧边栏分组：按「你拿它干什么」切，而不是按「它是什么对象」切。
 *   运营     —— 看现状、办业务、收产出
 *   编排     —— 定义一条 Issue 进来后怎么走（含分拣所依赖的业务域、路由所依赖的仓库）
 *   AI 配置  —— 模型 / 提示词 / 知识 / 调用情况，全是「喂给 AI 的」
 *   执行节点 —— 机器上跑什么：节点本体、节点上的 CLI、怎么把节点装起来
 *   系统     —— 账号与权限
 * 换组不改 key，PAGE_KEYS / TITLE / PageKey 均不受影响。
 */
const NAV: { group: string; items: { k: PageKey; l: string; icon: string }[] }[] = [
  {
    group: '运营',
    items: [
      { k: 'dashboard', l: '总览', icon: 'dashboard' },
      { k: 'issues', l: 'Issue', icon: 'issue' },
      { k: 'monitor', l: '作业监控', icon: 'terminal' },
      { k: 'docs', l: '过程文档', icon: 'doc' },
    ],
  },
  {
    group: '编排',
    items: [
      { k: 'workflow', l: '工作流编排', icon: 'flow' },
      { k: 'biz', l: '业务域', icon: 'layers' },
      { k: 'repos', l: '仓库管理', icon: 'git' },
    ],
  },
  {
    group: 'AI 配置',
    items: [
      { k: 'models', l: '模型配置', icon: 'cloud' },
      { k: 'prompts', l: 'Prompt 模板', icon: 'file' },
      { k: 'kb', l: '知识库', icon: 'db' },
      { k: 'logs', l: '调用日志', icon: 'spark' },
    ],
  },
  {
    group: '执行节点',
    items: [
      { k: 'clients', l: '客户端', icon: 'client' },
      { k: 'agents', l: 'Coding Agent', icon: 'agent' },
    ],
  },
  {
    group: '系统',
    items: [
      { k: 'users', l: '用户管理', icon: 'users' },
      { k: 'roles', l: '权限管理', icon: 'shield' },
    ],
  },
]

const TITLE: Record<PageKey, string> = {
  dashboard: '总览', issues: 'Issue', workflow: '工作流编排',
  monitor: '作业监控', clients: '客户端', guide: '接入指南', agents: 'Coding Agent', logs: '调用日志',
  docs: '过程文档', kb: '知识库', users: '用户管理', roles: '权限管理',
  biz: '业务域', repos: '仓库管理', prompts: 'Prompt 模板', models: '模型配置',
}

/* ---------- 个人信息面板 ---------- */
function ProfileModal({ initial, onClose, onSave }: {
  initial: Profile
  onClose: () => void
  onSave: (p: Profile) => void
}) {
  const [p, setP] = useState<Profile>(initial)
  const [saving, setSaving] = useState(false)
  const set = (k: keyof Profile, v: string) => setP((x) => ({ ...x, [k]: v }))

  const submit = async () => {
    setSaving(true)
    try {
      await onSave(p)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="个人信息" onClose={onClose} width={520}
      footer={
        <>
          <button className="btn btn-outline btn-sm" disabled={saving} onClick={onClose}>取消</button>
          <button className="btn btn-primary btn-sm" disabled={saving} onClick={submit}>
            {saving ? '保存中…' : '保存'}
          </button>
        </>
      }>
      <div className="prof-card">
        <div className="prof-identity">
          <div className="prof-avatar-wrap">
            <div className="avatar prof-avatar">{avatarText(p.name)}</div>
            <span className="prof-status" title="已登录" />
          </div>
          <div className="prof-meta">
            <div className="prof-name">{p.name || '未命名'}</div>
            <div className="prof-role">
              {p.role || '—'}
              {p.email ? <span className="prof-no">{p.email}</span> : null}
            </div>
          </div>
        </div>

        <div className="prof-body">
          <section className="prof-sec">
            <h4 className="prof-sec-title">基础信息</h4>
            <div className="prof-grid g2">
              <div className="field" style={{ marginTop: 0 }}>
                <label>姓名</label>
                <input value={p.name} onChange={(e) => set('name', e.target.value)} placeholder="姓名" />
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label>角色</label>
                <input value={p.role} onChange={(e) => set('role', e.target.value)} placeholder="如 管理员 / 开发工程师" />
              </div>
            </div>
          </section>

          <section className="prof-sec">
            <h4 className="prof-sec-title">联系方式</h4>
            <div className="prof-grid g2">
              <div className="field" style={{ marginTop: 0 }}>
                <label>邮箱</label>
                <input value={p.email} onChange={(e) => set('email', e.target.value)} placeholder="name@company.com" />
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label>手机号</label>
                <input value={p.phone} onChange={(e) => set('phone', e.target.value)} placeholder="选填" />
              </div>
            </div>
          </section>
        </div>

        <div className="prof-hint">
          <Icon name="info" size={15} />
          <span>客户端绑定、Coding Agent、Git 凭据等个人配置已移至「设置」面板。</span>
        </div>
      </div>
    </Modal>
  )
}

export default function Console({ page, focus, onLogout }: {
  page: PageKey
  focus?: PageFocus
  onLogout: () => void
}) {
  const { toast } = useToast()
  const [profile, setProfile] = useState<Profile>(() => loadProfile())
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [profOpen, setProfOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 退出登录二次确认（左下角用户区触发） */
  const [logoutConfirm, setLogoutConfirm] = useState(false)
  /** 首次进入控制台：自动弹出设置面板做初始配置 */
  const [onboard, setOnboard] = useState(false)
  /** 移动端抽屉导航（≤920px 时顶栏汉堡按钮触发） */
  const [mnav, setMnav] = useState(false)

  /** 导航滑动指示条：随当前页面平滑滑到选中项 */
  const navRef = useRef<HTMLElement>(null)
  const navIndRef = useRef<HTMLSpanElement>(null)

  /** 换页即写 URL（带 focus 时序列化进 query），刷新后停在原地 */
  const nav = (p: PageKey, f?: PageFocus) => {
    setMnav(false)
    navigate({ view: 'app', page: p, focus: f })
  }

  // 抽屉开合同步 body class（CSS 负责滑入/锁滚动）
  useEffect(() => {
    document.body.classList.toggle('mnav-open', mnav)
    return () => document.body.classList.remove('mnav-open')
  }, [mnav])

  // Esc 关闭抽屉
  useEffect(() => {
    if (!mnav) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setMnav(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [mnav])

  // 设置在别处（如登录跳转）被修改时保持同步
  useEffect(() => applySettings(settings), [settings])

  // 设置面板里改偏好时（保存即广播），同步这里的 state，保证通知开关/折叠等联动立即生效
  useEffect(() => {
    const h = (e: Event) => setSettings((e as CustomEvent<Settings>).detail)
    window.addEventListener(SETTINGS_EVENT, h)
    return () => window.removeEventListener(SETTINGS_EVENT, h)
  }, [])

  // 导航滑动指示条：页面切换后把 accent 竖条平滑移向当前选中项
  useEffect(() => {
    const nav = navRef.current
    const ind = navIndRef.current
    if (!nav || !ind) return
    const id = requestAnimationFrame(() => {
      const el = nav.querySelector('.nav-i.active') as HTMLElement | null
      if (el) {
        ind.style.opacity = '1'
        ind.style.height = el.offsetHeight + 'px'
        ind.style.transform = `translateY(${el.offsetTop}px)`
      }
    })
    return () => cancelAnimationFrame(id)
  }, [page])

  // 卡片级错落浮现：换页后给视图内的「区块级」容器按文档顺序编 --st-i，CSS 负责依次升起。
  // 页面组件单根时取根的内部区块；根为多个并列区块（fragment）时直接用根本身。
  useEffect(() => {
    const layer = document.querySelector('.view-layer')
    if (!layer) return
    const id = requestAnimationFrame(() => {
      const top = Array.from(layer.children) as HTMLElement[]
      const blocks =
        top.length === 1 && top[0].children.length > 0
          ? (Array.from(top[0].children) as HTMLElement[])
          : top
      blocks.forEach((el, i) => {
        el.setAttribute('data-st', '')
        el.style.setProperty('--st-i', String(i))
      })
    })
    return () => cancelAnimationFrame(id)
  }, [page])

  /** 侧栏折叠切换：写回偏好（applySettings 会同步 body class） */
  const toggleSide = () => {
    setSettings((s) => {
      const next = { ...s, sideCollapsed: !s.sideCollapsed }
      saveSettings(next)
      return next
    })
  }

  // 主题设为「跟随系统」时，系统深浅切换即时生效
  useEffect(() => {
    if (settings.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const h = () => applySettings(loadSettings())
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [settings.theme])

  // 桌面通知：偏好开启后按快照比对提醒（reporter 用 toast，始终读最新偏好）
  useEffect(() => {
    if (!settings.notify.enabled) { stopNotifier(); return }
    startNotifier(() => loadSettings().notify, toast)
    return stopNotifier
  }, [settings.notify.enabled])

  // 首次进入控制台（含刚登录）：自动弹出设置面板做初始配置；标记落库后刷新不再重复弹
  useEffect(() => {
    if (!localStorage.getItem('talos.onboarded')) {
      localStorage.setItem('talos.onboarded', '1')
      setOnboard(true)
      setSettingsOpen(true)
    }
  }, [])

  const render = () => {
    switch (page) {
      case 'dashboard': return <Dashboard nav={nav} />
      case 'issues': return <Issues nav={nav} focus={focus} />
      case 'workflow': return <Workflow />
      case 'monitor': return <Monitor focus={focus} onNav={nav} />
      case 'clients': return <Clients focus={focus} nav={nav} />
      case 'agents': return <Agents />
      case 'prompts': return <Prompts />
      case 'models': return <Models />
      case 'logs': return <Logs focus={focus} />
      case 'docs': return <Docs nav={nav} />
      case 'kb': return <Kb />
      case 'biz': return <Biz />
      case 'repos': return <Repos />
      case 'users': return <Users />
      case 'roles': return <Roles />
      default: return null
    }
  }

  return (
    <div className="app">
      <aside className="side">
        {/* Logo 回总览 + 折叠开关 */}
        <div className="side-top clickable" onClick={() => nav('dashboard')} title="返回总览">
          <Mark size={25} /><span className="wt">Talos</span>
          <button className="iconbtn side-ic side-toggle"
            onClick={(e) => { e.stopPropagation(); toggleSide() }}
            title={settings.sideCollapsed ? '展开侧栏' : '折叠侧栏'}>
            <Icon name="chevron" size={15} />
          </button>
        </div>
        <nav className="side-nav" ref={navRef}>
          <span className="nav-ind" ref={navIndRef} />
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="nav-group">{g.group}</div>
              {g.items.map((it) => (
                <div
                  key={it.k}
                  className={`nav-i ${page === it.k ? 'active' : ''}`}
                  onClick={() => nav(it.k)}
                  title={settings.sideCollapsed ? it.l : undefined}
                >
                  <Icon name={it.icon} size={17} /><span className="nav-l">{it.l}</span>
                </div>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-bot">
          {/* 左下角用户区：点头像开个人信息；⚙ 设置、↪ 退出登录 常驻右侧 */}
          <div className="userchip" onClick={() => setProfOpen(true)} title="个人信息">
            <div className="avatar">{avatarText(profile.name)}</div>
            <div className="userchip-txt">
              <div className="un">{profile.name || '未命名'}</div>
              <div className="ur">{profile.role || '—'}</div>
            </div>
            <div className="side-user-acts" onClick={(e) => e.stopPropagation()}>
              <button className="iconbtn side-ic" onClick={() => setSettingsOpen(true)} title="设置">
                <Icon name="settings" size={15} />
              </button>
              <button className="iconbtn side-ic danger" onClick={() => setLogoutConfirm(true)} title="退出登录">
                <Icon name="logout" size={15} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="crumb">
            <button className="iconbtn mnav-btn" onClick={() => setMnav(true)} title="打开导航">
              <Icon name="menu" size={17} />
            </button>
            <Icon name={NAV.flatMap((g) => g.items).find((i) => i.k === page)?.icon ?? 'grid'} size={16} />
            <span className="crumb-t" key={page}>{TITLE[page]}</span>
          </div>
          <div className="tools">
            <div className="search"><Icon name="search" size={15} /><input placeholder="搜索 Issue、客户端、文档" /></div>
            <NotifCenter nav={nav} />
          </div>
        </div>
        <div className="content">
          <div className="view-layer" key={page}>{render()}</div>
        </div>
      </div>

      {/* 移动端抽屉遮罩：点击即关 */}
      {mnav && <div className="mnav-mask" onClick={() => setMnav(false)} />}

      {profOpen && (
        <ProfileModal
          initial={profile}
          onClose={() => setProfOpen(false)}
          onSave={(p) => {
            setProfile(p)
            saveProfile(p)
            setProfOpen(false)
            toast('个人信息已保存')
          }}
        />
      )}
      {logoutConfirm && (
        <Modal title="退出登录" onClose={() => setLogoutConfirm(false)} width={420}
          footer={
            <>
              <button className="btn btn-outline btn-sm" onClick={() => setLogoutConfirm(false)}>取消</button>
              <button className="btn btn-sm logout-cta" onClick={async () => {
                setLogoutConfirm(false)
                // 先让服务端注销会话（失败也无所谓：本地凭据一定要清掉，否则界面还在假装已登录）
                try { await logout() } catch { /* 会话可能早已失效 */ }
                clearAuth()
                broadcastAuth()
                toast('已退出登录')
                onLogout()
              }}>确认退出</button>
            </>
          }>
          <div className="confirm-body">
            <Icon name="logout" size={20} />
            <div>
              <div className="confirm-t">确定要退出登录吗？</div>
              <div className="confirm-s">退出后将返回登录页，未保存的页面筛选条件不会保留。</div>
            </div>
          </div>
        </Modal>
      )}
      {settingsOpen && (
        <SettingsPanel
          initial={settings}
          onboard={onboard}
          onClose={() => {
            setSettingsOpen(false)
            if (onboard) {
              setOnboard(false)
              toast('初始配置完成，可随时通过左下角 ⚙ 修改')
            }
          }}
        />
      )}
    </div>
  )
}
