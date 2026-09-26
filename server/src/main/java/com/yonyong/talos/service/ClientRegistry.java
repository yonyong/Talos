package com.yonyong.talos.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 在线客户端注册表：客户端主动建连后登记，服务端据此定向推送任务与配置。
 * 客户端位于 NAT 之后，服务端不主动入站。
 */
@Slf4j
@Component
public class ClientRegistry {

    private final Map<String, Entry> sinks = new ConcurrentHashMap<>();

    public void register(String clientId, ClientSink sink) {
        sinks.put(clientId, new Entry(sink, LocalDateTime.now()));
        log.info("客户端上线: {}", clientId);
    }

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

    static class Entry {
        final ClientSink sink;
        volatile LocalDateTime lastSeen;
        Entry(ClientSink sink, LocalDateTime lastSeen) { this.sink = sink; this.lastSeen = lastSeen; }
    }
}
