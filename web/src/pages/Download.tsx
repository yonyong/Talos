import { Icon, Mark } from '../icons'
import { useToast } from '../ui'

const builds = [
  { os: 'Windows x64', file: 'talos-agent-1.4.2-win.zip', size: '38.4 MB', sha: '9f2c…a71d', tag: '推荐', jdk: '内置 JRE 17' },
  { os: 'macOS (Apple Silicon)', file: 'talos-agent-1.4.2-mac-arm.zip', size: '36.1 MB', sha: 'b41e…8c02', tag: '', jdk: '内置 JRE 17' },
  { os: 'Linux x64', file: 'talos-agent-1.4.2-linux.tar.gz', size: '35.7 MB', sha: '7ad0…3f19', tag: '', jdk: '需 JDK 17+' },
]

export default function Download({ onBack }: { onBack: () => void }) {
  const { toast } = useToast()

  return (
    <div>
      <header className="nav">
        <div className="wrap nav-in">
          <div className="brand"><Mark />Talos</div>
          <nav className="nav-links">
            <a href="#" onClick={(e) => { e.preventDefault(); onBack() }}>官网首页</a>
          </nav>
          <div className="nav-cta">
            <button className="btn btn-primary btn-sm" onClick={() => toast('下载已开始（原型演示）')}>下载 Windows 版</button>
          </div>
        </div>
      </header>

      <section className="block" style={{ paddingBottom: 40 }}>
        <div className="wrap">
          <div className="sec-head">
            <div className="sec-tag">客户端</div>
            <div className="sec-h">下载 Talos Agent</div>
            <p className="sec-p">
              客户端常驻研发终端，主动与服务端建立反向长连接，拉取并执行工作流节点。
              安装包内置运行环境，Windows 下一键安装并自动注册计划任务保活。
            </p>
          </div>

          <div className="grid g3">
            {builds.map((b) => (
              <div key={b.os} className="card card-pad" style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 600, fontSize: 14 }}>
                    <Icon name="client" size={18} />{b.os}
                  </div>
                  {b.tag && <span className="tag t-info">{b.tag}</span>}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)', marginTop: 14 }}>{b.file}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 8 }}>
                  {b.size} · {b.jdk} · SHA256 {b.sha}
                </div>
                <button
                  className="btn btn-outline btn-sm"
                  style={{ marginTop: 18, justifyContent: 'center' }}
                  onClick={() => toast(`开始下载 ${b.file}`)}
                >
                  <Icon name="download" size={15} /> 下载
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="block" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head">
            <div className="sec-tag">Windows 傻瓜式安装</div>
            <div className="sec-h">三步完成接入</div>
          </div>

          <div className="grid g3">
            <div className="card card-pad">
              <div className="tag t-info">STEP 01</div>
              <h4 style={{ fontSize: 15, fontWeight: 620, marginTop: 14 }}>解压安装包</h4>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.65 }}>
                将 <code style={{ fontFamily: 'var(--mono)' }}>talos-agent-1.4.2-win.zip</code> 解压到任意目录，
                例如 <code style={{ fontFamily: 'var(--mono)' }}>C:\Talos</code>。无需单独安装 JDK。
              </p>
            </div>
            <div className="card card-pad">
              <div className="tag t-info">STEP 02</div>
              <h4 style={{ fontSize: 15, fontWeight: 620, marginTop: 14 }}>运行 install.bat</h4>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.65 }}>
                右键「以管理员身份运行」，脚本会写入客户端凭证、注册 Windows 计划任务
                <b> TalosAgentWatchdog</b>（每 5 分钟检查并拉起进程），并立即启动一次。
              </p>
            </div>
            <div className="card card-pad">
              <div className="tag t-info">STEP 03</div>
              <h4 style={{ fontSize: 15, fontWeight: 620, marginTop: 14 }}>服务端确认在线</h4>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.65 }}>
                打开控制台「客户端」页，即可看到该终端在线、心跳正常，随后在
                Coding Agent 配置页为其下发后端与模型。
              </p>
            </div>
          </div>

          <div className="card card-pad" style={{ marginTop: 18 }}>
            <h4 style={{ fontSize: 14, fontWeight: 620, marginBottom: 12 }}>脚本做了什么</h4>
            <div className="codeblk">
              <span className="cm">:: install.bat 关键动作（节选）</span>
              {`
1. 校验目录与 JRE，写入 conf/agent.yml（server.addr / client.id / token）
2. 安装守护：schtasks /create /tn "TalosAgentWatchdog" /sc minute /mo 5
              /tr "C:\\Talos\\talos-agent.exe --keepalive" /rl HIGHEST /f
3. 立即启动：start /b talos-agent.exe
4. 输出日志：logs/agent.log（连接、心跳、任务执行、AI 调用）
`}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn btn-outline btn-sm" onClick={() => toast('已复制安装命令')}>
                <Icon name="copy" size={15} /> 复制安装命令
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => toast('已复制卸载命令：schtasks /delete /tn "TalosAgentWatchdog" /f')}>
                <Icon name="trash" size={15} /> 复制卸载命令
              </button>
            </div>
          </div>
        </div>
      </section>

      <footer className="foot">
        <div className="wrap">
          <div className="foot-bot" style={{ borderTop: 'none', marginTop: 0, paddingTop: 0 }}>
            <span>© 2026 Talos · 仅供内网使用</span>
            <span>客户端 1.4.2 · 服务端要求 1.4.x</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
