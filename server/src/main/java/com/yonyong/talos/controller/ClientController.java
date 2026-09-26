package com.yonyong.talos.controller;

import com.yonyong.talos.entity.ClientEntity;
import com.yonyong.talos.repository.ClientRepository;
import com.yonyong.talos.service.ClientRegistry;
import com.yonyong.talos.service.ConfigService;
import com.yonyong.talos.service.DispatchService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 客户端连接状态与配置下发 */
@RestController
@RequestMapping("/api/clients")
@RequiredArgsConstructor
public class ClientController {

    private final ClientRepository clientRepository;
    private final ClientRegistry registry;
    private final ConfigService configService;
    private final DispatchService dispatchService;

    @GetMapping
    public List<ClientEntity> list() { return clientRepository.findAll(); }

    @GetMapping("/stats")
    public Map<String, Object> stats() {
        Map<String, Object> m = new LinkedHashMap<>();
        List<ClientEntity> all = clientRepository.findAll();
        long online = all.stream().filter(c -> registry.isOnline(c.getClientId())).count();
        m.put("total", all.size());
        m.put("online", online);
        m.put("offline", all.size() - online);
        m.put("onlineRate", all.isEmpty() ? 0 : (online * 100 / all.size()));
        m.put("checkedAt", LocalDateTime.now().toString());
        return m;
    }

    /** 请求客户端重连（服务端无法主动入站，仅置位并等待其心跳） */
    @PostMapping("/{clientId}/reconnect")
    public ResponseEntity<Map<String, Object>> reconnect(@PathVariable String clientId) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("clientId", clientId);
        m.put("online", registry.isOnline(clientId));
        m.put("hint", "客户端位于 NAT 后，将由客户端主动重连");
        return ResponseEntity.ok(m);
    }

    /** 立即下发配置 */
    @PostMapping("/{clientId}/push-config")
    public ResponseEntity<Map<String, Object>> push(@PathVariable String clientId) {
        boolean ok = dispatchService.pushConfig(clientId, configService.buildPush(clientId));
        return ResponseEntity.ok(Map.of("clientId", clientId, "pushed", ok));
    }
}
