package com.yonyong.talos.controller;

import com.yonyong.talos.entity.AgentConfigEntity;
import com.yonyong.talos.entity.PromptTemplateEntity;
import com.yonyong.talos.entity.UserAgentEntity;
import com.yonyong.talos.entity.UserEntity;
import com.yonyong.talos.entity.WorkflowTemplate;
import com.yonyong.talos.repository.PromptTemplateRepository;
import com.yonyong.talos.repository.UserAgentRepository;
import com.yonyong.talos.repository.UserRepository;
import com.yonyong.talos.repository.WorkflowTemplateRepository;
import com.yonyong.talos.service.ClientRegistry;
import com.yonyong.talos.service.ConfigService;
import com.yonyong.talos.service.DispatchService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Coding Agent 配置：按用户采集，统一汇总与下发（服务端不再预设默认后端） */
@RestController
@RequestMapping("/api/agents")
@RequiredArgsConstructor
public class AgentConfigController {

    private final ConfigService configService;
    private final PromptTemplateRepository promptTemplateRepository;
    private final WorkflowTemplateRepository workflowTemplateRepository;
    private final DispatchService dispatchService;
    private final ClientRegistry clientRegistry;
    private final UserRepository userRepository;
    private final UserAgentRepository userAgentRepository;

    @GetMapping("/config")
    public List<AgentConfigEntity> config(@RequestParam(required = false) String scope) {
        return configService.merged(scope == null ? ConfigService.GLOBAL : scope);
    }

    @PostMapping("/config")
    public ResponseEntity<AgentConfigEntity> save(@RequestBody AgentConfigEntity cfg) {
        return ResponseEntity.ok(configService.save(cfg));
    }

    /** 保存并下发给全部在线客户端：逐个客户端下发"GLOBAL 默认 + 本机覆盖"合并后的配置 */
    @PostMapping("/config/push-all")
    public ResponseEntity<Map<String, Object>> pushAll() {
        int pushed = 0;
        for (String clientId : clientRegistry.onlineClientIds()) {
            if (dispatchService.pushConfig(clientId, configService.buildPush(clientId))) pushed++;
        }
        return ResponseEntity.ok(Map.of("pushed", pushed));
    }

    /**
     * 按用户采集的 Coding Agent 配置汇总：管理端「Coding Agent 配置」页统一查看与下发用。
     * 每个用户的后端由其本人在「设置面板」配置（user_agent），服务端不预设、不强制任何默认后端。
     */
    @GetMapping("/users")
    public List<Map<String, Object>> users() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (UserEntity u : userRepository.findAll()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", u.getId());
            m.put("email", u.getEmail() == null ? "" : u.getEmail());
            m.put("name", u.getName());
            m.put("clientId", u.getClientId());
            boolean online = u.getClientId() != null && !u.getClientId().isBlank()
                    && clientRegistry.isOnline(u.getClientId());
            m.put("online", online);
            List<Map<String, Object>> agents = new ArrayList<>();
            if (u.getId() != null) {
                for (UserAgentEntity a : userAgentRepository.findByUserIdOrderBySortOrderAscIdAsc(u.getId())) {
                    Map<String, Object> am = new LinkedHashMap<>();
                    am.put("backend", a.getBackend());
                    am.put("execPath", a.getExecPath());
                    am.put("model", a.getModel());
                    am.put("enabled", !Boolean.FALSE.equals(a.getEnabled()));
                    agents.add(am);
                }
            }
            m.put("agents", agents);
            out.add(m);
        }
        return out;
    }

    @GetMapping("/prompts")
    public List<PromptTemplateEntity> prompts() { return promptTemplateRepository.findAll(); }

    @PostMapping("/prompts")
    public ResponseEntity<PromptTemplateEntity> savePrompt(@RequestBody PromptTemplateEntity tpl) {
        tpl.setUpdatedAt(java.time.LocalDateTime.now());
        return ResponseEntity.ok(promptTemplateRepository.save(tpl));
    }

    /**
     * 删除 Prompt 模板。
     * 仍被工作流节点 definitionJson 引用时拒绝 —— 否则实例推进到该节点会渲染出空模板，
     * 表现为「节点莫名失败」，比直接拒绝更难排查。
     */
    @DeleteMapping("/prompts/{id}")
    public ResponseEntity<Object> deletePrompt(@PathVariable Long id) {
        PromptTemplateEntity tpl = promptTemplateRepository.findById(id).orElse(null);
        if (tpl == null) return ResponseEntity.notFound().build();

        List<String> referencedBy = new java.util.ArrayList<>();
        for (WorkflowTemplate wt : workflowTemplateRepository.findAll()) {
            String json = wt.getDefinitionJson();
            if (json != null && !json.isBlank() && json.contains(tpl.getName())) {
                referencedBy.add(wt.getCode());
            }
        }
        if (!referencedBy.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("message",
                    "模板 " + tpl.getName() + " 仍被工作流 " + String.join("、", referencedBy)
                            + " 的节点引用，请先在工作流编排中改掉节点再删除"));
        }
        promptTemplateRepository.delete(tpl);
        return ResponseEntity.ok(Map.of("deleted", true));
    }
}
