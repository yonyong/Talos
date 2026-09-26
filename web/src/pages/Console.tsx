import { useState } from 'react'
import { Icon, Mark } from '../icons'
import { useToast } from '../ui'
import type { PageKey } from '../types'
import Dashboard from './Dashboard'
import Issues from './Issues'
import Admission from './Admission'
import Workflow from './Workflow'
import Monitor from './Monitor'
import Clients from './Clients'
import Agents from './Agents'
import Logs from './Logs'
import Docs from './Docs'
import Kb from './Kb'
import Users from './Users'
import Roles from './Roles'

const NAV: { group: string; items: { k: PageKey; l: string; icon: string }[] }[] = [
  {
    group: '工作台',
    items: [
      { k: 'dashboard', l: '总览', icon: 'dashboard' },
      { k: 'issues', l: 'Issue', icon: 'issue' },
      { k: 'admission', l: '准入判定', icon: 'filter' },
      { k: 'workflow', l: '工作流编排', icon: 'flow' },
      { k: 'monitor', l: '作业监控', icon: 'terminal' },
    ],
  },
  {
    group: '资源',
    items: [
      { k: 'clients', l: '客户端', icon: 'client' },
      { k: 'agents', l: 'Coding Agent', icon: 'agent' },
      { k: 'logs', l: 'AI 调用日志', icon: 'spark' },
      { k: 'docs', l: '文档中心', icon: 'doc' },
      { k: 'kb', l: '知识库', icon: 'layers' },
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
  dashboard: '总览', issues: 'Issue', admission: '准入判定', workflow: '工作流编排',
  monitor: '作业监控', clients: '客户端', agents: 'Coding Agent', logs: 'AI 调用日志',
  docs: '文档中心', kb: '知识库', users: '用户管理', roles: '权限管理',
}

export default function Console({ onLogout }: { onLogout: () => void }) {
  const [page, setPage] = useState<PageKey>('dashboard')
  const { toast } = useToast()

  const render = () => {
    const nav = (p: PageKey) => setPage(p)
    switch (page) {
      case 'dashboard': return <Dashboard nav={nav} />
      case 'issues': return <Issues nav={nav} />
      case 'admission': return <Admission />
      case 'workflow': return <Workflow />
      case 'monitor': return <Monitor />
      case 'clients': return <Clients />
      case 'agents': return <Agents />
      case 'logs': return <Logs />
      case 'docs': return <Docs />
      case 'kb': return <Kb />
      case 'users': return <Users />
      case 'roles': return <Roles />
      default: return null
    }
  }

  return (
    <div className="app">
      <aside className="side">
        <div className="side-top"><Mark size={25} />Talos</div>
        <nav className="side-nav">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="nav-group">{g.group}</div>
              {g.items.map((it) => (
                <div
                  key={it.k}
                  className={`nav-i ${page === it.k ? 'active' : ''}`}
                  onClick={() => setPage(it.k)}
                >
                  <Icon name={it.icon} size={17} />{it.l}
                </div>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-bot">
          <div className="userchip" onClick={() => { onLogout(); toast('已退出登录') }}>
            <div className="avatar">YD</div>
            <div>
              <div className="un">YangDe</div>
              <div className="ur">平台管理员</div>
            </div>
            <Icon name="logout" size={16} />
          </div>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="crumb"><Icon name={NAV.flatMap((g) => g.items).find((i) => i.k === page)?.icon ?? 'grid'} size={16} />{TITLE[page]}</div>
          <div className="tools">
            <div className="search"><Icon name="search" size={15} /><input placeholder="搜索 Issue、客户端、文档" /></div>
            <button className="iconbtn" onClick={() => toast('暂无新通知')}><Icon name="bell" size={17} /></button>
            <button className="iconbtn" onClick={() => toast('已打开设置')}><Icon name="settings" size={17} /></button>
          </div>
        </div>
        <div className="content">{render()}</div>
      </div>
    </div>
  )
}
