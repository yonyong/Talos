# Talos 项目记忆（2026-09-27 精简；细节与证据见同目录 YYYY-MM-DD.md 日志）

## 环境 / 版本错位
- server SpringBoot3.2.5+Java17（8080/9443，H2 `./data/talosdb.mv.db`，须 cd 项目根起）；web React18+Vite（dev 5173，/api 代理到 8080）；client Java17
- ⚠️ 5173＝源码即时生效，8080＝jar 内嵌 static 必须重打包；症状「暂无数据/共 0」、旧 UI、`No static resource api/xxx`
- ⚠️ 真实在跑的客户端＝`D:/opt/applications/talos/`（换 jar + 重启）；`D:/data/talos/client` 是旧副本；同 clientId 抢 sink
- mvn=`D:/develop/tool/apache-maven-3.9.9/bin/mvn.cmd`（MSYS_NO_PATHCONV=1、可 -o）；java17=`D:/develop/tool/java/openjdk-17.0.2_windows-x64_bin/jdk-17.0.2/bin/java.exe`

## 隔离验证（dev server 常驻占 8080/9443，jar 锁、H2 独占）
- 隔离端口+临时库：`--server.port=18080 --grpc.server.port=19443 --spring.datasource.url=jdbc:h2:file:D:/tmp/<x>/talosdb;AUTO_SERVER=TRUE;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE`；⚠️ 沙箱注入 `SERVER__PORT=52403` 会覆盖 → 显式 `SERVER__PORT=8080`
- 就绪看日志 `Started TalosApplication`（别用 HTTP 200）；GBK 日志 grep 加 -a；curl 加 `--noproxy "*"`；停服 `taskkill //PID <pid> //F`
- 重打包 server 先 kill 8080；注入前端 `cp -rf web/dist/. server/src/main/resources/static/`（`cmd //c robocopy` 静默无效）；protoc 目录锁/手工 javac 的绕法见当日日志（`-parameters` 必须加）
- 截图 `tools/capture-console.mjs --base http://localhost:5173`（NODE_PATH=managed node_modules、`NO_PROXY=*`）；隔离实例首进先点「完成并进入控制台」；hash 路由 `#/app/<page>`

## 网络 / 凭据（机械节点最常见的失败源）
- ⚠️⚠️ **「拉取 Git」挂死的头号原因是 git 凭据助手，不是网络**（2026-09-27 定位，client 1.4.5 修）。本机 system gitconfig 有 `credential.helper=helper-selector`（Git for Windows 默认，最终委派 GCM）：URL 内嵌的 token 一旦不被接受，git 会**丢弃 URL 凭据转去问助手**，而助手在无人值守会话里既不返回也不报错 → **零输出挂满超时**。`GIT_TERMINAL_PROMPT=0` 挡不住 GUI 助手，`GCM_INTERACTIVE=never` 也没拦住。
  对照实验（蹲到网络窗口才做，3 个独立窗口 3/3 一致）：匿名 2.3s 成功 / 带 token 挂 16.4s 被杀 / **带 token + `-c credential.helper=` 2.2s 成功拿到 HEAD**。
  → 客户端所有**联网** git 命令统一经 `gitNet(...)` 前缀 `NO_CRED_PROMPT`；子进程 env 还摘掉 `GIT_ASKPASS/SSH_ASKPASS/GIT_CREDENTIAL_HELPER`。
  💡 **服务端 `POST /api/profile/{id}/probe/git` 端点早就带了 `-c credential.helper=`** —— 所以「Git 探测通过、节点却挂住」不是矛盾，是两边参数不一致
- ⚠️ 本机到 github.com 确实**间歇性**断（curl 21s 超时 / 22:31~22:37 整段不通 / 断-通交替，窗口有时只有 1~2 分钟），真实存在但是**次要因素**；WorkBuddy 代理 502、v2rayN 10808-10809 上游不通
- ⚠️ agent 从带临时代理 env 的会话拉起会继承 http_proxy → git 静默挂死（历史有 8h 假死）；1.4.3+ 已在子进程摘掉代理 env（1.4.5 起连 askpass 一起摘），要代理请配 git 全局 http.proxy
- 排障：`git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 fetch --all --prune --progress`；非 tty 无 `--progress` 则全程零输出；`退出码 -1`＝客户端超时哨兵，不是 git 错误码
- ⚠️ **做对照实验必须只差一个变量**：曾拿「匿名手测」比「agent 带 token 探测」得出「我 8/8 成功而 agent 4 连败」的困惑结论，实际差了两个变量（token、helper），差点把根因继续误判成网络
- **真机结论只能走客户端探测拿**：`POST /api/profile/00001/probe/{agent|git|toolchain}`（00001=老杨的T14P）。`probe/git`＝真机 `git -c credential.helper= ls-remote <authed> HEAD`，1 秒判定「这台机器能不能访问该仓库」→ **先探再跑工作流**，别拿一轮 5 分钟的工作流当探针
- `probe/agent` 的 execPath 可以是 .bat → **在真机上跑任意命令并取回输出**的通道（客户端执行 `<bat> --version`，多余参数无害；bat 内把输出重定向到 D:/tmp/x.log 后我直接 Read，不受服务端 25s 探测超时约束）。⚠️ bat 里**禁用 `set VAR=` + `%VAR%`**，该通道下变量展开会被拆错；路径全部写死
- ⚠️ **沙箱 git 是伪影**：本机 Bash 沙箱里 `git ls-remote/fetch`（默认 v2）恒 `fatal: expected flush after ref listing`，加 `-c protocol.version=0` 反而正常 —— 是沙箱透明代理搞坏 v2 流式响应，**真机 v2 正常**。别据此改客户端协议版本、也别据此判定真机故障

## 设计约束
- 客户端 NAT 后只主动连服务端（gRPC 双向流），服务端无下行入站；在线＝sink && lastSeen<30s
- Coding Agent 调客户端本地 CLI（只下发 execPath/argsTemplate/workDir/envVars，**不下发模型密钥**）；配置单一来源＝用户个人配置（`agent_config` 表与 `ConfigService.merged()` 已废弃）
- 用户↔业务域多值（`t_user.bizCodes` 逗号串）；`UserController.save` 传 null＝保留原值 → 前端必须透传，不能补 `[]`
- LLM 判定（准入/分拣/闸门）全链路 fail-safe：解析不出 → 不放行/blocked/转人工
- 静默升级靠外部进程（apply-upgrade.bat 等 PID 退出换 jar → run-agent.bat 拉起，Watchdog 5min 保活）；装独立目录再 install，否则 workspace 嵌进源码树 + snakeyaml 转义崩溃
- ⚠️ **升级是自动触发的**：客户端每次 REGISTER 时若版本落后于 `talos.agent.release-dir`（默认 **`client/target`**）里的 jar 就自动静默升级（`talos.agent.auto-upgrade:true`）→ **打出更高版本的 jar 就等于给所有在线客户端推升级**，开发机上极易误触发（改 release-dir 到 dist / 写 `.current` 钉版本 / 关开关）。当前生效版本查 `GET /api/agent/release`
- ⚠️ **apply-upgrade.bat 从「被沙箱 shell 拉起的 agent」派生时会被连带杀掉**：`upgrade.log` 停在 `old pid … safe to swap`、`upgrade\backup-talos-agent.jar` 0 字节、jar 未替换、agent 完全不启动（同源的还有 `start.bat` 的 Start-Process 被拦）。手工补救：agent 已死 → jar 无锁，`cp upgrade\talos-agent-<v>.jar talos-agent.jar` + `rm -f logs/.talos-agent.lock` + 后台起 jar

## 分拣
- `t_biz_domain`：keywords、bizOwners+devOwners（逗号串＝优先级，第 1 人主责；承接人＝devOwners 兜底 bizOwners）、优先级/敏感/SLA；无模板字段（模板由 issue.type 决定）
- 仓库↔业务域＝一仓多域：绑定存业务域侧 `repoProject`（一域只对一仓），`RepoEntity.bizCode` 仅迁移源；入口＝仓库/业务域弹框 + 业务树 inline
- `SortService.sort()`：人工指定 → 关键词唯一 → 多命中 LLM 裁决 → 失败转人工；工作分支＝branchPrefix+code 小写（快照 `issue.branch`）
- ⚠️ `DispatchService.branchOf()` 原来自拼 `type/code`（忽略 branchPrefix、不转小写）→ 与 UI 显示不一致，已改为优先 `issue.branch`

## 工作流引擎
- 条件边 always|never|success|failed|gate:pass|gate:blocked|expr:；就绪＝前向前驱全终结 + 至少一入边成立；BROKEN→blocked；回退 MAX_ROUNDS=3；实例快照 definitionJson 隔离模板编辑
- ⚠️ `verdictOf()` 只对 `always` 校验前驱 success：`expr:`/`gate:` 纯按变量求值，前驱 failed 照样 TAKEN → 上游失败会推下游白等一个超时；防御写法 `expr:result == success && …`
- ⚠️ `rerun()` 守卫 ACTIVE={dispatched,running}：范围含在飞节点即 409；dispatched 未回收时只能「取消实例」
- 无「已下发超时」回收；节点时间统一用 `web/src/time.ts`（startedAt＝下发、finishedAt＝回执/跳过，⚠️ skipped 无 startedAt）
- `AutoStartService`：准入 + 分拣 resolved + 客户端在线 → 自动 start（judge / resort / register 补启）；开关 `t_user_setting.autoStart`（null=开）

## 节点分派
- `kind`：git＝机械节点（只 clone/fetch/切分支；不接后端、不渲染 Prompt、不起 CLI、不发 CALL_LOG）；doc/code/test＝Coding Agent；rev＝服务端人工闸门
- ⚠️ 两端各有 `MECHANICAL_KINDS={git}`（TaskExecutor / WorkflowService），新增机械类型要同步改两处
- ⚠️ **Coding Agent 节点必须给 CLI 加非交互开关**：`codebuddy` 默认进交互式会话（`--help` 明写 `use -p/--print for non-interactive output`），用户配置 `argsTemplate=''` → argv 只有 `[codebuddy, <prompt>]` → 无 tty 下既不退出也不输出，硬撑到 **900s CLI 超时**（节点 130/131 各 904s，success=false）。`argsTemplate` 至少 `-p`；要落代码改动还需 `--permission-mode acceptEdits` / `-y`。另：Prompt 变量常未替换（渲染出空的 `【需求】/【描述】/【知识库命中】/【仓库结构】`，客户端告警 `Prompt 变量缺失: [issue.title, issue.desc, kb.hits, repo.tree]`），变量来源在服务端
- **工作区＝`<工作区根>/<issueCode>/<仓库名>/`**（每 Issue 一份独立克隆，隔离靠目录不靠分支；`{workspace}` 变量仍指根、实际目录另有 `{repo}`）；`issueSegment()` 白名单挡路径穿越、取不到编号落 `unassigned`；取仓库名要认 `/` 与 `\` 两种分隔（只认 `/` 时反斜杠路径会被 `resolve` 当成绝对路径跳出工作区）
- 节点日志（`t_task_node.execLog`）＝客户端 trace（`[HH:mm:ss] $ 命令` + 原始输出，时间戳取**命令开始**时刻）+ CLI 输出 + 服务端追加行（`[闸门判定]`/`[已取消]`/`[条件不成立]`）；**只有 `$ 命令行` 带戳**，输出块与注释行不带
- 机械节点产出＝仓库准备 trace（token 脱敏）归档到 `t_doc`；`prepareWorkspace` 失败即抛异常；切分支三级兜底：直接切 → `-B branch origin/branch` → `-B branch`
- 1.4.5 客户端仓库准备：超时杀**整个进程树**（只杀 cmd 会孤儿化 node）；联网 git 命令统一走 `gitNet(...)`＝禁凭据助手（见「网络/凭据」节）+ lowSpeed 快失败 + `--progress`；`withReachableNetwork()` 先 `git ls-remote <url> HEAD` 探到连通窗口再 clone/fetch（预算 `GIT_NET_BUDGET_MS`=10min、退避 1.5s×1.8 至 8s、**认取消**），替代原「TCP/HTTP HEAD 预检」（那个会给出「113ms 通过」的假阳性）；`retryableNetwork()` 决定值不值得等（DNS/仓库不存在/鉴权/代理 → 不等）；`gitReason()` 归类成人话；超时也带回 stderr

## 前端 / Issue
- hash 路由（jar 无 SPA fallback，禁 history）；加页面同步 PAGE_KEYS/NAV/TITLE；卡片底色必须 `var(--surface)`（暗色禁 #fff）；语义色 `--ok/--warn/--err`（+ `-soft`）；品牌图标 `web/src/brands.tsx`（key=claude|cursor|codex|codebuddy）
- 偏好 localStorage `talos.settings` + `saveSettings()` 广播 `talos:settings`；通知 `notify.ts` 30s 轮询快照；共用组件 `BizTreeSelect`/`AgentConfigEditor`/`Modal(width|size="full")`；`Icon` 不收 style
- 轮询统一用 `api.ts` 的 `usePolling(fn, ms, enabled)`：`ms` 在**渲染期**求值（节拍一变立刻重排，别等本轮走完 —— 否则首屏数据未到时算出的空闲节拍会让第一次刷新白等一整个周期）；`setTimeout` 链不堆请求；`document.hidden` 跳过 + `visibilitychange` 切回补刷
- 监控页：`talos.monitor.live` 存开关；节拍＝有 running/pending 实例 5s，否则 20s；刷新＝列表+节点+拓扑三件套（`refresh()` 统一给轮询/操作后/手动按钮用）
- ⚠️ 给页面加轮询前先审 effect：只在下钻/导航时该跑一次的副作用（如按 `focus.issueCode` 定位实例）会被每拍触发，把用户手动切走的选择拽回去 —— 靠 focus 对象身份做「只跳一次」标记
- Issue start 三道门禁 409（未准入 / repoUrl 空 / 已有实例）；close 先取消实例；异常统一 `{"message"}`（400/409/500，前端 api() 依赖）
- ⚠️ `useAsync` 只存 error 不渲染 → 接口失败会被伪装成「暂无数据」；`reload()` 返回 Promise（可 await）、开头会清 error（否则一次抖动留下的报错永远不消失）

## 生产部署包（CentOS）
- 打包器（项目根 Windows 双击）：`package-server.bat`→`dist/talos-server-<ver>-linux.tar.gz`；`package-agent.bat`→`dist/talos-agent-<ver>-{win.zip,linux.tar.gz}`（一个包双平台，Linux 走 crontab 5min 保活）
- 模板源＝`server/deploy/{bin,config,README.txt}`、`client/deploy/{scripts-linux,README.txt}`、`tools/talos-pack.ps1`（bat 辅助器，把引号敏感的活儿挪出 bat）
- 生产：`/opt/applications/talos`，手动 start/stop，不带 JRE（要求已装 JDK17+）
- 服务端配置外置＝Spring Boot 自动读 `./config/application.yml`（逐 key 覆盖 jar 内）＋ `config/env.sh` 出变量用 `${VAR:default}` 引用；`upgrade.sh --jar` 只换 jar（config/data 不动，旧 jar 进 `app/backup/`）；`releases/` 放 agent jar 供客户端下载升级
- ⚠️ 打包三坑：① PS5.1 `Get-Content -Raw` 在 zh-CN 主机按 GBK 解 UTF-8 → pom 中文让 XML 解析失败，须自解码 ② bat 里 `echo` 在 `( )` 块内裸 `)` 会被静默截断 ③ Windows tar 不保留执行位 → 部署文档必须 `chmod +x bin/*.sh`
- ⚠️ `client/scripts/*.bat`、`client/setup.bat`、`talos-build.bat`、`talos-shots.bat` 源头都是 LF（打包时按消费者兜底转 CRLF；源文件未改，要根治建议加 .gitattributes）
- 客户端版本以 `client/pom.xml` 为准（现 **1.4.6**，2026-09-28 升，含工作区按 Issue 隔离 + trace 时间戳）；服务端版本以 `server/pom.xml` 为准（现 **1.4.3**）。⚠️ 版本号有**手写硬编码副本**，升版本要一起改：`talos-shots.bat`（示例 jar 名）、`docs/Talos_client_guide.txt` 第 4 行「适用版本」、`web/src/pages/Landing.tsx` 页脚「版本/构建」（当前都是静态字符串，无动态版本端点）
- ⚠️ 从 Git Bash 跑 `package-agent.bat` / `package-server.bat` **必须让 System32 优先**：`PATH="/c/Windows/System32:/c/Windows/System32/WindowsPowerShell/v1.0:/c/Windows:$PATH" cmd //c "package-agent.bat"`；否则 cmd 继承 MSYS PATH，脚本里 `dir /b ... | find /c /v ""` 命中 MSYS `/usr/bin/find` → 刷屏 `find: '/c/$Recycle.Bin/...'` 后静默退出（版本号那步已成功打印，极易误判成脚本坏了）。`cmd.exe` 绝对路径、或 PowerShell 工具里调 `cmd /c` 都被安全策略拦，只有裸 `cmd //c` 可用
- ⚠️ `package-server.bat` 取 `dir /b server\target\talos-server-*.jar` 的**字典序最后一个**当输入：升版本后 target 里新旧 jar 并存时选中新版本靠字典序，打完务必核对 `dist/talos-server-<ver>/VERSION.txt`。升版本后**不用 kill 8080**（新 jar 名不与运行中的旧 jar 抢锁）→ 绕开 `talos-build.bat` 的 `clean`，直接 `cd server && mvn -o -q -DskipTests package`，但**必须先 `rm -rf server/target/classes/static`**，否则旧 hash 前端被打进新 jar
- nginx：模板随服务端包发（`server/deploy/nginx/talos.conf` → 包内 `nginx/`，README 第六节）。⚠️ **只能挂独立域名/根路径，不能挂 `/talos/` 子路径**（前端构建期写死 `/api`、`/assets`，挂子路径全 404 白屏）；`client_max_body_size` 必须放大到 1024m（默认 1MB vs 服务端上传上限 1GB，413 挡在 nginx 层且后端日志全无，最易误判成前端 bug）；`proxy_read_timeout` 600s（准入/分拣同步调 LLM，60s 会先 504）；另一条 `proxy_request_buffering off`（1GB 上传别先落 proxy_temp）
- ⚠️ agent gRPC 是**明文 h2c**（`AgentDaemon.serve` 的 `usePlaintext()`，无 TLS）→ **不能经 443/HTTPS 反代**（握手即失败，客户端反复重连 + UNAVAILABLE，nginx 侧却看不到错误请求，很隐蔽）。要统一入口只能「明文 + 独立端口」：服务端 grpc 挪 19443（+`grpc.server.address:127.0.0.1`），nginx `listen 9443 http2` + `grpc_pass`，客户端配置不用改
- 💡 在 Windows 上校验将要发到 CentOS 的 nginx 配置：解压 `D:/develop/tool/nginx.zip` 的 nginx.exe，四招 —— 路径改相对**配置文件所在目录**、listen 换高位端口（`-t` 也真 bind，80/443 会被占）、`openssl req -x509` 自签证书（`-t` 会解析 PEM）、顶层最小 nginx.conf 用 `include` 引片段

## 待办
- 页面动作未按角色渲染；Clients.tsx 有 toast 假动作；工作流页切 tab 丢未保存改动；客户端上行 `AgentDaemon.send` 无超时；服务端无 dispatched 超时回收
