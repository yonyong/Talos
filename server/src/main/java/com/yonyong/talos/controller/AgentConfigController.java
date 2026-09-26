package com.yonyong.talos.controller;

import com.yonyong.talos.entity.AgentConfigEntity;
import com.yonyong.talos.entity.PromptTemplateEntity;
import com.yonyong.talos.repository.PromptTemplateRepository;
import com.yonyong.talos.service.ConfigService;
import com.yonyong.talos.service.DispatchService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/** Coding Agent 配置：服务端统管，按客户端差异化下发 */
@RestController
@RequestMapping("/api/agents")
@RequiredArgsConstructor
public class AgentConfigController {

    private final ConfigService configService;
    private final PromptTemplateRepository promptTemplateRepository;
    private final DispatchService dispatchService;

    @GetMapping("/config")
    public List<AgentConfigEntity> config(@RequestParam(required = false) String scope) {
        return configService.merged(scope == null ? ConfigService.GLOBAL : scope);
    }

    @PostMapping("/config")
    public ResponseEntity<AgentConfigEntity> save(@RequestBody AgentConfigEntity cfg) {
        return ResponseEntity.ok(configService.save(cfg));
    }

    /** 保存并下发给全部在线客户端 */
    @PostMapping("/config/push-all")
    public ResponseEntity<Map<String, Object>> pushAll() {
        int pushed = 0;
        for (AgentConfigEntity cfg : configService.merged(ConfigService.GLOBAL)) {
            if (dispatchService.pushConfig(cfg.getScope(), configService.buildPush(cfg.getScope()))) pushed++;
        }
        return ResponseEntity.ok(Map.of("pushed", pushed));
    }

    @GetMapping("/prompts")
    public List<PromptTemplateEntity> prompts() { return promptTemplateRepository.findAll(); }

    @PostMapping("/prompts")
    public ResponseEntity<PromptTemplateEntity> savePrompt(@RequestBody PromptTemplateEntity tpl) {
        tpl.setUpdatedAt(java.time.LocalDateTime.now());
        return ResponseEntity.ok(promptTemplateRepository.save(tpl));
    }
}
