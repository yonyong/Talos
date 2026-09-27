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

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 工作流模板（DAG 图定义）、实例与节点推进 */
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

    /**
     * 解析后的模板图（含旧数组格式的自动升级结果），
     * 前端拿它渲染 DAG，不必自己兼容历史格式。
     */
    @GetMapping("/templates/{code}/graph")
    public ResponseEntity<?> templateGraph(@PathVariable String code) {
        WorkflowTemplate t = templateRepository.findByCode(code);
        if (t == null) return ResponseEntity.notFound().build();
        WorkflowService.GraphDef g = workflowService.templateGraphOf(t);
        return ResponseEntity.ok(Map.of(
                "code", t.getCode(),
                "name", t.getName() == null ? t.getCode() : t.getName(),
                "nodes", g.nodes(),
                "edges", g.edges()));
    }

    /** 保存图定义：definitionJson 接受 {nodes, edges} 对象，也兼容旧的节点数组 */
    @PostMapping("/templates/{code}")
    public ResponseEntity<?> saveTemplate(@PathVariable String code, @RequestBody Map<String, Object> body) {
        WorkflowTemplate t = templateRepository.findByCode(code);
        if (t == null) return ResponseEntity.notFound().build();
        Object json = body.get("definitionJson");
        if (json != null) {
            String text = String.valueOf(json);
            // 先解析校验，避免把非法图（悬空连线、自环）存进库
            WorkflowService.GraphDef g = workflowService.parseGraph(text);
            t.setDefinitionJson(workflowService.serializeGraph(g));
            t.setNodeCount(g.nodes().size());
        }
        t.setUpdatedAt(java.time.LocalDateTime.now());
        return ResponseEntity.ok(templateRepository.save(t));
    }

    @GetMapping("/instances")
    public List<WorkflowInstance> instances(@RequestParam(required = false) String status) {
        return status == null ? instanceRepository.findAll() : instanceRepository.findByStatus(status);
    }

    @GetMapping("/instances/{code}/nodes")
    public List<TaskNodeEntity> nodes(@PathVariable String code) {
        return nodeRepository.findByInstanceCodeOrderByStepAsc(code);
    }

    /** 实例图 + 节点实时状态，供监控页渲染带状态的 DAG */
    @GetMapping("/instances/{code}/graph")
    public ResponseEntity<?> instanceGraph(@PathVariable String code) {
        return ResponseEntity.ok(workflowService.instanceGraph(code));
    }

    /** issue → 最新实例图（监控页深链可直接用 issueCode 定位） */
    @GetMapping("/instances/by-issue/{issueCode}/graph")
    public ResponseEntity<?> instanceGraphByIssue(@PathVariable String issueCode) {
        WorkflowInstance inst = workflowService.latestInstance(issueCode);
        if (inst == null) {
            Map<String, Object> empty = new LinkedHashMap<>();
            empty.put("instanceCode", null);
            empty.put("issueCode", issueCode);
            empty.put("status", "none");
            empty.put("nodes", List.of());
            empty.put("edges", List.of());
            return ResponseEntity.ok(empty);
        }
        return ResponseEntity.ok(workflowService.instanceGraph(inst.getInstanceCode()));
    }

    /**
     * 客户端 / 人工回执：推进节点。
     * step 可省略（或用 0 表示自动）——图结构下可能有多个节点同时在执行，
     * 省略时由引擎挑选当前可推进的节点，人工回执不必猜步骤号。
     */
    @PostMapping("/instances/{code}/advance")
    public ResponseEntity<?> advance(@PathVariable String code, @RequestBody Map<String, Object> body) {
        Integer step = parseStep(body.get("step"));
        boolean success = Boolean.parseBoolean(String.valueOf(body.getOrDefault("success", "true")));
        String log = String.valueOf(body.getOrDefault("log", ""));
        return ResponseEntity.ok(workflowService.advance(code, step, success, log));
    }

    private Integer parseStep(Object raw) {
        if (raw == null) return null;
        String s = String.valueOf(raw).trim();
        if (s.isEmpty() || "null".equals(s) || "undefined".equals(s)) return null;
        try {
            int v = Integer.parseInt(s);
            return v <= 0 ? null : v;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** 人工取消实例：未执行节点标记 skipped */
    @PostMapping("/instances/{code}/cancel")
    public ResponseEntity<?> cancel(@PathVariable String code, @RequestBody(required = false) Map<String, Object> body) {
        String reason = body == null ? "" : String.valueOf(body.getOrDefault("reason", ""));
        WorkflowInstance inst = workflowService.cancel(code, reason);
        return ResponseEntity.ok(Map.of(
                "instanceCode", String.valueOf(inst.getInstanceCode()),
                "status", String.valueOf(inst.getStatus())));
    }

    /**
     * 重新执行：step 省略（或 0）= 整图重跑；传 step = 从该节点（含下游）重跑，上游结果保留。
     * 范围内有正在客户端执行的节点时返回 409。
     */
    @PostMapping("/instances/{code}/rerun")
    public ResponseEntity<?> rerun(@PathVariable String code, @RequestBody(required = false) Map<String, Object> body) {
        Integer step = parseStep(body == null ? null : body.get("step"));
        String reason = body == null ? "" : String.valueOf(body.getOrDefault("reason", ""));
        WorkflowInstance inst = workflowService.rerun(code, step, reason);
        return ResponseEntity.ok(Map.of(
                "instanceCode", String.valueOf(inst.getInstanceCode()),
                "status", String.valueOf(inst.getStatus())));
    }
}
