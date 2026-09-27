package com.yonyong.talos.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * 在线客户端注册表：客户端主动建连后登记，服务端据此定向推送任务与配置。
 * 客户端位于 NAT 之后，服务端不主动入站。
 */
@Slf4j
@Component
public class ClientRegistry {

    private final Map<String, Entry> sinks = new ConcurrentHashMap<>();

    public void register(String clientId, ClientSink sink, Object owner) {
        sinks.put(clientId, new Entry(sink, LocalDateTime.now(), owner));
        log.info("客户端上线: {}", clientId);
    }

    /**
     * 注销客户端，但仅当 owner 仍是这条客户端当前的连接时。
     *
     * 静默升级会先关旧连接再建新连接，而旧连接的关闭回调可能晚于新连接的注册
     * （实测相差几十毫秒）。不判归属就会把刚重启上线的客户端误标成离线，
     * 控制台一直显示离线、心跳还在，直到下一次巡检才纠正。
     *
     * @return true 表示确实注销了（调用方可以继续置 OFFLINE）
     */
    public boolean unregister(String clientId, Object owner) {
        Entry e = sinks.get(clientId);
        if (e == null) return false;
        if (e.owner != owner) {
            log.info("忽略过期连接的关闭事件: {}", clientId);
            return false;
        }
        sinks.remove(clientId, e);
        log.info("客户端离线: {}", clientId);
        return true;
    }

    /** 强制注销（心跳超时巡检用，不看连接归属） */
    public void unregister(String clientId) {
        sinks.remove(clientId);
        log.info("客户端离线: {}", clientId);
    }

    public void heartbeat(String clientId) {
        Entry e = sinks.get(clientId);
        if (e != null) e.lastSeen = LocalDateTime.now();
    }

    public boolean isOnline(String clientId) {
        Entry e = sinks.get(clientId);
        return e != null && e.lastSeen.isAfter(LocalDateTime.now().minusSeconds(30));
    }

    public ClientSink get(String clientId) {
        Entry e = sinks.get(clientId);
        return e == null ? null : e.sink;
    }

    public int onlineCount() { return sinks.size(); }

    /** 当前在线的客户端 ID 列表（用于配置广播） */
    public List<String> onlineClientIds() {
        return sinks.keySet().stream().filter(this::isOnline).sorted().collect(Collectors.toList());
    }

    static class Entry {
        final ClientSink sink;
        final Object owner;
        volatile LocalDateTime lastSeen;
        Entry(ClientSink sink, LocalDateTime lastSeen, Object owner) {
            this.sink = sink;
            this.lastSeen = lastSeen;
            this.owner = owner;
        }
    }
}
