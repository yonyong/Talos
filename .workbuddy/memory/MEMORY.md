# Talos 项目记忆（2026-09-28 精简）

细节与证据见同目录 `YYYY-MM-DD.md`；可复用的验证手法见 skill `talos-local-verify`。本文件只留跨会话必须记住的结论与坑。

## 环境 / 版本
- server SB3.2.5+Java17（8080/9443，H2 `./data/talosdb.mv.db`，须 cd 项目根启动）；web React18+Vite（dev 5173，`/api` 代理 8080）；client Java17
- ⚠️ 5173＝源码即时生效；8080＝jar 内嵌 static，不重打包永远旧版。症状：「暂无数据/共 0」、旧 UI、`No static resource api/xxx`（HTTP 500）
- ⚠️ 真机客户端＝`D:/opt/applications/talos/`；`D:/data/talos/client` 是旧副本；同 clientId 抢 sink
- mvn=`D:/develop/tool/apache-maven-3.9.9/bin/mvn.cmd`；java17=`D:/develop/tool/java/openjdk-17.0.2_windows-x64_bin/jdk-17.0.2/bin/java.exe`
- 版本：client **1.4.6** / server **1.4.4**（各以 pom 为准）。⚠️ 手写副本要同步：`talos-shots.bat`、`docs/Talos_client_guide.txt` 第 4 行、`web/src/pages/Landing.tsx` 页脚
- ⚠️ 升级自动触发：客户端 REGISTER 时版本落后于 `talos.agent.release-dir`（默认 `client/target`）即静默升级 → **打出高版本 jar ≈ 向所有在线客户端推升级**。当前生效版本查 `GET /api/agent/release`
- ⚠️ `apply-upgrade.bat` 由沙箱 shell 派生的 agent 拉起时会被连带杀掉（jar 未换、agent 不启）；补救：cp upgrade jar + `rm -f logs/.talos-agent.lock` + 后台起 jar

## 登录 / 认证（2026-09-28 新增）
- 邮箱授权码登录（无密码）：`POST /api/auth/{send-code,verify,logout}` + `GET /api/auth/me`；8 位数字码 TTL 180s、重发间隔 60s、10 次/时、试错 5 次；会话 token 存服务端内存表，`Authorization: Bearer`（兼容 `?token=` 供 img/a 直链）
- 配置＝`talos.auth.*` + `spring.mail.*`；首启引导邮箱 `talos.auth.bootstrap-email`（免「谁都登不进去」死锁）；联调开关 `expose-code`（响应直接回码，供无头验证）
- ⚠️ 限流必须 `codes` 与 `rates` **两张表分开存**：合一张时验证通过 remove 会把小时配额/重发间隔一起清零 → 可无限发信（实测确认）
- 第二步幂等：`prepare(email,force=false)` 有效期内沿用旧码不重发（否则刷新登录页后 60s 内被 429 卡在第一步）；「重新发送」按钮走 `force=true`
- 拦截：`WebConfig` 的 `AuthInterceptor`（登录态）排在既有 RBAC 拦截器**之前**；白名单 `/api/auth/send-code|verify`、`/api/health`、`/api/agent/release[/download]`
- ⚠️ **CORS 白名单会拦自己站点**（1.4.4 修）：浏览器对所有 POST（含同源）都带 Origin 头，Spring 对不在 `allowedOriginPatterns` 里的 Origin 一律 403 "Invalid CORS request"——曾把生产 missyou.website 自己的登录请求拦死且被前端吞成「请求失败 403」。现默认 `*`（Bearer 认证无 Cookie，无 CSRF 面），可用 `talos.cors.allowed-origin-patterns` 收紧。诊断手法：同 URL 带/不带 Origin 头各 curl 一次，403 只出现在带 Origin 那次＝CORS 拦截
- ⚠️ **硬约束：代码里不得出现 `@wind.com.cn`**（`web/src/settings.ts` 默认邮箱已清空）；改完核对 `server/src`、`web/src`、`web/dist`、`server/src/main/resources/static` 四处
- ⚠️ 遗留：`ClientController` 的 `reconnectClient`/`reconnectAllClients`/`pushClientConfig` 用原生 fetch、不带 token 头 → 全接口拦截后静默 401
- 邮箱唯一性在 `UserController.applyEmail()` 业务层校验（实体不建唯一约束，免老库迁移风险）；删用户会 `sessionsRevoked` 踢下线
- 产出：`tools/verify-login-flow.mjs`（PHASE=send/verify/guard 三段回归）

## 隔离验证（dev server 常驻 8080/9443，会锁 jar 与 H2）
- 独立端口 + 临时库：`--server.port=18080 --grpc.server.port=19443 --spring.datasource.url=jdbc:h2:file:D:/tmp/<x>/talosdb;AUTO_SERVER=TRUE;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE`；⚠️ 沙箱注入 `SERVER__PORT=52403` 会覆盖 → 显式 `SERVER__PORT=8080`
- 就绪看日志 `Started TalosApplication`（别用 HTTP 200）；GBK 日志 grep 加 -a；curl 加 `--noproxy "*"`；停服 `taskkill //PID <pid> //F`
- 临时目录带**唯一后缀**，从源头避开与并发会话撞车；只删自己这次的文件
- 重打包 server 先 kill 8080（升版本号可规避抢锁）；注入前端 `cp -rf web/dist/. server/src/main/resources/static/`（`cmd //c robocopy` 静默无效）
- 判活（别被日志 PID 骗）：`curl :8080/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'` 与 `unzip -l <jar> | grep static/assets/index` **同名**才算新包上线

## 网络 / 凭据（机械节点最常见的失败源）
- ⚠️⚠️ 「拉取 Git」挂死的头号原因是 **git 凭据助手**，不是网络（1.4.5 修）。本机 `credential.helper=helper-selector`（Git for Windows 默认，委派 GCM）：URL 内嵌 token 一旦不被接受，git 丢弃 URL 凭据转去问助手，而助手在无人值守会话里既不返回也不报错 → **零输出挂满超时**。`GIT_TERMINAL_PROMPT=0` / `GCM_INTERACTIVE=never` 都挡不住。对照实验（3 窗口 3/3 一致）：匿名 2.3s 成功 / 带 token 挂 16.4s 被杀 / **带 token + `-c credential.helper=` 2.2s 成功**
  - → 客户端所有**联网** git 命令统一走 `gitNet(...)`（禁凭据助手 + lowSpeed 快失败 + `--progress`）；子进程 env 摘掉 `GIT_ASKPASS/SSH_ASKPASS/GIT_CREDENTIAL_HELPER/代理`
  - 💡 服务端 `POST /api/profile/{id}/probe/git` 早就带了 `-c credential.helper=` → 「探测通过、节点却挂住」不是矛盾，是两边参数不一致
- ⚠️ 本机到 github.com 确实**间歇性**断（窗口有时仅 1~2 分钟），真实存在但属**次要因素**；WorkBuddy 代理 502、v2rayN 10808-10809 上游不通
- ⚠️ **做对照实验必须只差一个变量**（曾拿「匿名手测」比「agent 带 token 探测」差点误判回网络）；`退出码 -1`＝客户端超时哨兵，非 git 错误码；非 tty 无 `--progress` 则全程零输出
- **真机结论只能走客户端探测**：`POST /api/profile/00001/probe/{agent|git|toolchain}`（00001=老杨的T14P）。`probe/git`＝真机 `git -c credential.helper= ls-remote <authed> HEAD`，1 秒判定「这机器能不能访问该仓库」→ **先探再跑工作流**
- `probe/agent` 的 execPath 可以是 .bat → **在真机跑任意命令并取回输出**的通道（客户端执行 `<bat> --version`，多余参数无害；bat 内输出重定向到 D:/tmp/x.log 再 Read，不受 25s 探测超时约束）。⚠️ bat 里禁用 `set VAR=` + `%VAR%`，路径写死
- ⚠️ **沙箱 git 是伪影**：本机 Bash 里 `ls-remote/fetch`（默认 v2）恒 `fatal: expected flush after ref listing`，加 `-c protocol.version=0` 反而正常 —— 是沙箱透明代理坏了 v2 流式响应，**真机 v2 正常**

## 设计约束
- 客户端 NAT 后只主动连服务端（gRPC 双向流），服务端无下行入站；在线＝sink && lastSeen<30s
- Coding Agent 调客户端本地 CLI（只下发 execPath/argsTemplate/workDir/envVars，**不下发模型密钥**）；配置单一来源＝用户个人配置（`agent_config` 表与 `ConfigService.merged()` 已废弃）
- ⚠️ **`argsTemplate` 是「替代」不是「前缀」**：`AgentCliRunner.buildArgs` 有模板就 `[exec]+模板tokens`，必须自带 `{prompt}` 占位符，否则 prompt 被丢弃。codebuddy CLI 默认**交互式** → 模板必须 `-p "{prompt}"`（空值 → argv=[codebuddy,prompt] → 无 TTY → **900s 超时**）。`splitArgs` 剥引号合成单参数，prompt 内含 `"` 会切错
- `user_agent` 按 empNo 存；`POST /api/profile/{empNo}/agents`＝**整表重写**（漏字段即清空）+ 自动 pushToBoundClient；配置只驻客户端内存、无落盘文件
- 用户↔业务域多值（`t_user.bizCodes` 逗号串）；`UserController.save` 传 null＝保留原值 → 前端必须透传，不能补 `[]`
- LLM 判定（准入/分拣/闸门）全链路 fail-safe：解析不出 → 不放行/blocked/转人工

## 分拣 / 工作流 / 节点
- `t_biz_domain`：keywords、bizOwners+devOwners（逗号串＝优先级，第 1 人主责；承接人＝devOwners 兜底 bizOwners）、优先级/敏感/SLA；无模板字段（模板由 issue.type 决定）
- 仓库↔业务域＝一仓多域：绑定存业务域侧 `repoProject`（一域只对一仓），`RepoEntity.bizCode` 仅迁移源
- `SortService.sort()`：人工指定 → 关键词唯一 → 多命中 LLM 裁决 → 失败转人工；工作分支＝branchPrefix+code 小写（快照 `issue.branch`）；⚠️ `DispatchService.branchOf()` 原自拼 `type/code` 与 UI 不一致，已改为优先 `issue.branch`
- 条件边 always|never|success|failed|gate:pass|gate:blocked|expr:；就绪＝前向前驱全终结 + 至少一入边成立；BROKEN→blocked；回退 MAX_ROUNDS=3；实例快照 definitionJson 隔离模板编辑
- ⚠️ `verdictOf()` 只对 `always` 校验前驱 success：`expr:`/`gate:` 纯按变量求值，前驱 failed 照样 TAKEN → 上游失败会推下游白等一个超时；防御写法 `expr:result == success && …`
- ⚠️ `rerun()` 守卫 ACTIVE={dispatched,running}：范围含在飞节点即 409；dispatched 未回收时只能「取消实例」；无「已下发超时」回收。时间统一用 `web/src/time.ts`（⚠️ skipped 无 startedAt）
- `AutoStartService`：准入 + 分拣 resolved + 客户端在线 → 自动 start（judge/resort/register 补启）；开关 `t_user_setting.autoStart`（null=开）
- `kind`：git＝机械节点（只 clone/fetch/切分支；不接后端、不渲染 Prompt、不起 CLI、不发 CALL_LOG）；doc/code/test＝Coding Agent；rev＝服务端人工闸门。⚠️ 两端各有 `MECHANICAL_KINDS={git}`（TaskExecutor / WorkflowService），新增机械类型要同步改两处
- **工作区＝`<工作区根>/<issueCode>/<仓库名>/`**（每 Issue 一份独立克隆，隔离靠目录不靠分支；`{workspace}` 变量仍指根、实际目录另有 `{repo}`）；`issueSegment()` 白名单挡路径穿越、取不到编号落 `unassigned`；取仓库名要认 `/` 与 `\`（只认 `/` 时反斜杠路径会被 `resolve` 当绝对路径跳出工作区）
- 节点日志（`t_task_node.execLog`）＝客户端 trace（`[HH:mm:ss] $ 命令` + 原始输出，戳取**命令开始**时刻）+ CLI 输出 + 服务端追加行（`[闸门判定]`/`[已取消]`/`[条件不成立]`）；**只有 `$ 命令行` 带戳**
- 机械节点产出＝仓库准备 trace（token 脱敏）归档到 `t_doc`；`prepareWorkspace` 失败即抛异常；切分支三级兜底：直接切 → `-B branch origin/branch` → `-B branch`
- 1.4.5 仓库准备：超时杀**整个进程树**（只杀 cmd 会孤儿化 node）；`withReachableNetwork()` 先 `git ls-remote <url> HEAD` 探连通窗口再 clone/fetch（预算 10min、退避 1.5s×1.8 至 8s、认取消），替代原「TCP/HTTP HEAD 预检」（假阳性）；`retryableNetwork()` 决定值不值得等；`gitReason()` 归类成人话

## 前端 / Issue
- hash 路由（jar 无 SPA fallback，禁 history）；加页面同步 PAGE_KEYS/NAV/TITLE；卡片底色必须 `var(--surface)`（暗色禁 #fff）；语义色 `--ok/--warn/--err`；品牌图标 `web/src/brands.tsx`
- 偏好 localStorage `talos.settings` + `saveSettings()` 广播 `talos:settings`；通知 `notify.ts` 30s 轮询快照；共用组件 `BizTreeSelect`/`AgentConfigEditor`/`Modal`；`Icon` 不收 style
- 轮询统一用 `usePolling(fn, ms, enabled)`：`ms` 必须在**渲染期**求值（节拍一变立刻重排，否则首屏数据未到时算出的空闲节拍会让第一次刷新白等一整个周期）；`document.hidden` 跳过 + `visibilitychange` 切回补刷
- ⚠️ 给页面加轮询前先审 effect：只该在下钻/导航时跑一次的副作用会被每拍触发，把用户手动切走的选择拽回去 —— 靠 focus 对象身份做「只跳一次」标记
- Issue start 三道门禁 409（未准入 / repoUrl 空 / 已有实例）；close 先取消实例；异常统一 `{"message"}`（前端 `api()` 依赖）
- ⚠️ `useAsync` 只存 error 不渲染 → 接口失败被伪装成「暂无数据」；`reload()` 返回 Promise、开头清 error
- ⚠️ 登录改版后：`api()` 统一带 token，401 → 清凭据跳 `#/login`；`capture-console.mjs` 需 `--token` / `TALOS_TOKEN`（原「点按钮直接进控制台」已失效）

## 生产部署包（CentOS）
- 项目根双击 `package-server.bat` / `package-agent.bat` → `dist/`（agent 一包双平台，Linux 走 crontab 5min 保活）。模板源＝`server/deploy/*`、`client/deploy/scripts-linux`、`tools/talos-pack.ps1`
- 生产 `/opt/applications/talos`，手动 start/stop，不带 JRE；配置外置＝`./config/application.yml` 逐 key 覆盖 + `config/env.sh`；`upgrade.sh --jar` 只换 jar（旧 jar 进 `app/backup/`）
- ⚠️ 打包三坑：① PS5.1 `Get-Content -Raw` 在 zh-CN 主机按 GBK 解 UTF-8 → pom 中文让 XML 解析失败 ② bat 里 `echo` 在 `( )` 块内裸 `)` 被静默截断 ③ Windows tar 不保留执行位 → 文档必须写 `chmod +x bin/*.sh`
- ⚠️ 从 Git Bash 跑 `package-*.bat` **必须让 System32 优先**：`PATH="/c/Windows/System32:/c/Windows/System32/WindowsPowerShell/v1.0:/c/Windows:$PATH" cmd //c "package-agent.bat"`；否则 `dir /b ... | find /c /v ""` 命中 MSYS `/usr/bin/find` → 刷屏后静默退出。⚠️ 只有**裸 `cmd //c`** 可用
- ⚠️ `package-server.bat` 取 `dir /b server\target\talos-server-*.jar` 的**字典序最后一个**（升版本后新旧并存靠字典序选中）。升版本后**不用 kill 8080** → 绕开 `clean`，直接 `cd server && mvn -o -q -DskipTests package`，但**必须先 `rm -rf server/target/classes/static`**
- nginx 模板随包发（→ 包内 `nginx/`，README 第六节）。⚠️ **不能挂 `/talos/` 子路径**（前端写死 `/api`、`/assets`，挂子路径全 404 白屏）；`client_max_body_size` 必须 1024m（413 挡在 nginx 层、后端日志全无，最易误判成前端 bug）；`proxy_read_timeout` 600s（准入/分拣同步调 LLM）
- ⚠️ agent gRPC 是**明文 h2c**（`AgentDaemon.serve` 的 `usePlaintext()`）→ **不能经 443/HTTPS 反代**（握手即失败，客户端反复重连 UNAVAILABLE，nginx 侧看不到错误请求）。统一入口只能「明文 + 独立端口」：grpc 挪 19443 + nginx `listen 9443 http2` + `grpc_pass`，客户端 conf 不用改
- 💡 校验将发往 CentOS 的 nginx 配置：解压 `D:/develop/tool/nginx.zip`，路径改相对**配置目录**、listen 换高位端口、`openssl req -x509` 自签、顶层最小 conf 用 `include`

## 待办
- 页面动作未按角色渲染；Clients.tsx 有 toast 假动作；工作流页切 tab 丢未保存改动；客户端上行 `AgentDaemon.send` 无超时；服务端无 dispatched 超时回收；`ClientController` 三处原生 fetch 缺 token 头
