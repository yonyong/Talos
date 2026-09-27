package com.yonyong.talos.controller;

import com.yonyong.talos.entity.AiCallLogEntity;
import com.yonyong.talos.entity.ClientEntity;
import com.yonyong.talos.entity.UserEntity;
import com.yonyong.talos.repository.AiCallLogRepository;
import com.yonyong.talos.repository.ClientRepository;
import com.yonyong.talos.repository.UserRepository;
import com.yonyong.talos.service.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 客户端连接状态、运行日志、配置下发与静默升级 */
@RestController
@RequestMapping("/api/clients")
@RequiredArgsConstructor
public class ClientController {

    private final ClientRepository clientRepository;
    private final AiCallLogRepository aiCallLogRepository;
    private final UserRepository userRepository;
    private final ClientRegistry registry;
    private final ConfigService configService;
    private final DispatchService dispatchService;
    private final ClientLogService clientLog;
    private final AgentReleaseService releaseService;
    private final WorkflowService workflowService;

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

    /* ==================== 绑定用户管理 ==================== */

    /**
     * 用户绑定客户端后不可自行更换（UserController.save 已拦截），
     * 唯一出口是这里：管理员在「客户端管理」解除绑定后，用户才能重新绑定。
     */
    @PostMapping("/{clientId}/bound-users/{empNo}/unbind")
    public ResponseEntity<Map<String, Object>> unbindUser(@PathVariable String clientId, @PathVariable String empNo) {
        UserEntity u = userRepository.findByEmpNo(empNo);
        if (u == null || !clientId.equals(u.getClientId())) {
            throw new IllegalArgumentException("用户 " + empNo + " 未绑定客户端 " + clientId);
        }
        u.setClientId(null);
        userRepository.save(u);
        clientLog.info(clientId, "server", "管理员已解除用户绑定 · " + u.getName() + "（" + empNo + "）");
        // 解绑后个人配置层失效：客户端在线则立即重推，回退到全局/客户端层
        boolean pushed = false;
        if (registry.isOnline(clientId)) {
            pushed = dispatchService.pushConfig(clientId, configService.buildPush(clientId));
        }
        return ResponseEntity.ok(Map.of(
                "clientId", clientId,
                "empNo", empNo,
                "name", u.getName() == null ? "" : u.getName(),
                "configPushed", pushed));
    }

    /* ==================== 运行日志 ==================== */

    /** 客户端运行日志：source=all / server / agent */
    @GetMapping("/{clientId}/logs")
    public Map<String, Object> logs(@PathVariable String clientId,
                                    @RequestParam(defaultValue = "300") int limit,
                                    @RequestParam(defaultValue = "all") String source) {
        List<ClientLogService.Entry> entries = clientLog.tail(clientId, limit, source);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("clientId", clientId);
        m.put("online", registry.isOnline(clientId));
        m.put("total", clientLog.size(clientId));
        m.put("entries", entries);
        return m;
    }

    /** 拉取客户端本地 logs/agent.log 尾部：下发 PULL_LOG，客户端回传 LOG_DATA */
    @PostMapping("/{clientId}/logs/pull")
    public ResponseEntity<Map<String, Object>> pullLogs(@PathVariable String clientId,
                                                       @RequestParam(defaultValue = "200") int lines) {
        Map<String, Object> cmd = new LinkedHashMap<>();
        cmd.put("command", "PULL_LOG");
        cmd.put("lines", Math.max(20, Math.min(lines, 2000)));
        boolean ok = dispatchService.sendCommand(clientId, cmd);
        if (ok) clientLog.info(clientId, "server", "已请求客户端回传日志尾部（" + lines + " 行）");
        return ResponseEntity.ok(Map.of(
                "clientId", clientId,
                "requested", ok,
                "hint", ok ? "已下发拉取指令，客户端回传后自动并入日志" : "客户端离线，无法拉取本地日志"));
    }

    @DeleteMapping("/{clientId}/logs")
    public Map<String, Object> clearLogs(@PathVariable String clientId) {
        int before = clientLog.size(clientId);
        clientLog.clear(clientId);
        return Map.of("clientId", clientId, "cleared", before);
    }

    /** 该客户端上报过的 AI 调用记录（机械节点产生的假记录展示端过滤） */
    @GetMapping("/{clientId}/ai-logs")
    public List<AiCallLogEntity> aiLogs(@PathVariable String clientId) {
        return workflowService.filterRealAiCalls(
                aiCallLogRepository.findTop50ByClientIdOrderByCreatedAtDesc(clientId));
    }

    /* ==================== 连接与配置 ==================== */

    /** 请求客户端重连：下发 COMMAND RECONNECT，客户端主动断开并按退避重连（服务端无法主动入站） */
    @PostMapping("/{clientId}/reconnect")
    public ResponseEntity<Map<String, Object>> reconnect(@PathVariable String clientId) {
        boolean online = registry.isOnline(clientId);
        boolean sent = online && dispatchService.sendCommand(clientId, Map.of("command", "RECONNECT"));
        if (sent) clientLog.info(clientId, "server", "已下发重连指令");
        return ResponseEntity.ok(Map.of(
                "clientId", clientId,
                "online", online,
                "requested", sent,
                "hint", sent ? "已通知客户端重建连接"
                        : "客户端当前离线，服务端没有可达的下行通道，无法远程拉起："
                        + "进程仍存活时会自行退避重连（最长 60s）自动恢复；"
                        + "进程已退出则只能在该客户端本机执行 scripts\\start.bat"));
    }

    /** 全部在线客户端重连 */
    @PostMapping("/reconnect-all")
    public Map<String, Object> reconnectAll() {
        List<String> targets = registry.onlineClientIds();
        int sent = 0;
        for (String id : targets) {
            if (dispatchService.sendCommand(id, Map.of("command", "RECONNECT"))) sent++;
        }
        return Map.of("online", targets.size(), "requested", sent);
    }

    /** 立即下发配置 */
    @PostMapping("/{clientId}/push-config")
    public ResponseEntity<Map<String, Object>> push(@PathVariable String clientId) {
        Map<String, Object> cfg = configService.buildPush(clientId);
        boolean ok = dispatchService.pushConfig(clientId, cfg);
        if (ok) {
            Object agents = cfg.get("agents");
            Object prompts = cfg.get("prompts");
            clientLog.info(clientId, "server", "手工下发配置 · Agent "
                    + (agents instanceof List<?> l1 ? l1.size() : 0) + " 个 · Prompt "
                    + (prompts instanceof List<?> l2 ? l2.size() : 0) + " 个");
        }
        return ResponseEntity.ok(Map.of("clientId", clientId, "pushed", ok));
    }

    /* ==================== 静默升级 ==================== */

    /** 升级单个客户端到服务端当前发布版 */
    @PostMapping("/{clientId}/upgrade")
    public ResponseEntity<Map<String, Object>> upgrade(@PathVariable String clientId) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("clientId", clientId);
        AgentReleaseService.Release r = releaseService.latest();
        if (r == null) {
            m.put("pushed", false);
            m.put("hint", "服务端未找到客户端安装包，先执行 client/build-package.bat 生成，或检查 talos.agent.release-dir");
            return ResponseEntity.ok(m);
        }
        boolean ok = dispatchService.sendCommand(clientId, UpgradeCommand.build(r));
        if (ok) clientLog.info(clientId, "server", "已下发静默升级指令 → " + r.version() + "（SHA256 " + shortSha(r.sha256()) + "）");
        m.put("pushed", ok);
        m.put("version", r.version());
        m.put("sha256", r.sha256());
        m.put("hint", ok ? "客户端将后台下载并自动重启完成升级" : "客户端离线，无法下发升级指令");
        return ResponseEntity.ok(m);
    }

    /** 批量升级：只挑版本落后的在线客户端 */
    @PostMapping("/upgrade-all")
    public Map<String, Object> upgradeAll() {
        Map<String, Object> m = new LinkedHashMap<>();
        AgentReleaseService.Release r = releaseService.latest();
        if (r == null) {
            m.put("pushed", 0);
            m.put("hint", "服务端未找到客户端安装包");
            return m;
        }
        List<String> pushed = new ArrayList<>();
        List<String> skipped = new ArrayList<>();
        for (ClientEntity c : clientRepository.findAll()) {
            String id = c.getClientId();
            if (!registry.isOnline(id)) { skipped.add(id + "(离线)"); continue; }
            if (!releaseService.needsUpgrade(c.getVersion())) { skipped.add(id + "(已是最新)"); continue; }
            if (dispatchService.sendCommand(id, UpgradeCommand.build(r))) {
                pushed.add(id);
                clientLog.info(id, "server", "已下发静默升级指令 → " + r.version());
            }
        }
        m.put("target", r.version());
        m.put("pushed", pushed.size());
        m.put("clients", pushed);
        m.put("skipped", skipped);
        return m;
    }

    private static String shortSha(String sha) {
        if (sha == null || sha.length() < 12) return sha == null ? "—" : sha;
        return sha.substring(0, 8) + "…" + sha.substring(sha.length() - 4);
    }
}
