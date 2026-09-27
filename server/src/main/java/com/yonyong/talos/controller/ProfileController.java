package com.yonyong.talos.controller;

import com.yonyong.talos.entity.UserAgentEntity;
import com.yonyong.talos.entity.UserEntity;
import com.yonyong.talos.entity.UserSettingEntity;
import com.yonyong.talos.repository.UserAgentRepository;
import com.yonyong.talos.repository.UserRepository;
import com.yonyong.talos.repository.UserSettingRepository;
import com.yonyong.talos.service.ClientLogService;
import com.yonyong.talos.service.ClientRegistry;
import com.yonyong.talos.service.ConfigService;
import com.yonyong.talos.service.DispatchService;
import com.yonyong.talos.service.ProbeService;
import lombok.RequiredArgsConstructor;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 用户个人设置：Coding Agent 多条配置 + Git 凭据 + 工具链（工作目录 / Maven）。
 *
 * 当前无真实鉴权，empNo 由前端从本地个人信息（工号）传入；
 * 接入真实登录后改为从会话取当前用户，接口形态不变。
 * Git Token 永不回显明文，只返回是否已配置与掩码；保存时传空 = 保持原值，clearGitToken=true 才清空。
 *
 * 测试（probe）走 C/S 架构唯一可行路径：经 gRPC 双向流下发 PROBE_REQ，
 * 用户绑定的客户端在本机真实执行（CLI --version / git ls-remote / 目录与 Maven 检查）后回执。
 */
@RestController
@RequestMapping("/api/profile")
@RequiredArgsConstructor
public class ProfileController {

    private final UserSettingRepository userSettingRepository;
    private final UserAgentRepository userAgentRepository;
    private final UserRepository userRepository;
    private final ProbeService probeService;
    private final ConfigService configService;
    private final DispatchService dispatchService;
    private final ClientRegistry clientRegistry;
    private final ClientLogService clientLog;

    /* ============================ 查询 ============================ */

    @GetMapping("/{empNo}")
    public Map<String, Object> get(@PathVariable String empNo) {
        UserSettingEntity s = userSettingRepository.findByEmpNo(empNo);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("empNo", empNo);
        m.put("workDir", s == null ? null : s.getWorkDir());
        m.put("mavenHome", s == null ? null : s.getMavenHome());
        m.put("gitUserName", s == null ? null : s.getGitUserName());
        m.put("gitUserEmail", s == null ? null : s.getGitUserEmail());
        m.put("gitTestRepoUrl", s == null ? null : s.getGitTestRepoUrl());

        String token = s == null ? null : s.getGitToken();
        boolean set = token != null && !token.isBlank();
        m.put("gitTokenSet", set);
        m.put("gitTokenMask", set ? mask(token) : "");

        // 工作流自动执行开关：null 视为开（缺省自动）
        m.put("autoStart", s == null || !Boolean.FALSE.equals(s.getAutoStart()));

        List<Map<String, Object>> agents = new ArrayList<>();
        for (UserAgentEntity a : userAgentRepository.findByEmpNoOrderBySortOrderAscIdAsc(empNo)) {
            Map<String, Object> am = new LinkedHashMap<>();
            am.put("id", a.getId());
            am.put("backend", a.getBackend());
            am.put("execPath", a.getExecPath());
            am.put("argsTemplate", a.getArgsTemplate());
            am.put("workDir", a.getWorkDir());
            am.put("envVars", a.getEnvVars());
            am.put("model", a.getModel());
            am.put("tokenLimit", a.getTokenLimit());
            am.put("enabled", !Boolean.FALSE.equals(a.getEnabled()));
            agents.add(am);
        }
        m.put("agents", agents);

        UserEntity u = userRepository.findByEmpNo(empNo);
        m.put("boundClientId", u == null ? null : u.getClientId());
        m.put("boundUserName", u == null ? null : u.getName());
        return m;
    }

    /* ============================ 保存：Git + 工具链 ============================ */

    @PostMapping("/{empNo}")
    public Map<String, Object> save(@PathVariable String empNo, @RequestBody Map<String, Object> body) {
        UserSettingEntity target = userSettingRepository.findByEmpNo(empNo);
        if (target == null) {
            target = new UserSettingEntity();
            target.setEmpNo(empNo);
        }
        if (body.containsKey("workDir")) target.setWorkDir(str(body.get("workDir")));
        if (body.containsKey("mavenHome")) target.setMavenHome(str(body.get("mavenHome")));
        if (body.containsKey("gitUserName")) target.setGitUserName(str(body.get("gitUserName")));
        if (body.containsKey("gitUserEmail")) target.setGitUserEmail(str(body.get("gitUserEmail")));
        if (body.containsKey("gitTestRepoUrl")) target.setGitTestRepoUrl(str(body.get("gitTestRepoUrl")));
        if (body.containsKey("autoStart")) target.setAutoStart(Boolean.parseBoolean(str(body.get("autoStart"))));

        String token = str(body.get("gitToken"));
        if (Boolean.TRUE.equals(body.get("clearGitToken"))) {
            target.setGitToken(null);
        } else if (!token.isBlank()) {
            target.setGitToken(token);
        }
        target.setUpdatedAt(LocalDateTime.now());
        userSettingRepository.save(target);

        // Git 凭据 / 工具链变了客户端必须拿到新值才生效：绑定客户端在线则立即重推
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("saved", true);
        r.put("empNo", empNo);
        r.putAll(pushToBoundClient(empNo, "个人设置（Git 凭据 / 工具链）"));
        return r;
    }

    /* ============================ 保存：Agent 多条（含拖拽排序，整表重写） ============================ */

    @PostMapping("/{empNo}/agents")
    @Transactional  // deleteByEmpNo 派生删除方法必须有事务，否则报 "No EntityManager with actual transaction"
    public Map<String, Object> saveAgents(@PathVariable String empNo, @RequestBody Map<String, Object> body) {
        Object raw = body.get("agents");
        if (!(raw instanceof List<?> list)) {
            throw new IllegalArgumentException("agents 必须是数组");
        }
        userAgentRepository.deleteByEmpNo(empNo);
        int order = 0;
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> a)) continue;
            String backend = str(a.get("backend"));
            if (backend.isBlank()) continue;
            UserAgentEntity e = new UserAgentEntity();
            e.setEmpNo(empNo);
            e.setBackend(backend);
            e.setExecPath(str(a.get("execPath")));
            e.setArgsTemplate(str(a.get("argsTemplate")));
            e.setWorkDir(str(a.get("workDir")));
            e.setEnvVars(str(a.get("envVars")));
            e.setModel(str(a.get("model")));
            Object tl = a.get("tokenLimit");
            if (tl instanceof Number n) e.setTokenLimit(n.longValue());
            else if (tl != null && !String.valueOf(tl).isBlank()) {
                try { e.setTokenLimit(Long.parseLong(String.valueOf(tl).strip())); }
                catch (NumberFormatException ex) { throw new IllegalArgumentException("tokenLimit 必须是整数"); }
            }
            e.setEnabled(!Boolean.FALSE.equals(a.get("enabled")));
            e.setSortOrder(order++);
            userAgentRepository.save(e);
        }

        Map<String, Object> r = new LinkedHashMap<>();
        r.put("saved", true);
        r.put("count", order);
        r.putAll(pushToBoundClient(empNo, "个人 Coding Agent 配置"));
        return r;
    }

    /**
     * 个人配置保存后立即重推给绑定的客户端。
     * 个人层不写 t_agent_config，只在 ConfigService.buildPush 里叠加；不推的话客户端要等到重连才拿到，
     * 表现为「面板保存成功但客户端还是老配置」。离线时只能等其上线（register 会 buildPush）。
     */
    private Map<String, Object> pushToBoundClient(String empNo, String what) {
        UserEntity u = userRepository.findByEmpNo(empNo);
        String clientId = u == null ? null : u.getClientId();
        boolean online = clientId != null && !clientId.isBlank() && clientRegistry.isOnline(clientId);
        boolean pushed = false;
        if (online) {
            pushed = dispatchService.pushConfig(clientId, configService.buildPush(clientId));
            if (pushed) {
                clientLog.info(clientId, "server",
                        "已重推配置（" + what + "）· " + (u.getName() == null ? empNo : u.getName()));
            }
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("clientId", clientId == null ? "" : clientId);
        m.put("online", online);
        m.put("pushed", pushed);
        return m;
    }

    /* ============================ 探测（经客户端真实执行） ============================ */

    /** Coding Agent 测试：在本机执行 <execPath> --version */
    @PostMapping("/{empNo}/probe/agent")
    public Map<String, Object> probeAgent(@PathVariable String empNo, @RequestBody Map<String, Object> body) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("kind", "agent");
        params.put("backend", str(body.get("backend")));
        params.put("execPath", str(body.get("execPath")));
        params.put("argsTemplate", str(body.get("argsTemplate")));
        params.put("workDir", str(body.get("workDir")));
        params.put("envVars", str(body.get("envVars")));
        return probeService.probe(clientIdOf(empNo, body), params);
    }

    /**
     * Git 测试：本机执行 git --version；填了 repoUrl 再用 Token 实际 ls-remote 该仓库。
     * repoUrl 缺省时由前端取「仓库管理」第一个启用仓库。
     */
    @PostMapping("/{empNo}/probe/git")
    public Map<String, Object> probeGit(@PathVariable String empNo, @RequestBody Map<String, Object> body) {
        UserSettingEntity s = userSettingRepository.findByEmpNo(empNo);
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("kind", "git");
        params.put("repoUrl", str(body.get("repoUrl")));
        // 前端传了新 Token 就测新值（保存前先测试），否则测已保存的
        String inputToken = str(body.get("gitToken"));
        params.put("token", !inputToken.isBlank() ? inputToken
                : (s != null && s.getGitToken() != null ? s.getGitToken() : ""));
        return probeService.probe(clientIdOf(empNo, body), params);
    }

    /** 工具链测试：工作目录存在性 + Maven（mavenHome/bin/mvn --version 或 PATH 中的 mvn） */
    @PostMapping("/{empNo}/probe/toolchain")
    public Map<String, Object> probeToolchain(@PathVariable String empNo, @RequestBody Map<String, Object> body) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("kind", "toolchain");
        params.put("workDir", str(body.get("workDir")));
        params.put("mavenHome", str(body.get("mavenHome")));
        return probeService.probe(clientIdOf(empNo, body), params);
    }

    /** 探测目标客户端：优先请求体里显式指定的，否则用该工号绑定的客户端 */
    private String clientIdOf(String empNo, Map<String, Object> body) {
        String explicit = str(body.get("clientId"));
        if (!explicit.isBlank()) return explicit;
        UserEntity u = userRepository.findByEmpNo(empNo);
        return u == null ? null : u.getClientId();
    }

    /** 掩码：保留前 4 后 2，中间打码；过短则全打码 */
    private static String mask(String token) {
        String t = token.strip();
        if (t.length() <= 8) return "••••••••";
        return t.substring(0, 4) + "••••••" + t.substring(t.length() - 2);
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o).strip();
    }
}
