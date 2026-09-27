package com.yonyong.talos.agent;

import lombok.extern.slf4j.Slf4j;

import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;

/**
 * Talos Agent 入口。
 *
 * 常驻研发终端，主动向服务端建立 gRPC 反向长连接（NAT 之后，服务端不主动入站），
 * 接收服务端顺流下发的配置与工作流节点任务并执行，回传回执、日志与产物。
 *
 * 用法：
 *   java -jar talos-agent.jar                  # 使用 conf/agent.yml
 *   java -jar talos-agent.jar --conf X:/a.yml  # 指定配置文件
 *   java -jar talos-agent.jar --keepalive      # 计划任务保活模式（等价于前台运行）
 *
 * 单实例：通过 logs/.talos-agent.lock 文件锁互斥，计划任务重复触发不会产生多份进程。
 */
@Slf4j
public class AgentApplication {

    /** 单实例锁的等待窗口：升级重启时新进程与旧进程会有短暂重叠 */
    private static final long LOCK_WAIT_MS = 10_000;

    private static FileChannel lockChannel;
    private static FileLock instanceLock;

    public static void main(String[] args) {
        if (!acquireSingleInstanceLock()) {
            log.warn("已有 Talos Agent 实例在运行，本次启动退出");
            return;
        }

        Path conf = resolveConf(args);
        if (!Files.exists(conf)) {
            log.error("缺少配置文件: {}", conf);
            log.error("请先运行 scripts/install.bat 生成，或复制 conf/agent.yml 模板并填写 server / client 字段");
            System.exit(1);
        }

        try {
            AgentConfig config = new AgentConfig(conf);
            log.info("Talos Agent 启动 · client={} · 服务端={}:{} · 工作区={}",
                    config.clientId(), config.serverAddr(), config.serverPort(), config.workspace());
            new AgentDaemon(config).run();
            log.info("Talos Agent 已停止");
        } catch (Exception e) {
            log.error("启动失败", e);
            System.exit(1);
        }
    }

    /**
     * 文件锁实现单实例。
     *
     * 会短暂重试：静默升级时新版本由旧进程拉起，两个进程会有一段重叠期，
     * 立即失败会让刚替换好的版本起不来。等待窗口内旧进程退出即可接上。
     * 加锁异常（非锁冲突）时不阻断启动。
     */
    private static boolean acquireSingleInstanceLock() {
        long deadline = System.currentTimeMillis() + LOCK_WAIT_MS;
        try {
            Path lockFile = Paths.get("logs", ".talos-agent.lock").toAbsolutePath();
            Files.createDirectories(lockFile.getParent());

            while (true) {
                FileChannel ch = FileChannel.open(lockFile,
                        StandardOpenOption.CREATE, StandardOpenOption.WRITE);
                try {
                    FileLock lock = ch.tryLock();
                    if (lock != null) {
                        lockChannel = ch;
                        instanceLock = lock;
                        return true;
                    }
                } catch (OverlappingFileLockException e) {
                    // 同一 JVM 内重复启动，直接判定为已有实例
                    ch.close();
                    return false;
                }
                ch.close();
                if (System.currentTimeMillis() >= deadline) return false;
                Thread.sleep(300);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        } catch (Exception e) {
            log.warn("单实例锁获取失败，继续启动: {}", e.getMessage());
            return true;
        }
    }

    /** 支持 --conf/-c 指定配置文件，默认 conf/agent.yml（相对启动目录） */
    private static Path resolveConf(String[] args) {
        for (int i = 0; i < args.length - 1; i++) {
            if ("--conf".equals(args[i]) || "-c".equals(args[i])) {
                return Paths.get(args[i + 1]).toAbsolutePath();
            }
        }
        return Paths.get("conf", "agent.yml").toAbsolutePath();
    }

    private AgentApplication() { }
}
