package com.yonyong.talos.service;

import com.yonyong.talos.entity.ClientEntity;
import com.yonyong.talos.repository.ClientRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 客户端健康巡检。
 *
 * gRPC 流断开时服务端能立即感知，但进程被强杀 / 网络黑洞时流可能长时间不报错，
 * 于是这里按心跳做兜底：超过 30 秒没有心跳即置 OFFLINE 并记一条链路事件，
 * 与 ClientRegistry.isOnline 的判定口径保持一致。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ClientMonitorService {

    private final ClientRepository clientRepository;
    private final ClientRegistry registry;
    private final ClientLogService clientLog;

    @Scheduled(fixedDelay = 15_000, initialDelay = 30_000)
    public void sweepOffline() {
        List<ClientEntity> all = clientRepository.findAll();
        for (ClientEntity c : all) {
            String id = c.getClientId();
            if (id == null || id.isBlank()) continue;
            if ("OFFLINE".equals(c.getStatus())) continue;
            if (registry.isOnline(id)) continue;

            c.setStatus("OFFLINE");
            clientRepository.save(c);
            // 只改状态，绝不删 sink：sink 的生命周期归连接（onError / onCompleted）所有。
            // 若这里顺手 unregister，一旦心跳只是「迟到」（GC 停顿、网络抖动，
            // 或客户端 heartbeatSeconds 被配成大于 30s），sink 就被永久删除；
            // 而 ClientRegistry.heartbeat 只在 sink 存在时才刷新 lastSeen，
            // 于是出现最坑的一种状态：客户端流还活着、心跳还在发，
            // 服务端却再也认不回它 —— 控制台状态在 ONLINE/OFFLINE 之间反复横跳，
            // 所有下发（重连 / 升级 / 配置 / 任务）一律返回「客户端离线」，且永不自愈。
            // 保留 sink 后，下一条心跳会自行刷新 lastSeen，状态自动恢复。
            clientLog.warn(id, "server", "心跳超时（>30s），判定离线");
            log.info("客户端心跳超时判定离线: {}", id);
        }
    }
}
