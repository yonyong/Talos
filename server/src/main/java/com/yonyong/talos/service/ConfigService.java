package com.yonyong.talos.service;

import com.yonyong.talos.entity.AgentConfigEntity;
import com.yonyong.talos.entity.PromptTemplateEntity;
import com.yonyong.talos.entity.UserAgentEntity;
import com.yonyong.talos.entity.UserEntity;
import com.yonyong.talos.entity.UserSettingEntity;
import com.yonyong.talos.repository.AgentConfigRepository;
import com.yonyong.talos.repository.PromptTemplateRepository;
import com.yonyong.talos.repository.UserAgentRepository;
import com.yonyong.talos.repository.UserRepository;
import com.yonyong.talos.repository.UserSettingRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 配置下发：每个用户（设置面板）各自配置自己的 Coding Agent，服务端采集后按客户端汇总下发。
 *
 * 历史版本曾维护一张 agent_config 表（GLOBAL 默认 + 客户端覆盖），但"全局默认"会让管理页
 * 在每个客户端作用域都显示一堆用户并未配置的后端，与"按用户配置"的初衷脱节。现该表已废弃，
 * 下发只由绑定用户的 user_agent（个人层）驱动；Git 凭据与工具链同样来自该用户的个人设置。
 */
@Service
@RequiredArgsConstructor
public class ConfigService {

    public static final String GLOBAL = "GLOBAL";

    private final AgentConfigRepository agentConfigRepository;
    private final PromptTemplateRepository promptTemplateRepository;
    private final UserRepository userRepository;
    private final UserSettingRepository userSettingRepository;
    private final UserAgentRepository userAgentRepository;

    /** 合并后的 Agent 配置（供下发与页面展示） */
    public List<AgentConfigEntity> merged(String clientId) {
        Map<String, AgentConfigEntity> map = new LinkedHashMap<>();
        agentConfigRepository.findByScope(GLOBAL).forEach(c -> map.put(c.getBackend(), c));
        if (clientId != null && !GLOBAL.equals(clientId)) {
            agentConfigRepository.findByScope(clientId).forEach(c -> map.put(c.getBackend(), c));
        }
        return new ArrayList<>(map.values());
    }

    /** 生成下发报文 */
    public Map<String, Object> buildPush(String clientId) {
        UserSettingEntity personal = personalSettingOf(clientId);
        List<UserAgentEntity> personalAgents = personalAgentsOf(clientId);

        Map<String, Object> push = new LinkedHashMap<>();
        push.put("scope", clientId == null ? GLOBAL : clientId);

        // 下发完全由绑定用户的个人配置（user_agent）驱动：每个启用的条目即一个后端，
        // 列表顺序即优先级（personalOrder），供客户端 pickBackend 按序取用第一个可用的。
        // 服务端不再预设任何默认后端，也没有"全局/客户端覆盖"层。
        Map<String, Map<String, Object>> byBackend = new LinkedHashMap<>();
        List<String> personalOrder = new ArrayList<>();
        for (UserAgentEntity ua : personalAgents) {
            if (Boolean.FALSE.equals(ua.getEnabled())) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("backend", ua.getBackend());
            m.put("enabled", true);
            m.put("transport", "cli"); // 个人层仅支持本地 CLI，不暴露内网 SDK 形态
            if (notBlank(ua.getExecPath())) m.put("execPath", ua.getExecPath());
            if (notBlank(ua.getArgsTemplate())) m.put("argsTemplate", ua.getArgsTemplate());
            if (notBlank(ua.getWorkDir())) m.put("workDir", ua.getWorkDir());
            if (notBlank(ua.getEnvVars())) m.put("envVars", ua.getEnvVars());
            if (notBlank(ua.getModel())) m.put("model", ua.getModel());
            if (ua.getTokenLimit() != null) m.put("tokenLimit", ua.getTokenLimit());
            m.put("privateOnly", false);
            byBackend.put(ua.getBackend(), m);
            personalOrder.add(ua.getBackend());
        }
        push.put("agents", new ArrayList<>(byBackend.values()));
        if (!personalOrder.isEmpty()) push.put("personalOrder", personalOrder);

        // 工具链：工作目录覆盖客户端 workspace；Maven 目录由客户端前置到 CLI 的 PATH
        if (personal != null) {
            Map<String, Object> toolchain = new LinkedHashMap<>();
            if (notBlank(personal.getWorkDir())) toolchain.put("workDir", personal.getWorkDir());
            if (notBlank(personal.getMavenHome())) toolchain.put("mavenHome", personal.getMavenHome());
            if (!toolchain.isEmpty()) push.put("toolchain", toolchain);
        }
        // Git 凭据：客户端 clone/fetch/push 时拼入 https 鉴权，并写入仓库级 git identity
        if (personal != null) {
            Map<String, Object> git = new LinkedHashMap<>();
            if (notBlank(personal.getGitToken())) git.put("token", personal.getGitToken());
            if (notBlank(personal.getGitUserName())) git.put("user", personal.getGitUserName());
            if (notBlank(personal.getGitUserEmail())) git.put("email", personal.getGitUserEmail());
            if (!git.isEmpty()) push.put("git", git);
        }

        List<PromptTemplateEntity> tpls = promptTemplateRepository.findAll();
        push.put("prompts", tpls.stream().map(t -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", t.getName());
            m.put("scene", t.getScene());
            m.put("backend", t.getBackend());
            m.put("variables", t.getVariables());
            m.put("content", t.getContent());
            return m;
        }).collect(Collectors.toList()));
        return push;
    }

    /**
     * 保存：按 id 或 scope + backend 定位既有记录，只覆盖「非空」字段。
     * 前端漏传的字段（额度、用量）不会被清空，也不会因缺 id 产生重复行。
     */
    public AgentConfigEntity save(AgentConfigEntity in) {
        AgentConfigEntity target = null;
        if (in.getId() != null) {
            target = agentConfigRepository.findById(in.getId()).orElse(null);
        }
        if (target == null && in.getScope() != null && in.getBackend() != null) {
            target = agentConfigRepository.findByScope(in.getScope()).stream()
                    .filter(c -> Objects.equals(c.getBackend(), in.getBackend()))
                    .findFirst().orElse(null);
        }
        if (target == null) target = new AgentConfigEntity();

        if (in.getScope() != null) target.setScope(in.getScope());
        if (in.getBackend() != null) target.setBackend(in.getBackend());
        if (in.getModel() != null) target.setModel(in.getModel());
        if (in.getEnabled() != null) target.setEnabled(in.getEnabled());
        if (in.getTransport() != null) target.setTransport(in.getTransport());
        if (in.getExecPath() != null) target.setExecPath(in.getExecPath());
        if (in.getArgsTemplate() != null) target.setArgsTemplate(in.getArgsTemplate());
        if (in.getWorkDir() != null) target.setWorkDir(in.getWorkDir());
        if (in.getEnvVars() != null) target.setEnvVars(in.getEnvVars());
        if (in.getMinVersion() != null) target.setMinVersion(in.getMinVersion());
        if (in.getTokenLimit() != null) target.setTokenLimit(in.getTokenLimit());
        if (in.getMonthlyQuota() != null) target.setMonthlyQuota(in.getMonthlyQuota());
        if (in.getUsagePercent() != null) target.setUsagePercent(in.getUsagePercent());
        if (in.getPrivateOnly() != null) target.setPrivateOnly(in.getPrivateOnly());
        target.setUpdatedAt(java.time.LocalDateTime.now());
        return agentConfigRepository.save(target);
    }

    /** 该客户端绑定用户的个人设置：多用户共用一机时取第一个绑定者 */
    private UserSettingEntity personalSettingOf(String clientId) {
        if (clientId == null || GLOBAL.equals(clientId)) return null;
        return userRepository.findByClientId(clientId).stream()
                .map(UserEntity::getId)
                .filter(Objects::nonNull)
                .map(userSettingRepository::findByUserId)
                .filter(Objects::nonNull)
                .findFirst().orElse(null);
    }

    /** 绑定用户的个人 Agent 多条配置（已按优先级排序）；无绑定或无配置时为空 */
    private List<UserAgentEntity> personalAgentsOf(String clientId) {
        if (clientId == null || GLOBAL.equals(clientId)) return List.of();
        return userRepository.findByClientId(clientId).stream()
                .map(UserEntity::getId)
                .filter(Objects::nonNull)
                .findFirst()
                .map(userAgentRepository::findByUserIdOrderBySortOrderAscIdAsc)
                .orElse(List.of());
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }
}
