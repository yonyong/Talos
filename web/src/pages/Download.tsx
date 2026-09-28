import { useEffect, useState } from 'react'
import { Icon, Mark } from '../icons'
import { useToast } from '../ui'
import { fetchAgentRelease } from '../api'
import type { AgentRelease } from '../types'
import SiteFooter from '../components/SiteFooter'

const INSTALL_CMD = 'scripts\\install.bat --server talos.yonyong.dev:9443 --token <一次性凭证> --id <客户端ID>'

const SCRIPTS: { cmd: string; desc: string }[] = [
  { cmd: 'setup.bat', desc: '一键安装并启动（双击即可，等价于 install.bat）' },
  { cmd: 'scripts\\install.bat', desc: '一键安装：已有配置直接复用，首次安装才需要填写' },
  { cmd: 'scripts\\start.bat', desc: '一键启动（已在运行则不做任何事）' },
  { cmd: 'scripts\\stop.bat', desc: '一键停止当前终端上的客户端进程' },
  { cmd: 'scripts\\status.bat', desc: '查看配置、进程状态与最近日志' },
  { cmd: 'scripts\\upgrade.bat', desc: '一键升级到服务端当前发布版' },
  { cmd: 'scripts\\uninstall.bat', desc: '卸载保活任务并停止客户端' },
]

function sizeText(bytes?: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function shortSha(sha?: string): string {
  if (!sha) return '—'
  return sha.length <= 20 ? sha : `${sha.slice(0, 8)}…${sha.slice(-6)}`
}

export default function Download({ onBack }: { onBack: (anchor?: string) => void }) {
  const { toast } = useToast()
  const [release, setRelease] = useState<AgentRelease | null>(null)

  useEffect(() => { fetchAgentRelease().then(setRelease).catch(() => setRelease(null)) }, [])

  const available = !!release?.available
  const downloadUrl = release?.downloadUrl ?? '/api/agent/release/download'

  return (
    <div>
      <header className="nav">
        <div className="wrap nav-in">
          <div className="brand"><Mark />Talos</div>
          <nav className="nav-links">
            <a href="#" onClick={(e) => { e.preventDefault(); onBack('arch') }}>架构</a>
            <a href="#" onClick={(e) => { e.preventDefault(); onBack('feat') }}>核心能力</a>
            <a href="#" onClick={(e) => { e.preventDefault(); onBack('sec') }}>安全</a>
            <a href="#" className="active" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>下载</a>
          </nav>
          <div className="nav-cta">
            {available ? (
              <a className="btn btn-primary btn-sm" href={downloadUrl} download onClick={() => toast(`开始下载 ${release?.fileName}`)}>
                下载 Windows 版
              </a>
            ) : (
              <button className="btn btn-primary btn-sm" disabled>暂无可下载版本</button>
            )}
          </div>
        </div>
      </header>

      <section className="block" style={{ paddingBottom: 40 }}>
        <div className="wrap">
          <div className="sec-head">
            <div className="sec-tag">客户端</div>
            <div className="sec-h">下载 Talos Agent</div>
            <p className="sec-p">
              客户端常驻研发终端，主动与服务端建立反向长连接，接收并执行工作流节点。
              解压后双击 <code style={{ fontFamily: 'var(--mono)' }}>setup.bat</code> 即可一键安装并启动，
              脚本会自动注册计划任务保活；目标机需已安装 JRE 17+。
              完整说明见控制台「接入指南」页。
            </p>
          </div>

          <div className="grid g3">
            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 600, fontSize: 14 }}>
                  <Icon name="client" size={18} />Windows x64
                </div>
                {available ? <span className="tag t-ok">当前发布版</span> : <span className="tag t-warn">未发布</span>}
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)', marginTop: 14 }}>
                {available ? release?.fileName : '（服务端尚未放置客户端安装包）'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 8, lineHeight: 1.7 }}>
                {available ? (
                  <>
                    版本 {release?.version} · {sizeText(release?.size)} · 需 JRE 17+
                    <br />SHA256 {shortSha(release?.sha256)}
                    <br />发布于 {release?.updatedAt}
                  </>
                ) : (
                  <>执行 <code style={{ fontFamily: 'var(--mono)' }}>client\build-package.bat</code> 打包后此处自动出现版本</>
                )}
              </div>
              {available ? (
                <a
                  className="btn btn-outline btn-sm"
                  style={{ marginTop: 18, justifyContent: 'center' }}
                  href={downloadUrl}
                  download
                  onClick={() => toast(`开始下载 ${release?.fileName}`)}
                >
                  <Icon name="download" size={15} /> 下载 zip 安装包
                </a>
              ) : (
                <button className="btn btn-outline btn-sm" style={{ marginTop: 18, justifyContent: 'center' }} disabled>
                  <Icon name="download" size={15} /> 暂无可下载版本
                </button>
              )}
            </div>

            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 600, fontSize: 14 }}>
                  <Icon name="refresh" size={18} />静默升级
                </div>
                <span className="tag t-info">免人工</span>
              </div>
              <div style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.85 }}>
                客户端上线时若版本落后，服务端自动下发升级指令，终端在后台完成
                <b style={{ color: 'var(--ink-3)' }}> 下载 → SHA256 校验 → 替换 → 重启</b>，研发人员无感。
                <br />控制台「客户端」页也可对单台或全部终端手工触发。
              </div>
              <div style={{ marginTop: 'auto', paddingTop: 18, fontSize: 12, color: 'var(--ink-4)' }}>
                想禁止某台机器被远程替换：把该机配置中的
                <code style={{ fontFamily: 'var(--mono)' }}> client.allowUpgrade</code> 置为 false。
              </div>
            </div>

            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 600, fontSize: 14 }}>
                  <Icon name="code" size={18} />其他平台
                </div>
                <span className="tag t-mut">源码构建</span>
              </div>
              <div style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.85 }}>
                当前发布包只覆盖 Windows。macOS / Linux 可直接从源码构建同版本客户端：
                <div style={{ fontFamily: 'var(--mono)', marginTop: 10, color: 'var(--ink-3)' }}>
                  cd client &amp;&amp; mvn package
                </div>
                <div style={{ marginTop: 10 }}>
                  构建产物 <code style={{ fontFamily: 'var(--mono)' }}>target/talos-agent.jar</code> 与服务端发布版同源，
                  版本号写入 MANIFEST，接入后同样纳入版本管理。
                </div>
              </div>
            </div>
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
              <h4 style={{ fontSize: 15, fontWeight: 620, marginTop: 14 }}>解压并双击 setup.bat</h4>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.65 }}>
                将 zip 解压到任意目录，例如 <code style={{ fontFamily: 'var(--mono)' }}>C:\Talos</code>，
                双击 <code style={{ fontFamily: 'var(--mono)' }}>setup.bat</code>，按提示输入服务端地址即可。
              </p>
            </div>
            <div className="card card-pad">
              <div className="tag t-info">STEP 02</div>
              <h4 style={{ fontSize: 15, fontWeight: 620, marginTop: 14 }}>脚本自动完成安装与启动</h4>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.65 }}>
                生成 <code style={{ fontFamily: 'var(--mono)' }}>conf\agent.yml</code>、注册 Windows 计划任务
                <b> TalosAgentWatchdog</b>（每 5 分钟检查并拉起进程），并立即启动客户端。
              </p>
            </div>
            <div className="card card-pad">
              <div className="tag t-info">STEP 03</div>
              <h4 style={{ fontSize: 15, fontWeight: 620, marginTop: 14 }}>服务端确认在线</h4>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.65 }}>
                打开控制台「客户端」页，即可看到该终端在线、心跳正常；点「查看日志」可实时看到该终端的
                链路事件与本地运行日志。
              </p>
            </div>
          </div>

          <div className="card card-pad" style={{ marginTop: 18 }}>
            <h4 style={{ fontSize: 14, fontWeight: 620, marginBottom: 12 }}>脚本做了什么</h4>
            <div className="codeblk">
              <span className="cm">:: install.bat 关键动作</span>
              {`
1. 校验 java 与 talos-agent.jar
2. 生成 conf\\agent.yml（server.addr / server.port / server.httpPort / client.id / client.token）
3. 注册保活：schtasks /create /tn "TalosAgentWatchdog" /sc minute /mo 5
              /tr "C:\\Talos\\scripts\\run-agent.bat" /rl HIGHEST /f
4. 立即启动：start /min cmd /c scripts\\run-agent.bat
5. 输出日志：logs\\agent.log（连接、心跳、任务执行、AI 调用）

:: 无参运行进入交互式问答；无人值守部署加 --silent 即全程静默
:: 单实例由客户端自身保证（logs\\.talos-agent.lock 文件锁）
`}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn btn-outline btn-sm" onClick={() => { navigator.clipboard?.writeText(INSTALL_CMD).catch(() => {}); toast('已复制安装命令') }}>
                <Icon name="copy" size={15} /> 复制安装命令
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => { navigator.clipboard?.writeText('scripts\\upgrade.bat').catch(() => {}); toast('已复制升级命令：scripts\\upgrade.bat') }}>
                <Icon name="refresh" size={15} /> 复制升级命令
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => { navigator.clipboard?.writeText('scripts\\uninstall.bat').catch(() => {}); toast('已复制卸载命令：scripts\\uninstall.bat') }}>
                <Icon name="trash" size={15} /> 复制卸载命令
              </button>
            </div>
          </div>

          <div className="card card-pad" style={{ marginTop: 18 }}>
            <h4 style={{ fontSize: 14, fontWeight: 620, marginBottom: 6 }}>客户端脚本一览</h4>
            <table>
              <thead>
                <tr><th style={{ width: 210 }}>脚本</th><th>作用</th></tr>
              </thead>
              <tbody>
                {SCRIPTS.map((s) => (
                  <tr key={s.cmd}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{s.cmd}</td>
                    <td>{s.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <SiteFooter
        compact
        versionNote={available ? `客户端 ${release?.version} · 服务端要求 1.4.x` : '客户端未发布'}
      />
    </div>
  )
}
