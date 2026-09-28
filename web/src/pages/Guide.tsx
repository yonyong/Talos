import { useEffect, useRef, useState } from 'react'
import { Icon } from '../icons'
import { PageH, Panel, Tag, useToast } from '../ui'
import { activateAgentRelease, deleteAgentReleaseFile, fetchAgentReleaseList, uploadAgentRelease } from '../api'
import type { AgentReleaseList } from '../types'
import ContactIcons from '../components/ContactIcons'

const INSTALL = `# 1. 解压安装包到目标目录，例如 C:\\Talos
# 2. 一键安装并启动（双击 setup.bat 亦可，无参数时进入交互式问答）
setup.bat --server talos.yonyong.dev:9443 --token <一次性凭证> --id <客户端ID>
:: 等价的完整写法
scripts\\install.bat --server talos.yonyong.dev:9443 --token <一次性凭证> --id <客户端ID>

# 3. 无人值守批量部署：全程静默，不提问也不暂停
scripts\\install.bat --server talos.yonyong.dev:9443 --token <一次性凭证> --silent

# 4. 立即前台运行（调试用，可看清日志）
java -jar talos-agent.jar

# 日常运维
scripts\\start.bat      一键启动    scripts\\stop.bat     一键停止
scripts\\status.bat     查看状态    scripts\\upgrade.bat  一键升级
scripts\\uninstall.bat  卸载`

const WATCHDOG = `:: install.bat 自动注册的保活任务
schtasks /create /tn "TalosAgentWatchdog" /sc minute /mo 5 ^
         /tr "C:\\Talos\\scripts\\run-agent.bat" /rl HIGHEST /f

:: 进程单实例由客户端自身保证（logs/.talos-agent.lock 文件锁），
:: 因此计划任务重复触发不会产生多份 agent 进程。`

const SCRIPTS: { cmd: string; desc: string }[] = [
  { cmd: 'setup.bat', desc: '一键安装并启动。双击即可；带参数则跳过交互问答' },
  { cmd: 'scripts\\install.bat', desc: '一键安装：已有 conf\\agent.yml 则复用不再提问；传参或无配置时写配置 + 注册保活任务 + 立即启动' },
  { cmd: 'scripts\\start.bat', desc: '一键启动，幂等：已在运行则直接返回' },
  { cmd: 'scripts\\stop.bat', desc: '一键停止当前终端上的客户端进程并清理实例锁' },
  { cmd: 'scripts\\status.bat', desc: '打印安装目录、服务端配置、进程状态、保活任务与最近日志' },
  { cmd: 'scripts\\upgrade.bat', desc: '向服务端查询当前发布版，下载校验后停旧启新' },
  { cmd: 'scripts\\uninstall.bat', desc: '删除保活任务并停止客户端，保留 conf / logs' },
  { cmd: 'scripts\\apply-upgrade.bat', desc: '手工兜底：直接替换 jar 并重启（jar 被占用时使用）' },
]

const UPGRADE_FLOW = `# 自动（服务端驱动，研发人员无感）
客户端 REGISTER 上报版本 → 服务端比对发布版
  → 版本落后且 talos.agent.auto-upgrade=true
  → 下发 COMMAND UPGRADE { version, url, sha256 }
  → 客户端后台：下载 → 校验 SHA256 → 备份旧版
  → 交由 scripts\\apply-upgrade.bat 替换 jar 并拉起新版本
  → 旧进程退出 → 回传 UPGRADE_STATE

# 为什么不由自己替换：运行中的 JVM 锁着自己的 jar
  由独立批处理进程完成，且它先等旧进程真正退出再动手，
  新会话只在旧进程消失后启动，因此不会互相抢文件

# 每个阶段都会回传，失败也回传原因，并保持旧版本继续运行
  STARTED   开始下载
  APPLYING  校验通过，替换安装包
  RESTARTING 替换完成，拉起新版本
  FAILED    失败原因（下载 / 校验 / 替换 / 重启）

# 手工（终端侧）
scripts\\upgrade.bat

# 手工（控制台侧）
「客户端」页 → 单台「升级」/ 顶部「升级 N 台」

# 拒绝被远程替换的机器
conf\\agent.yml 中 client.allowUpgrade: false`

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

export default function Guide() {
  const { toast } = useToast()
  const copy = (text: string, msg: string) => {
    navigator.clipboard?.writeText(text).catch(() => {})
    toast(msg)
  }

  /* ---------------- 客户端版本管理 ---------------- */
  const [rel, setRel] = useState<AgentReleaseList | null>(null)
  const [busy, setBusy] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const loadRel = () => fetchAgentReleaseList().then(setRel).catch(() => setRel(null))
  useEffect(() => { loadRel() }, [])

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy('upload')
    try {
      const r = await uploadAgentRelease(f)
      setRel(r)
      toast(`已上传 ${r.current?.fileName ?? f.name}，当前生效版本 ${r.current?.version ?? '—'}`)
    } catch (err: any) {
      toast(err?.message ?? '上传失败')
    } finally {
      setBusy('')
    }
  }

  const activate = async (version: string) => {
    setBusy('act-' + version)
    try {
      setRel(await activateAgentRelease(version))
      toast(`当前生效版本已切换为 ${version}`)
    } catch (err: any) {
      toast(err?.message ?? '操作失败')
    } finally {
      setBusy('')
    }
  }

  const removeFile = async (it: { fileName: string; version: string; current?: boolean }) => {
    if (!window.confirm(`确认删除 ${it.fileName}（${it.version}）？${it.current ? '它是当前生效版本，删除后将自动回落到版本最高的安装包。' : ''}`)) return
    setBusy('del-' + it.fileName)
    try {
      setRel(await deleteAgentReleaseFile(it.fileName))
      toast(`已删除 ${it.fileName}`)
    } catch (err: any) {
      toast(err?.message ?? '删除失败')
    } finally {
      setBusy('')
    }
  }

  const cur = rel?.current ?? null
  const curUrl = cur?.downloadUrl ?? '/api/agent/release/download'

  return (
    <div>
      <PageH
        title="接入指南"
        desc="客户端接入 Talos 的完整说明：版本管理、连接机制、消息契约、配置字段与常见故障。"
        actions={
          <>
            {cur && (
              <a className="btn btn-primary btn-sm" href={curUrl} download onClick={() => toast(`开始下载 ${cur.fileName}`)}>
                <Icon name="download" size={15} />下载客户端 {cur.version}
              </a>
            )}
            <button className="btn btn-outline btn-sm" onClick={() => copy(INSTALL, '已复制接入命令')}>
              <Icon name="copy" size={15} />复制接入命令
            </button>
          </>
        }
      />

      <Panel
        title="客户端版本"
        sub="上传维护发布版本库；「当前生效」版本对下载页与静默升级生效，可回退"
        actions={
          <>
            <input ref={fileRef} type="file" accept=".jar,.zip" style={{ display: 'none' }} onChange={onUpload} />
            <button className="btn btn-primary btn-sm" disabled={busy === 'upload'} onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={15} />{busy === 'upload' ? '上传中…' : '上传新版本'}
            </button>
          </>
        }
      >
        {!rel || !rel.available ? (
          <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.8 }}>
            版本库为空。点右上角「上传新版本」上传 <code style={{ fontFamily: 'var(--mono)' }}>talos-agent-&lt;版本&gt;.jar / .zip</code>，
            或执行 <code style={{ fontFamily: 'var(--mono)' }}>client\build-package.bat</code> 后把产物放进发布目录。
            未指定当前生效版本时，自动以版本号最高的包为准。
          </div>
        ) : (
          <>
            <div className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>当前生效版本</div>
                <div style={{ fontSize: 24, fontWeight: 650, letterSpacing: '-0.02em', fontFamily: 'var(--mono)', marginTop: 2 }}>
                  v{cur?.version}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 260, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.8, fontFamily: 'var(--mono)' }}>
                {cur?.fileName} · {sizeText(cur?.size)}<br />
                SHA256 {shortSha(cur?.sha256)}<br />
                发布于 {cur?.updatedAt}
              </div>
              <a className="btn btn-primary btn-sm" href={curUrl} download onClick={() => toast(`开始下载 ${cur?.fileName}`)}>
                <Icon name="download" size={15} />下载安装包
              </a>
            </div>

            {rel.versions.length > 1 && (
              <table style={{ marginTop: 16 }}>
                <thead>
                  <tr><th>版本</th><th>文件</th><th>大小</th><th>更新时间</th><th style={{ width: 200 }}>操作</th></tr>
                </thead>
                <tbody>
                  {rel.versions.map((it) => (
                    <tr key={it.fileName}>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>
                        {it.version} {it.current && <Tag tone="ok">当前生效</Tag>}
                      </td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)' }}>{it.fileName}</td>
                      <td style={{ fontSize: 12.5 }}>{sizeText(it.size)}</td>
                      <td style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{it.updatedAt}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {!it.current && (
                            <button
                              className="btn btn-outline btn-xs"
                              disabled={busy === 'act-' + it.version}
                              onClick={() => activate(it.version)}
                            >
                              设为当前
                            </button>
                          )}
                          <a className="btn btn-outline btn-xs" href={`${it.downloadUrl}?version=${encodeURIComponent(it.version)}`} download>
                            下载
                          </a>
                          <button
                            className="btn btn-outline btn-xs"
                            disabled={busy === 'del-' + it.fileName}
                            onClick={() => removeFile(it)}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.7 }}>
              版本库目录：<code style={{ fontFamily: 'var(--mono)' }}>{rel.releaseDir}</code>
              （配置项 <code style={{ fontFamily: 'var(--mono)' }}>talos.agent.release-dir</code>）。
              上传、指定与删除即时生效，无需重启服务端；客户端上线时与「当前生效」版本比对，落后即触发静默升级。
            </div>
          </>
        )}
      </Panel>

      <div style={{ height: 18 }} />

      <Panel title="连接机制" sub="客户端主动建连，服务端顺流下发 —— 服务端从不主动入站">
        <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.8 }}>
          研发终端通常位于 NAT 或防火墙之后，无法被服务端直接访问。因此接入方向是<strong style={{ color: 'var(--ink)' }}>反向</strong>的：
          客户端常驻进程启动后，主动向服务端的 gRPC 端口建立一条<strong style={{ color: 'var(--ink)' }}>双向长连接</strong>，
          之后所有任务下发、配置变更与状态回传都走这一条连接。
        </div>

        <div className="grid g2" style={{ marginTop: 18 }}>
          <div className="card card-pad">
            <div className="tag t-info">客户端 → 服务端</div>
            <h4 style={{ fontSize: 14, fontWeight: 620, marginTop: 14 }}>注册与上报</h4>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.7 }}>
              建流后首帧发 REGISTER 完成注册；此后每 10 秒发一次心跳；
              任务执行完回执并上报本次 AI 调用的渲染后 Prompt；大产物走独立通道回传。
            </p>
          </div>
          <div className="card card-pad">
            <div className="tag t-info">服务端 → 客户端</div>
            <h4 style={{ fontSize: 14, fontWeight: 620, marginTop: 14 }}>任务与配置</h4>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.7 }}>
              收到注册后立即回推一次配置；有节点任务时经同一条流下发，报文带 HMAC 签名供客户端校验来源。
            </p>
          </div>
        </div>

        <table style={{ marginTop: 18 }}>
          <thead>
            <tr><th>环节</th><th>行为</th><th>约束</th></tr>
          </thead>
          <tbody>
            <tr><td>建连</td><td>客户端发起 gRPC 双向流 Connect()</td><td>服务端不主动入站</td></tr>
            <tr><td>注册</td><td>首帧 REGISTER，服务端登记并回推配置</td><td>clientId 决定配置与任务路由</td></tr>
            <tr><td>保活</td><td>每 10 秒心跳</td><td>30 秒无心跳判定离线</td></tr>
            <tr><td>重连</td><td>断线后指数退避重连 1s → 60s</td><td>峰值 60 秒一次</td></tr>
            <tr><td>单实例</td><td>文件锁 logs/.talos-agent.lock</td><td>重复启动会自行退出</td></tr>
          </tbody>
        </table>
      </Panel>

      <div style={{ height: 18 }} />

      <Panel title="三步接入" sub="Windows 安装包内置运行环境，无需单独安装 JDK">
        <div className="grid g3">
          <div className="card card-pad">
            <div className="tag t-info">STEP 01</div>
            <h4 style={{ fontSize: 14, fontWeight: 620, marginTop: 14 }}>解压并双击 setup.bat</h4>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.7 }}>
              解压到任意目录后双击 <code style={{ fontFamily: 'var(--mono)' }}>setup.bat</code>，
              按提示输入服务端地址与一次性凭证；也可直接运行
              <code style={{ fontFamily: 'var(--mono)' }}> scripts\install.bat</code>。脚本会生成
              <code style={{ fontFamily: 'var(--mono)' }}> conf\agent.yml</code>。
            </p>
          </div>
          <div className="card card-pad">
            <div className="tag t-info">STEP 02</div>
            <h4 style={{ fontSize: 14, fontWeight: 620, marginTop: 14 }}>注册保活任务并启动</h4>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.7 }}>
              脚本注册计划任务 <b>TalosAgentWatchdog</b>（每 5 分钟检查一次）并立即拉起客户端，
              日志写入 <code style={{ fontFamily: 'var(--mono)' }}>logs\agent.log</code>。
            </p>
          </div>
          <div className="card card-pad">
            <div className="tag t-info">STEP 03</div>
            <h4 style={{ fontSize: 14, fontWeight: 620, marginTop: 14 }}>控制台确认在线</h4>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.7 }}>
              打开「客户端」页，应看到该终端状态为在线、心跳刷新；
              随后在「Coding Agent」页为其配置后端、可执行路径与参数模板。
            </p>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="codeblk">{INSTALL}</div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="codeblk">{WATCHDOG}</div>
        </div>
      </Panel>

      <div style={{ height: 18 }} />

      <Panel title="一键脚本" sub="安装目录下的全部运维脚本，均为双击/单命令可用" flush>
        <table>
          <thead>
            <tr><th style={{ width: 230 }}>脚本</th><th>作用</th></tr>
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
        <div style={{ padding: '16px 20px', fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.8, borderTop: '1px solid var(--line)' }}>
          <b style={{ color: 'var(--ink-3)' }}>三种典型用法</b><br />
          普通研发：解压后双击 <code style={{ fontFamily: 'var(--mono)' }}>setup.bat</code>，跟着提示走完即可。<br />
          批量部署：<code style={{ fontFamily: 'var(--mono)' }}>scripts\install.bat --server HOST:9443 --token XXX --silent</code>，无交互、无暂停，可放进装机脚本。<br />
          排障：<code style={{ fontFamily: 'var(--mono)' }}>scripts\status.bat</code> 一屏看完配置、进程、保活任务与最近 15 行日志。
        </div>
      </Panel>

      <div style={{ height: 18 }} />

      <Panel title="静默升级" sub="服务端驱动，终端后台完成下载、校验、替换与重启">
        <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.8 }}>
          服务端的「当前生效版本」在本页顶部的「客户端版本」面板上传与维护，安装包落盘于
          <code style={{ fontFamily: 'var(--mono)' }}> talos.agent.release-dir</code>
          （默认 <code style={{ fontFamily: 'var(--mono)' }}>client/target</code>）。
          打包产物自带 <code style={{ fontFamily: 'var(--mono)' }}>Implementation-Version</code>，客户端的
          <code style={{ fontFamily: 'var(--mono)' }}> REGISTER.version</code> 与之逐位比对，因此不存在「页面写一套、实际发另一套」的情况。
        </div>

        <div className="grid g3" style={{ marginTop: 18 }}>
          <div className="card card-pad">
            <div className="tag t-info">1 · 发现</div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 12, lineHeight: 1.75 }}>
              客户端注册时上报版本；服务端发现低于发布版即下发升级指令。
              控制台「客户端」页会把这些终端标成 <b>可升级</b>。
            </p>
          </div>
          <div className="card card-pad">
            <div className="tag t-info">2 · 下载校验</div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 12, lineHeight: 1.75 }}>
              客户端在后台下载安装包到 <code style={{ fontFamily: 'var(--mono)' }}>upgrade\</code>，
              逐字节比对 SHA256；不一致立即中止并回传失败原因，绝不替换本地 jar。
            </p>
          </div>
          <div className="card card-pad">
            <div className="tag t-info">3 · 替换重启</div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 12, lineHeight: 1.75 }}>
              运行中的 JVM 锁着自己的 jar，无法自我替换，因此交由独立批处理进程完成：
              先等旧进程真正退出，再备份、覆盖 jar、拉起新版本。全程不依赖控制台，
              在计划任务、RMM 等无人值守上下文里同样可靠；替换失败则保留旧版本继续
              运行并回传原因。
            </p>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="codeblk">{UPGRADE_FLOW}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 12.5, color: 'var(--ink-4)' }}>
          <Icon name="info" size={14} /> 升级指令与任务下发一样带 HMAC 签名：配置了 client.signSecret 后，
          伪造的升级地址会被客户端拒绝，避免被引到非受信源替换 jar。
        </div>
      </Panel>

      <div style={{ height: 18 }} />

      <Panel title="消息契约" sub="客户端与服务端之间传输的全部消息类型" flush>
        <table>
          <thead>
            <tr><th>方向</th><th>类型</th><th>时机</th><th>关键字段</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><Tag tone="info">上行</Tag></td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>REGISTER</td>
              <td>建流后首帧</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>clientId · token · ip · version · agents</td>
            </tr>
            <tr>
              <td><Tag tone="info">上行</Tag></td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>HEARTBEAT</td>
              <td>每 10 秒</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>state</td>
            </tr>
            <tr>
              <td><Tag tone="info">上行</Tag></td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>TASK_RESULT</td>
              <td>节点任务结束</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>instanceCode · step · success · log</td>
            </tr>
            <tr>
              <td><Tag tone="info">上行</Tag></td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>CALL_LOG</td>
              <td>每次 AI 调用</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>backend · model · renderedPrompt · missingVars · latencyMs</td>
            </tr>
            <tr>
              <td><Tag tone="info">上行</Tag></td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>LOG_DATA</td>
              <td>响应 PULL_LOG 指令</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>file · sizeText · lines[]</td>
            </tr>
            <tr>
              <td><Tag tone="info">上行</Tag></td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>UPGRADE_STATE</td>
              <td>升级各阶段 / 失败原因</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>stage · version · message</td>
            </tr>
            <tr>
              <td><Tag tone="info">上行</Tag></td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>UploadArtifact</td>
              <td>产物回传（独立通道）</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>issueCode · name · kind · content · sizeText</td>
            </tr>
            <tr>
              <td><Tag tone="prog">下行</Tag></td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>CONFIG_PUSH</td>
              <td>注册后立即 / 配置变更</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>scope · agents[] · prompts[]</td>
            </tr>
            <tr>
              <td><Tag tone="prog">下行</Tag></td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>TASK_DISPATCH</td>
              <td>有节点任务待执行</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>taskId · step · backend · promptTemplate · branch · signature</td>
            </tr>
            <tr>
              <td><Tag tone="prog">下行</Tag></td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>COMMAND</td>
              <td>运维 / 升级指令，带 HMAC 签名</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>command · taskId · version · url · sha256</td>
            </tr>
          </tbody>
        </table>
        <div style={{ padding: '16px 20px', fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.9, borderTop: '1px solid var(--line)' }}>
          <b style={{ color: 'var(--ink-3)' }}>COMMAND 的取值</b><br />
          <code style={{ fontFamily: 'var(--mono)' }}>RECONNECT</code> 断开当前流并按退避策略重建连接<br />
          <code style={{ fontFamily: 'var(--mono)' }}>PULL_LOG</code> 回传本机当前会话日志尾部（控制台「查看日志」触发）<br />
          <code style={{ fontFamily: 'var(--mono)' }}>UPGRADE</code> 静默升级，携带 version / url / sha256 / size<br />
          <code style={{ fontFamily: 'var(--mono)' }}>CANCEL_TASK</code> 取消正在执行的节点任务<br />
          <code style={{ fontFamily: 'var(--mono)' }}>RELOAD_CONFIG</code> 提示客户端等待下一次配置下发
        </div>
      </Panel>

      <div style={{ height: 18 }} />

      <Panel title="运行日志" sub="控制台「客户端」页 → 查看日志，三个视图定位不同层次的问题">
        <table>
          <thead>
            <tr><th style={{ width: 140 }}>视图</th><th>数据来源</th><th>适用场景</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><b>服务端事件</b></td>
              <td>平台侧观测：上线、配置下发、任务下发、回执、AI 调用、离线、升级状态</td>
              <td>判断「指令到底有没有下发出去」「客户端有没有回执」</td>
            </tr>
            <tr>
              <td><b>客户端日志</b></td>
              <td>点「拉取本地日志」后，客户端回传当前会话日志尾部（logs 下最新的 agent*.log，最多 2000 行）</td>
              <td>看终端上的真实堆栈：连接失败、CLI 拉起失败、签名校验不通过</td>
            </tr>
            <tr>
              <td><b>AI 调用</b></td>
              <td>该客户端上报的 t_ai_call_log 记录</td>
              <td>核对渲染后的 Prompt、模型、耗时与变量缺失</td>
            </tr>
          </tbody>
        </table>
        <div style={{ padding: '16px 20px', fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.8, borderTop: '1px solid var(--line)' }}>
          服务端只保留每个客户端最近 800 条链路事件（内存缓冲，重启清空），定位的是「当前这条连接发生了什么」；
          需要长期留存的 AI 调用记录落在数据库，不随重启丢失。
          客户端离线时无法拉取其本地日志——这类问题先看服务端事件里的心跳与离线时间点。
        </div>
      </Panel>

      <div style={{ height: 18 }} />

      <Panel title="客户端配置字段" sub="conf/agent.yml —— 由 install.bat 生成，可手工修改后重启生效" flush>
        <table>
          <thead>
            <tr><th>字段</th><th>说明</th></tr>
          </thead>
          <tbody>
            <tr><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>server.addr / server.port</td><td>服务端地址与 gRPC 端口。控制台是 8080，gRPC 是 9443，两者不同</td></tr>
            <tr><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>server.httpPort</td><td>控制台 HTTP 端口，默认 8080；静默升级从这里下载新版本安装包</td></tr>
            <tr><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>client.id</td><td>客户端唯一标识，决定配置覆盖与任务路由，重装请保持一致</td></tr>
            <tr><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>client.token</td><td>一次性接入凭证，由平台管理员在控制台生成</td></tr>
            <tr><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>client.workspace</td><td>工作区根目录，代码检出与产物都落在这里；每个 Issue 占一个独立子目录，实际路径为 &lt;workspace&gt;/&lt;Issue 编号&gt;/&lt;仓库名&gt;/</td></tr>
            <tr><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>client.heartbeatSeconds</td><td>心跳周期，默认 10；服务端 30 秒无心跳判离线</td></tr>
            <tr><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>client.signSecret</td><td>与服务端 task-sign-secret 一致；留空则不校验任务与升级指令签名</td></tr>
            <tr><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>client.allowUpgrade</td><td>是否接受服务端下发的静默升级，默认 true；false 时只能手工跑 scripts\upgrade.bat</td></tr>
            <tr><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>agents[].backend</td><td>claude / cursor / codex / codebuddy</td></tr>
            <tr><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>agents[].cmd / args</td><td>本地兜底命令与参数；服务端配置了 execPath / argsTemplate 时以服务端为准</td></tr>
            <tr><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>log.dir</td><td>日志目录，相对安装目录</td></tr>
          </tbody>
        </table>
      </Panel>

      <div style={{ height: 18 }} />

      <Panel title="服务端下发的执行参数" sub="在「Coding Agent」页配置，随 CONFIG_PUSH 下发，优先级高于客户端本地配置" flush>
        <table>
          <thead>
            <tr><th>字段</th><th>作用</th><th>示例</th></tr>
          </thead>
          <tbody>
            <tr><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>transport</td><td>执行方式：CLI 本地命令行 / SDK 内部私有化</td><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>CLI</td></tr>
            <tr><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>execPath</td><td>可执行文件路径或命令名</td><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>claude</td></tr>
            <tr><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>argsTemplate</td><td>启动参数模板，占位符由客户端注入</td><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>-p &#123;prompt&#125; --cwd &#123;repo&#125;</td></tr>
            <tr><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>workDir</td><td>执行工作目录（相对仓库根）</td><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>.</td></tr>
            <tr><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>envVars</td><td>附加环境变量</td><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>KEY=VALUE;KEY2=VALUE2</td></tr>
            <tr><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>minVersion</td><td>客户端最低版本，低于则拒绝执行并回执说明；留空 = 不限制</td><td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>留空</td></tr>
          </tbody>
        </table>
        <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.7 }}>
          可用占位符：<code style={{ fontFamily: 'var(--mono)' }}>&#123;prompt&#125;</code>
          <code style={{ fontFamily: 'var(--mono)', marginLeft: 8 }}>&#123;repo&#125;</code>
          <code style={{ fontFamily: 'var(--mono)', marginLeft: 8 }}>&#123;branch&#125;</code>
          <code style={{ fontFamily: 'var(--mono)', marginLeft: 8 }}>&#123;model&#125;</code>
          <code style={{ fontFamily: 'var(--mono)', marginLeft: 8 }}>&#123;issueCode&#125;</code>
          <code style={{ fontFamily: 'var(--mono)', marginLeft: 8 }}>&#123;node&#125;</code>。
          服务端只下发路径与模板，不持有也不下发任何模型密钥。
        </div>
      </Panel>

      <div style={{ height: 18 }} />

      <Panel title="常见故障" sub="先看 logs 下最新的 agent*.log，再看控制台「调用日志」页的渲染结果" flush>
        <table>
          <thead>
            <tr><th>现象</th><th>可能原因</th><th>处理</th></tr>
          </thead>
          <tbody>
            <tr><td>控制台看不到该客户端</td><td>服务端地址或端口填错；9443 被防火墙拦截</td><td>核对 conf/agent.yml 的 server 段，确认 gRPC 端口可达</td></tr>
            <tr><td>启动后立刻退出</td><td>已有实例在运行（文件锁生效）</td><td>正常行为；如需重启先跑 scripts\uninstall.bat</td></tr>
            <tr><td>状态反复掉线</td><td>网络抖动导致心跳超 30 秒</td><td>客户端会自动指数退避重连，检查网络稳定性</td></tr>
            <tr><td>任务签名校验失败</td><td>client.signSecret 与服务端 task-sign-secret 不一致</td><td>两边对齐密钥，或先留空关闭校验</td></tr>
            <tr><td>提示变量缺失</td><td>Prompt 模板变量名与系统注入的不一致</td><td>到「调用日志」页查看渲染后的 Prompt 定位</td></tr>
            <tr><td>任务不下发</td><td>后端未启用，或客户端离线</td><td>在「Coding Agent」页确认该后端已启用</td></tr>
            <tr><td>「查看日志」没有内容</td><td>刚接入、尚无链路事件；本机日志需主动拉取</td><td>等一次心跳，或点「拉取本地日志」拿到当前会话日志尾部</td></tr>
            <tr><td>点「升级」提示未找到安装包</td><td>服务端版本库里没有 talos-agent*.jar</td><td>在本页「客户端版本」面板上传安装包，或执行 client\build-package.bat 后放入发布目录</td></tr>
            <tr><td>升级后版本没变</td><td>jar 被占用、替换失败，或客户端拒绝远程升级</td><td>看「查看日志」里的升级状态与 upgrade.log，必要时跑 scripts\apply-upgrade.bat</td></tr>
            <tr><td>升级提示签名校验失败</td><td>client.signSecret 与服务端 task-sign-secret 不一致</td><td>两边对齐密钥；对齐前客户端会拒绝所有远程指令</td></tr>
            <tr><td>客户端状态长期显示离线</td><td>进程已被杀且保活任务未注册（非管理员运行）</td><td>以管理员身份重跑 install.bat，再用 scripts\status.bat 确认保活任务存在</td></tr>
          </tbody>
        </table>
      </Panel>

      <div style={{ marginTop: 16, fontSize: 12.5, color: 'var(--ink-4)', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        <span>本页内容与客户端实现保持一致；修改客户端接入方式时请同步更新此处。</span>
        <ContactIcons />
      </div>
    </div>
  )
}
