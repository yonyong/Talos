package com.yonyong.talos.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yonyong.talos.grpc.AgentServiceGrpc;
import com.yonyong.talos.grpc.ClientMessage;
import com.yonyong.talos.grpc.ServerMessage;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.stub.StreamObserver;
import lombok.extern.slf4j.Slf4j;

import java.net.InetAddress;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * 反向长连接守护。
 *
 * 生命周期：建流 → REGISTER → 周期 HEARTBEAT → 处理下行消息；断线按指数退避重连。
 * 服务端在收到 REGISTER 后会立即回推一次 CONFIG_PUSH。
 */
@Slf4j
public class AgentDaemon {

    private final AgentConfig config;
    private final ConfigStore configStore = new ConfigStore();
    private final InboundHandler inbound;
    private final ObjectMapper om = new ObjectMapper();

    private final ScheduledExecutorService heartbeatExec =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "talos-heartbeat");
                t.setDaemon(true);
                return t;
            });

    private volatile ManagedChannel channel;
    private volatile StreamObserver<ClientMessage> outbound;
    private volatile ScheduledFuture<?> heartbeatTask;
    /** 当前流的主动断开钩子（服务端要求重连时使用） */
    private volatile Runnable forceClose;
    private volatile boolean running = true;
    private int backoffSeconds = 1;

    public AgentDaemon(AgentConfig config) {
        this.config = config;
        // 本地 agent.yml 作为兜底，服务端 CONFIG_PUSH 到达后覆盖同名字段
        this.configStore.setLocalAgents(config.agents());
        this.inbound = new InboundHandler(config, configStore, this::send, () -> channel,
                this::reconnect, this::shutdownConnection);
        Runtime.getRuntime().addShutdownHook(new Thread(this::shutdown, "talos-shutdown"));
    }

    /** 服务端要求重连：断开当前流，主循环随即以 1s 起步重新建连 */
    public void reconnect() {
        Runnable r = forceClose;
        if (r == null) {
            log.info("当前无活动连接，无需重连");
            return;
        }
        running = true;
        r.run();
    }

    /** 主循环：连接 → 服务 → 断开 → 退避 → 重连，直到进程退出 */
    public void run() {
        while (running) {
            try {
                serve();
                backoffSeconds = 1;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                log.warn("连接中断: {}", rootMessage(e));
            }
            if (!running) break;
            sleepBackoff();
        }
    }

    /** 建立一次双向流并阻塞式服务，直到流被关闭或出错 */
    private void serve() throws InterruptedException {
        channel = ManagedChannelBuilder
                .forAddress(config.serverAddr(), config.serverPort())
                .usePlaintext()
                .keepAliveTime(30, TimeUnit.SECONDS)
                .keepAliveWithoutCalls(true)
                .build();

        CountDownLatch closed = new CountDownLatch(1);
        forceClose = () -> {
            closed.countDown();
            shutdownChannel();
        };
        AgentServiceGrpc.AgentServiceStub stub = AgentServiceGrpc.newStub(channel);

        StreamObserver<ServerMessage> resp = new StreamObserver<>() {
            @Override
            public void onNext(ServerMessage msg) {
                try {
                    inbound.handle(msg);
                } catch (Exception e) {
                    log.error("处理下行消息失败", e);
                }
            }

            @Override
            public void onError(Throwable t) {
                log.warn("流异常: {}", rootMessage(t));
                closed.countDown();
            }

            @Override
            public void onCompleted() {
                log.info("服务端已关闭连接");
                closed.countDown();
            }
        };

        log.info("正在连接 {}:{} …", config.serverAddr(), config.serverPort());
        outbound = stub.connect(resp);
        sendRegister();
        startHeartbeat();

        try {
            closed.await();
        } finally {
            forceClose = null;
            stopHeartbeat();
            shutdownChannel();
        }
    }

    /** 首帧注册：服务端据此登记 sink 并立即回推配置 */
    private void sendRegister() {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("clientId", config.clientId());
        p.put("token", config.token());
        p.put("ip", localIp());
        p.put("version", version());
        p.put("agents", agentSummary());
        send("REGISTER", p);
    }

    private void startHeartbeat() {
        long period = Math.max(3, config.heartbeatSeconds());
        heartbeatTask = heartbeatExec.scheduleAtFixedRate(() -> {
            try {
                Map<String, Object> p = new LinkedHashMap<>();
                p.put("state", "IDLE");
                send("HEARTBEAT", p);
            } catch (Exception e) {
                // 任务内部吞掉异常，否则 scheduleAtFixedRate 会静默停止后续心跳
                log.warn("心跳发送失败: {}", e.getMessage());
            }
        }, period, period, TimeUnit.SECONDS);
        log.info("心跳已启动，周期 {}s", period);
    }

    /** 仅取消当前心跳任务，调度器保留供重连后复用 */
    private void stopHeartbeat() {
        ScheduledFuture<?> task = heartbeatTask;
        heartbeatTask = null;
        if (task != null) task.cancel(false);
    }

    /** 线程安全地向上行流写入一条消息 */
    public synchronized void send(String type, Map<String, Object> payload) {
        StreamObserver<ClientMessage> o = outbound;
        if (o == null) {
            log.warn("尚未建连，消息未发送: {}", type);
            return;
        }
        try {
            o.onNext(ClientMessage.newBuilder()
                    .setType(type)
                    .setPayloadJson(om.writeValueAsString(payload))
                    .build());
        } catch (Exception e) {
            log.warn("发送 {} 失败: {}", type, e.getMessage());
        }
    }

    private void sleepBackoff() {
        log.info("{} 秒后尝试重连…", backoffSeconds);
        try {
            Thread.sleep(backoffSeconds * 1000L);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            running = false;
            return;
        }
        backoffSeconds = Math.min(backoffSeconds * 2, 60);
    }

    private void shutdownChannel() {
        outbound = null;
        ManagedChannel c = channel;
        channel = null;
        if (c != null) {
            try {
                c.shutdownNow();
            } catch (Exception ignored) {
                // 忽略关闭异常
            }
        }
    }

    private void shutdown() {
        running = false;
        stopHeartbeat();
        shutdownChannel();
    }

    /** 供升级流程调用：只断连接，不退出进程 */
    private void shutdownConnection() {
        running = false;
    }

    private String localIp() {
        try {
            return InetAddress.getLocalHost().getHostAddress();
        } catch (Exception e) {
            return "";
        }
    }

    private String version() {
        String v = AgentApplication.class.getPackage().getImplementationVersion();
        return v == null ? "dev" : v;
    }

    /** 上报本机启用的后端清单，供控制台「客户端」页展示 */
    private String agentSummary() {
        List<String> enabled = config.agents().stream()
                .filter(a -> Boolean.TRUE.equals(a.get("enabled")))
                .map(a -> String.valueOf(a.get("backend")))
                .collect(Collectors.toList());
        return String.join(",", enabled);
    }

    private static String rootMessage(Throwable t) {
        Throwable c = t;
        while (c.getCause() != null && c.getCause() != c) c = c.getCause();
        return c.getMessage() == null ? c.getClass().getSimpleName() : c.getMessage();
    }
}
