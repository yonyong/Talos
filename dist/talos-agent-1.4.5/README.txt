================================================================
 Talos 客户端 agent 部署包  (Windows / CentOS 双平台)
================================================================

一、包内结构
----------------------------------------------------------------
  talos-agent.jar     客户端主程序（Java，需 JRE 17+）
  conf/agent.yml      客户端配置（服务端地址、token、工作目录等）
  scripts/            Windows 脚本（install / start / stop / status / upgrade / uninstall）
  scripts-linux/      Linux 脚本（同名，语义一一对应）
  setup.bat           Windows 双击即装（等价于 scripts\install.bat）
  logs/               运行日志（agent.log）
  upgrade/            升级暂存与旧 jar 备份
  README.txt          本文件

  两套脚本任选其一，按目标机器的操作系统走。不需要的那套可以直接忽略。

二、开始之前要准备什么
----------------------------------------------------------------
  1) Java：目标机器必须已安装 JRE 17 或更高
       Windows: java -version
       Linux  : java -version     （没有则 yum install -y java-17-openjdk-headless）

  2) 服务端地址：gRPC 端口（默认 9443）+ 控制台 HTTP 端口（默认 8080）
     客户端是主动外连，所以这个地址必须是"客户端机器能访问到服务端"的地址。

  3) 接入令牌：在控制台「客户端」页生成，一次性使用（可选但建议）。

三、Windows 部署
----------------------------------------------------------------
  1) 把整个文件夹拷到目标机器，例如 C:\Talos
  2) 在机器上以普通用户身份执行（不用管理员）：

       scripts\install.bat --server 10.0.0.5:9443 --token <令牌> --id <客户端id>

     或者直接双击 setup.bat，按提示依次输入。

  脚本会：写 conf\agent.yml -> 注册计划任务 TalosAgentWatchdog（每 5 分钟保活）
  -> 立即启动 agent。

  日常命令（在包根目录执行）：
       scripts\status.bat      查看状态与最近日志
       scripts\stop.bat        停止
       scripts\start.bat       启动
       scripts\upgrade.bat     从服务端拉取最新版本并替换
       scripts\uninstall.bat   移除保活任务并停止

四、CentOS / Linux 部署
----------------------------------------------------------------
  1) 上传并解压到目标机器，例如 /opt/applications/talos-agent：

       scp talos-agent-*-linux.tar.gz root@<目标机>:/tmp/
       ssh root@<目标机>
       mkdir -p /opt/applications/talos-agent
       tar -xzf /tmp/talos-agent-*-linux.tar.gz -C /opt/applications/talos-agent --strip-components=1
       chmod +x /opt/applications/talos-agent/scripts-linux/*.sh

     ⚠️ chmod 不能省：压缩包在 Windows 上打出来，不带 Linux 执行位。

  2) 赋执行权限并安装：

       cd /opt/applications/talos-agent
       chmod +x scripts-linux/*.sh
       scripts-linux/install.sh --server 10.0.0.5:9443 --token <令牌> --id <客户端id>

     脚本会：写 conf/agent.yml -> 在当前用户的 crontab 里注册保活条目
     （每 5 分钟检查一次）-> 立即启动 agent。

     ⚠️ crontab 是"按用户"的。用 root 装就在 root 的 crontab 里，
        用 talos 装就在 talos 的 crontab 里。请用最终要长期运行该进程的
        那个用户来执行 install.sh。

  3) 确认 crond 在跑（保活依赖它）：

       systemctl status crond
       systemctl enable --now crond     # 没启动就启动

  日常命令：
       scripts-linux/status.sh     查看状态、配置、保活、最近日志
       scripts-linux/stop.sh       停止（停止后 5 分钟内会被 crontab 拉起）
       scripts-linux/start.sh      启动
       scripts-linux/upgrade.sh    从服务端拉取最新版本并替换
       scripts-linux/uninstall.sh  移除 crontab 条目并停止

  不想用 crontab 保活：安装时加 --no-cron，之后需自己保证进程存活。

五、conf/agent.yml 说明
----------------------------------------------------------------
  server.addr       服务端地址（客户端机器能访问到的那个 IP/域名）
  server.port       gRPC 端口，默认 9443
  server.httpPort   控制台 HTTP 端口，默认 8080，升级下载用
  client.id         客户端唯一标识，控制台按它下发配置、路由任务
  client.token      接入令牌，服务端校验后放行
  client.workspace  任务工作目录（代码检出、产物输出都在这里）
                    ⚠️ Windows 路径必须用正斜杠或双反斜杠，如 C:/Talos/workspace
  client.signSecret 与服务端 talos.security.task-sign-secret 一致；
                    留空则不校验任务签名（生产环境建议填上）
  client.allowUpgrade
                    true  允许服务端下发静默升级（自动替换重启）
                    false 本机拒绝远程替换，只能手工 upgrade
  agents            本机可用的 Coding Agent 后端与模型
                    （控制台「Coding Agent」页可按 clientId 覆盖）

  改完配置后重启 agent 生效：stop 之后 start，或直接 upgrade 不会重读配置。

六、故障排查
----------------------------------------------------------------
  Q: 控制台「客户端」页一直显示离线
  A: 1) scripts-linux/status.sh 看进程在不在、日志有没有报错
     2) 确认能连上服务端 gRPC 端口：
          Linux  : nc -zv <server> 9443   或   telnet <server> 9443
          Windows: Test-NetConnection <server> -Port 9443
     3) 确认 client.id 与 token 正确

  Q: Linux 上报 "\r: command not found"
  A: 脚本行尾变成了 CRLF。修复：sed -i 's/\r$//' scripts-linux/*.sh

  Q: agent 被 stop 之后又自己起来了
  A: 这是保活在起作用（Win 的计划任务 / Linux 的 crontab，每 5 分钟一次）。
     要让它彻底停住，请执行 uninstall（Windows: scripts\uninstall.bat，
     Linux: scripts-linux/uninstall.sh）。

  Q: 静默升级失败、版本没变
  A: 服务端 release-dir 里必须放有 talos-agent.jar（服务端包内的 releases/ 目录）。
     手动升级可看 upgrade/ 下的备份与 logs/agent.log。

七、升级与回滚
----------------------------------------------------------------
  正常路径：服务端放好新 jar 后，客户端自动静默升级；或手工执行 upgrade 脚本。
  回滚：upgrade/backup-talos-agent.jar 是替换前的旧版本，
        停掉 agent 后用该文件覆盖 talos-agent.jar 再启动即可。
================================================================
