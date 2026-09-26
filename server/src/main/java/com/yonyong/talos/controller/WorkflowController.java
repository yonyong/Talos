package com.yonyong.talos.controller;

import com.yonyong.talos.entity.TaskNodeEntity;
import com.yonyong.talos.entity.WorkflowInstance;
import com.yonyong.talos.entity.WorkflowTemplate;
import com.yonyong.talos.repository.TaskNodeRepository;
import com.yonyong.talos.repository.WorkflowInstanceRepository;
import com.yonyong.talos.repository.WorkflowTemplateRepository;
import com.yonyong.talos.service.WorkflowService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/** 工作流模板、实例与节点推进 */
@RestController
@RequestMapping("/api/workflows")
@RequiredArgsConstructor
public class WorkflowController {

    private final WorkflowTemplateRepository templateRepository;
    private final WorkflowInstanceRepository instanceRepository;
    private final TaskNodeRepository nodeRepository;
    private final WorkflowService workflowService;

    @GetMapping("/templates")
    public List<WorkflowTemplate> templates() { return templateRepository.findAll(); }

    @PostMapping("/templates/{code}")
    public ResponseEntity<WorkflowTemplate> saveTemplate(@PathVariable String code, @RequestBody Map<String, Object> body) {
        WorkflowTemplate t = templateRepository.findByCode(code);
        if (t == null) return ResponseEntity.notFound().build();
        Object json = body.get("definitionJson");
        if (json != null) {
            t.setDefinitionJson(String.valueOf(json));
            t.setNodeCount(parseNodeCount(String.valueOf(json)));
        }
        t.setUpdatedAt(java.time.LocalDateTime.now());
        return ResponseEntity.ok(templateRepository.save(t));
    }

    private int parseNodeCount(String json) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().readTree(json).size();
        } catch (Exception e) { return 0; }
    }

    @GetMapping("/instances")
    public List<WorkflowInstance> instances(@RequestParam(required = false) String status) {
        return status == null ? instanceRepository.findAll() : instanceRepository.findByStatus(status);
    }

    @GetMapping("/instances/{code}/nodes")
    public List<TaskNodeEntity> nodes(@PathVariable String code) {
        return nodeRepository.findByInstanceCodeOrderByStepAsc(code);
    }

    /** 客户端回执：推进节点 */
    @PostMapping("/instances/{code}/advance")
    public ResponseEntity<?> advance(@PathVariable String code, @RequestBody Map<String, Object> body) {
        int step = Integer.parseInt(String.valueOf(body.get("step")));
        boolean success = Boolean.parseBoolean(String.valueOf(body.get("success")));
        String log = String.valueOf(body.getOrDefault("log", ""));
        return ResponseEntity.ok(workflowService.advance(code, step, success, log));
    }
}
