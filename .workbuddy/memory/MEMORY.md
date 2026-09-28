# Talos 项目记忆（2026-09-28 压缩版）

细节与证据见同目录 `YYYY-MM-DD.md`；可复用验证手法见 skill `talos-local-verify`。本文件只留跨会话必须记住的结论与坑。

## 环境 / 版本
- server SB3.2.5+Java17（8080/9443，H2 `./data/talosdb.mv.db`，须 cd 项目根启动）；web React18+Vite（5173 代理 /api→8080）；client Java17
- ⚠️ 5173=源码即时生效；8080=jar 内嵌 static，不重打包永远旧版（症状：「暂无数据/共 0」、`No static resource api/xxx`）
- 真机客户端=`D:/opt/applications/talos/`（`D:/data/talos/client` 是旧副本，同 clientId 抢 sink）
- mvn=`D:/develop/tool/apache-maven-3.9.9/bin/mvn.cmd`；java17=`D:/develop/tool/java/openjdk-17.0.2_windows-x64_bin/jdk-17.0.2/bin/java.exe`
- 版本 client 1.4.6 / server 1.4.4（以 pom 为准）；手写副本须同步：`talos-shots.bat`、`docs/Talos_client_guide.txt` 第4行、`web/src/pages/Landing.tsx` 页脚
- ⚠️ 客户端 REGISTER 时版本落后于 `talos.agent.release-dir`（默认 `client/target`）即静默升级 → 打出高版本 jar ≈ 给所有在线客户端推升级；生效版本查 `GET /api/agent/release`
- ⚠️ `apply-upgrade.bat` 被沙箱派生的 agent 拉起时会被连带杀掉；补救：cp upgrade jar + `rm -f logs/.talos-agent.lock` + 后台起 jar
- 💡 只读排查生产库：H2 jar（`~/.m2/repository/com/h2database/h2/2.2.224/`）+ URL 抄 application.yml 的 `jdbc:h2:file:./data/talosdb;AUTO_SERVER=TRUE;...` + 密码 talos，用 `org.h2.tools.Shell -sql` 直查（8080 在跑也能连）；长字段用 `substr(col,n,len)` 分段取

## 登录 / 认证
- 邮箱授权码登录：`POST /api/auth/{send-code,verify,logout}`、`GET /api/auth/me`；码 TTL 180s、重发 60s、10 次/时、试错 5 次；token 存服务端内存表，`Authorization: Bearer`（兼容 `?token=` 供直链）
- 配置 `talos.auth.*`+`spring.mail.*`；引导邮箱 `talos.auth.bootstrap-email`；联调 `expose-code` 直接回码
- ⚠️ 限流 `codes` 与 `rates` 必须两张表：合一张则验证通过 remove 会连小时配额与重发间隔一起清掉 → 可无限发信
- `prepare(email,force=false)` 有效期内沿用旧码（防登录页刷新后 60s 内 429）；「重新发送」走 force=true
- `AuthInterceptor` 排在 RBAC 拦截器前；白名单 `/api/auth/send-code|verify`、`/api/health`、`/api/agent/release[/download]`
- ⚠️ CORS：浏览器对同源 POST 也带 Origin，非白名单 Origin 一律 403 "Invalid CORS request"（曾误判成前端 bug）；现默认 `*`，可用 `talos.cors.allowed-origin-patterns` 收紧。诊断：同 URL 带/不带 Origin 各 curl 一次
- ⚠️ 硬约束：代码里不得出现 `@wind.com.cn`；改完核对 `server/src`、`web/src`、`web/dist`、`server/src/main/resources/static` 四处
- ⚠️ 遗留：`ClientController` 的 reconnect/reconnectAll/pushClientConfig 用原生 fetch 不带 token → 静默 401
- 邮箱唯一性在 `UserController.applyEmail()` 业务层校验；删用户会 `sessionsRevoked`；回归脚本 `tools/verify-login-flow.mjs`

## 隔离验证（dev server 常驻 8080/9443，锁 jar 与 H2）
- `--server.port=18080 --grpc.server.port=19443 --spring.datasource.url=jdbc:h2:file:D:/tmp/<唯一后缀>/talosdb;AUTO_SERVER=TRUE;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE`；⚠️ 显式 `SERVER__PORT=8080`（沙箱会注入 52403）
- 就绪看日志 `Started TalosApplication`；GBK 日志 grep 加 -a；curl 加 `--noproxy "*"`；停服 `taskkill //PID <pid> //F`
- 重打包 server：kill 8080（或升版本号）；注入前端 `cp -rf web/dist/. server/src/main/resources/static/`（robocopy 静默无效）
- 判活：`curl :8080/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'` 与 `unzip -l <jar> | grep static/assets/index` 同名才算上线

## 网络 / 凭据
- ⚠️⚠️ 「拉取 Git」挂死头号原因是 **git 凭据助手**（1.4.5 修）：`credential.helper=helper-selector` 在无人值守会话里既不返回也不报错 → 零输出挂满超时；`GIT_TERMINAL_PROMPT=0` 挡不住，须 `-c credential.helper=`。客户端联网 git 统一走 `gitNet(...)`（禁助手 + lowSpeed 快失败 + `--progress`），子进程 env 摘掉 ASKPASS/代理
- 本机到 github.com 间歇性断（次要因素，但会长时间归零）；沙箱 Bash 里 `ls-remote/fetch` 恒 `expected flush after ref listing`（透明代理坏 v2），真机正常
- 真机结论走客户端探测：`POST /api/profile/me/probe/{agent|git|toolchain}`（管理端 `/{email:.+}/probe/...`）；`probe/git`=`git -c credential.helper= ls-remote <authed> HEAD`，1s 判定能否访问该仓库 → **先探再跑，别让工作流空等 600s**
- `probe/agent` 的 execPath 可传 .bat ⇒ 在真机执行任意命令并取回输出的通道（bat 内重定向到 D:/tmp/x.log 再 Read，绕过 25s 探测超时；⚠️ bat 里禁用 `set VAR=`+`%VAR%`）

## 设计约束
- 客户端 NAT 后只主动连服务端（gRPC 双向流）；在线＝sink && lastSeen<30s
- Coding Agent 调客户端本地 CLI（只下发 execPath/argsTemplate/workDir/envVars，不下发模型密钥）；配置唯一来源＝用户个人配置（`agent_config` 表与 `ConfigService.merged()` 已废弃）
- ⚠️ `argsTemplate` 是「替代」不是「前缀」：必须自带 `{prompt}`，否则 prompt 被丢弃；codebuddy CLI 交互式 ⇒ 模板须 `-p "{prompt}"`（否则无 TTY → 900s 超时）
- 用户身份＝邮箱，关联键＝userId（工号已删）；老库 emp_no→user_id 回填在 `DataInitializer.migrateUserKeyColumns()`（幂等）；⚠️ userId 列可空（ddl-auto=update 给存量行加 NOT NULL 会失败）
- Profile：本人 `/api/profile/me[/agents|/probe/*]`（不传身份）；管理端 `/api/profile/{email:.+}[/...]`（selfOrAdmin）；`bound-users/{userId}/unbind`
- `POST .../agents`＝整表重写（漏字段即清空）+ 自动 pushToBoundClient；配置只驻客户端内存、无落盘文件
- `t_user.bizCodes` 逗号串多值；`UserController.save` 传 null＝保留原值（前端必须透传，别补 `[]`）
- LLM 判定（准入/分拣/闸门）全链路 fail-safe：解析不出 → 不放行/blocked/转人工

## 分拣 / 工作流 / 节点
- `t_biz_domain`：keywords、bizOwners+devOwners（逗号串＝优先级，第1人主责）、优先级/敏感/SLA；无模板字段（模板由 issue.type 决定）
- 仓库↔业务域一仓多域：绑定存业务域侧 `repoProject`，`RepoEntity.bizCode` 仅迁移源
- `SortService.sort()`：人工指定 → 关键词唯一 → 多命中 LLM 裁决 → 失败转人工；工作分支=branchPrefix+code 小写（快照 `issue.branch`；`DispatchService.branchOf()` 已改为优先用它）
- 条件边 always|never|success|failed|gate:pass|gate:blocked|expr:；就绪＝前向前驱全终结 + 至少一入边成立；BROKEN→blocked；回退 MAX_ROUNDS=3；实例快照 definitionJson
- ⚠️ `verdictOf()`：无条件边（空/always/—）仅前驱 success 生效；`expr:`/`gate:` 纯按变量求值不看前驱状态 → 上游失败仍可能 TAKEN；防御写法 `expr:result == success && …`；skipped/cancelled 一律不上传播
- ⚠️ **进度口径设计铁律（用户拍板）**：第一步 failed → 下游必须保持 `waiting`（**非**终结态），**不**标 skipped，进度显 **1/7** + 实例 blocked，且等上游恢复可自动续跑。`skipped` 只用于「前驱 success 但分支条件没走这条」的真分支跳过。旧实现把"被失败掐断"也标 skipped（属 TERMINAL）才凑出 7/7——已改 `WorkflowService.sweep()`（上游 failed 时保持 waiting）+ 调用处 `anyActive`（按"失败节点前向可达集"判，否则链式 1→2→…→7 里节点3 直接前驱是 waiting 会漏判成 running）。
- ⚠️ **进度口径第二陷阱**：`syncProgress()` 的 `currentStep`＝TERMINAL 计数（success+failed+skipped+cancelled），`totalSteps`＝图节点数；只有"真分支跳过"会让 skipped 进计数。前端 `Monitor.tsx:597-618` 渲染 `currentStep/totalSteps`，面板头「x/y 已完成」按 success 计 → 同页两口径，仍可能被读成「都成功了」，属展示层待优化项。
- 级联跳过：`sweep()` 对「前驱全终结 + 无入边命中」的节点——仅当上游**非 failed** 才标 skipped（真分支跳过），上游 failed 则保持 waiting 等恢复（allowSkip=false 时不落库，用于客户端上线补发重试）
- ⚠️ `rerun()` 守卫 ACTIVE={dispatched,running}：含在飞节点即 409；dispatched 未回收时只能取消实例；无「已下发超时」回收。时间统一 `web/src/time.ts`（⚠️ skipped 无 startedAt）
- `AutoStartService`：准入 + 分拣 resolved + 客户端在线 → 自动 start；开关 `t_user_setting.autoStart`（null=开）
- `kind`：git＝机械节点（只 clone/fetch/切分支；不接后端、不渲染 Prompt、不起 CLI、不发 CALL_LOG）；doc/code/test＝Coding Agent；rev＝服务端人工闸门。⚠️ 两端各有 `MECHANICAL_KINDS={git}`，新增要同步改两处
- 工作区＝`<根>/<issueCode>/<仓库名>/`；`issueSegment()` 白名单挡穿越；取仓库名要认 `/` 与 `\`
- 节点日志 `t_task_node.execLog`＝客户端 trace（只有 `$ 命令` 行带 `[HH:mm:ss]` 戳）+ CLI 输出 + 服务端追加行（`[闸门判定]`/`[已取消]`/`[条件不成立]`）
- 机械节点产出＝仓库准备 trace（token 脱敏）归档 `t_doc`；切分支三级兜底：直接切 → `-B branch origin/branch` → `-B branch`
- 1.4.5 仓库准备：超时杀**整个进程树**；`withReachableNetwork()` 先 `ls-remote` 探连通（预算 600s、退避 1.5s×1.8 至 8s）；预算耗尽 → 节点 failed

## 前端 / Issue
- hash 路由（jar 无 SPA fallback，禁 history）；加页面同步 PAGE_KEYS/NAV/TITLE；卡片底色 `var(--surface)`（暗色禁 #fff）；语义色 `--ok/--warn/--err`；图标 `web/src/brands.tsx`
- 偏好 localStorage `talos.settings`+`saveSettings()` 广播 `talos:settings`；通知 `notify.ts` 30s 轮询快照；组件 `BizTreeSelect`/`AgentConfigEditor`/`Modal`
- `usePolling(fn, ms, enabled)`：`ms` 必须渲染期求值；`document.hidden` 跳过 + `visibilitychange` 补刷
- ⚠️ 官网顶栏唯一实现＝`components/SiteNav.tsx`（logo 可点回首页 + 恒定「首页/文档/下载/关于」+ `right` 插槽）；官网页面（Landing/Docs/Download/About/Contact/Guide）一律包 `SiteChrome`，禁止自建 `<header class="nav">`
- ⚠️ 加轮询前审 effect：本该只跑一次的副作用会被每拍触发（用 focus 对象身份做「只跳一次」标记）
- Issue start 三道门禁 409（未准入 / repoUrl 空 / 已有实例）；close 先取消实例；异常统一 `{"message"}`
- ⚠️ `useAsync` 只存 error 不渲染 → 接口失败被伪装成「暂无数据」
- ⚠️ 登录改版后 `api()` 统一带 token，401 → 清凭据跳 `#/login`；`capture-console.mjs` 需 `--token`/`TALOS_TOKEN`
- ⚠️ 头像占位符禁「深色块+白字人名」（像灵位）；统一 `var(--accent-soft)` 底 + `var(--accent-ink)` 字（暗主题反色）
- 页面级 `Tabs`（整页主题切换）vs `Seg`（块内筛选）；Clients 页已拆 终端/版本发布/接入与绑定
- 官网动效约定：滚动入场用 `IntersectionObserver` + `.reveal`/`.in`，stagger 靠元素内联 `--rd` 整数（CSS `calc(var(--rd)*70ms)` 延迟）；Hero 用 CSS `@keyframes` 依次上浮 + `.grad` 文字 shimmer（gradShift）+ pill 状态点脉冲（dotPulse）+ `.hero-glow` 呼吸游移；架构图连线加 `.flow` 跑 `dashFlow`。**所有新增动效必须进 `prefers-reduced-motion` 豁免**（styles.css 末尾 media query）

## 生产部署包（CentOS）
- 根目录双击 `package-server.bat`/`package-agent.bat` → `dist/`；模板源 `server/deploy/*`、`client/deploy/scripts-linux`、`tools/talos-pack.ps1`
- 生产 `/opt/applications/talos`，手动 start/stop，不带 JRE；配置外置 `./config/application.yml` + `config/env.sh`；`upgrade.sh --jar` 只换 jar（旧 jar 进 `app/backup/`）
- ⚠️ 打包三坑：PS5.1 `Get-Content -Raw` 按 GBK 解 UTF-8（pom 中文让 XML 解析失败）；bat `( )` 块内裸 `)` 被静默截断；Windows tar 丢执行位 → 文档须写 `chmod +x bin/*.sh`
- ⚠️ 从 Git Bash 跑 bat 必须让 System32 优先（否则 `find` 命中 MSYS，刷屏后静默退出）；只有裸 `cmd //c` 可用
- ⚠️ `package-server.bat` 取 `server\target\talos-server-*.jar` 字典序最后一个；升版本后绕开 clean：`mvn -o -q -DskipTests package`，但先 `rm -rf server/target/classes/static`
- nginx 随包发（→ 包内 `nginx/`，README 第六节）；⚠️ 不能挂 `/talos/` 子路径（前端写死 `/api`、`/assets`，挂子路径全 404 白屏）；`client_max_body_size 1024m`（413 挡在 nginx 层、后端无日志）；`proxy_read_timeout 600s`
- ⚠️ agent gRPC 是明文 h2c → 不能经 443/HTTPS 反代；统一入口只能「grpc 挪 19443 + nginx `listen 9443 http2` + `grpc_pass`」
- 💡 校验发往 CentOS 的 nginx 配置：解压 `D:/develop/tool/nginx.zip`，路径改相对配置目录、listen 换高位端口、`openssl req -x509` 自签、顶层最小 conf 用 `include`

## 待办
- 页面动作未按角色渲染；Clients.tsx 有 toast 假动作；工作流页切 tab 丢未保存改动；客户端 `AgentDaemon.send` 无超时；服务端无 dispatched 超时回收；`ClientController` 三处原生 fetch 缺 token 头
- 进度条口径：满格进度条把 failed/skipped 也算「进度」，blocked 时呈现 7/7 满格橙，易被读成成功 → 建议分段着色（success/failed/skipped）或改文案「已终结 x/y」
