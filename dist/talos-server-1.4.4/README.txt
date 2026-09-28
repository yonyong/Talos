================================================================
 Talos 服务端 部署包  (CentOS / Linux)
================================================================

一、包内结构
----------------------------------------------------------------
  app/     服务端主程序（talos-server-<版本>.jar，内嵌前端页面）
  bin/     部署与运维脚本（deploy / start / stop / status / upgrade）
  config/  外置配置（application.yml + env.sh，改这里，不用动 jar）
  data/    H2 数据库与 Issue 附件（升级不会覆盖）
  logs/    运行日志
  run/     进程号文件
  releases/ 客户端 agent 安装包放这里，供客户端下载升级
  nginx/    nginx 反向代理配置模板（可选，要域名 / HTTPS 时用）
  VERSION.txt  版本、构建时间、jar 校验值

二、首次部署
----------------------------------------------------------------
  1) 上传并解压到服务器，例如：

       scp talos-server-*.tar.gz root@<服务器>:/tmp/
       ssh root@<服务器>
       mkdir -p /opt/applications/talos
       tar -xzf /tmp/talos-server-*.tar.gz -C /opt/applications/talos --strip-components=1
       chmod +x /opt/applications/talos/bin/*.sh

     ⚠️ chmod 这一步不能省：压缩包是在 Windows 上打出来的，不保留
        Linux 的执行权限位。漏掉会报 "Permission denied"。
        （应急也可以直接用 bash 调：bash bin/start.sh）

  2) 检查 Java（必须是 17 或更高）：

       java -version
       # 没有就装：yum install -y java-17-openjdk-headless

  3) 跑到目标目录做一次初始化（建目录、赋权限、校验 jar）：

       cd /opt/applications/talos
       bin/deploy.sh /opt/applications/talos

     如果包已经解压在 /opt/applications/talos，这一步只做初始化，不会重复拷贝。
     常用参数：
       --user talos     把安装目录属主改成 talos
       --keep-config    保留服务器上已有的 config/（升级时用）

  4) 改配置（两个文件）：

       vi config/env.sh           端口、数据库口令、签名密钥、LLM Key
       vi config/application.yml  一般不用改，默认值已按生产调好

     上线前必须改的两项：
       TALOS_SIGN_SECRET   任务下发签名密钥，所有客户端 conf/agent.yml
                           里的 signSecret 必须与它一致，否则任务会被拒收
       TALOS_LLM_KEY       服务端大模型 Key（准入判定、分拣、问答）

  5) 放行端口（默认 8080 控制台 / 9443 客户端长连接）：

       firewall-cmd --permanent --add-port=8080/tcp
       firewall-cmd --permanent --add-port=9443/tcp
       firewall-cmd --reload

  6) 启动并确认：

       bin/start.sh
       bin/status.sh

     浏览器打开 http://<服务器>:8080/ 即可看到控制台。

三、日常运维
----------------------------------------------------------------
  bin/start.sh              启动（已在运行则什么都不做）
  bin/stop.sh               停止（30 秒没退出会提示，加 --force 强制杀）
  bin/status.sh             版本、进程、端口、HTTP 探测、日志尾部
  tail -f logs/server.log   实时看日志

  重启： bin/stop.sh && bin/start.sh

四、升级（换 jar，不动配置和数据）
----------------------------------------------------------------
  1) 上传新 jar 到服务器，例如 /tmp/talos-server-1.5.0.jar
  2) 执行：

       bin/upgrade.sh --jar /tmp/talos-server-1.5.0.jar

  脚本会：停服 -> 旧 jar 备份到 app/backup/ -> 换入新 jar -> 校验 -> 启动。
  config/ 和 data/ 完全不动，数据库结构由 Hibernate 启动时自动升级。
  只想换 jar 不启动：加 --keep。

  回滚：用 app/backup/ 里的旧 jar 再跑一次 upgrade.sh 即可。

五、客户端安装包的分发
----------------------------------------------------------------
  服务端从 releases/ 目录提供 agent 安装包下载（控制台「客户端」页）。
  把客户端包的 talos-agent.jar 放进去：

       cp talos-agent.jar /opt/applications/talos/releases/

  客户端版本落后时会自动静默升级，配置项见 config/env.sh 的
  TALOS_AUTO_UPGRADE。详细说明见客户端包内的 README.txt。

六、用 nginx 暴露控制台（可选）
----------------------------------------------------------------
  直接访问 http://<服务器>:8080/ 就能用。只有当你要接域名、上 HTTPS
  或走统一入口时才需要 nginx，配置模板在包的 nginx/talos.conf：

      cp nginx/talos.conf /etc/nginx/conf.d/
      vi /etc/nginx/conf.d/talos.conf     # 改 server_name 和证书路径
      nginx -t && systemctl reload nginx

  三条硬约束，踩中任何一条都会浪费很久（模板里都有对应注释）：

  1) 只能挂「独立域名 + 根路径」，不能挂 /talos/ 这类子路径。
     前端在构建期就把 API 基址写成了 /api、页面资源写成了
     /assets/xxx.js，挂到 /talos/ 下浏览器会去请求 /api 和
     /assets，全部 404，页面直接白屏。要和别的应用共存，请用
     独立域名或独立端口区分，不要用路径前缀。

  2) client_max_body_size 必须放大到 1024m。服务端上传上限是 1GB，
     而 nginx 默认只有 1MB，不改的话上传 agent 安装包会被 413 挡在
     nginx 层 —— 请求根本到不了后端，后端日志里什么都看不到，很
     容易误判成前端问题。

  3) proxy_read_timeout 别用 60s。准入判定 / 项目分拣是「录入即判」，
     同步调用大模型，单次超过 60 秒很常见，超时会先抛 504 而后端
     其实还在跑。模板给了 600s。

  客户端 gRPC（9443）默认不需要 nginx —— 让客户端直连服务端 9443
  最简单，也少一层故障点。确实需要统一入口时，模板末尾有一段注释
  掉的 h2c 配置，注意事项都写在里面（最关键的一条：agent 走的是
  明文通道，gRPC 不能复用 443 那个 HTTPS 端口）。

七、常见问题
----------------------------------------------------------------
  Q: start.sh 报 "port already in use"
  A: 说明有残留进程。执行 bin/stop.sh --force，再 start.sh。

  Q: start.sh 报 "process exited during startup"
  A: 看日志尾部找原因： tail -n 50 logs/server.log

  Q: 控制台能开，但客户端一直连不上
  A: 1) 确认 9443 已放行（防火墙、安全组都要）；
     2) 客户端 conf/agent.yml 的 addr 必须是服务端对客户端可达的地址；
     3) 两侧 signSecret 与 TALOS_SIGN_SECRET 必须一致。

  Q: 脚本报 "\r: command not found"
  A: 文件被 Windows 编辑过，行尾变成了 CRLF。修复：
     sed -i 's/\r$//' bin/*.sh config/env.sh

八、数据备份
----------------------------------------------------------------
  数据库和附件都在 data/ 下，直接冷备（停服后拷贝）或热备用 H2 的
  备份命令。升级前建议先打包一份：

       tar -czf talos-data-$(date +%Y%m%d).tar.gz data/
================================================================
