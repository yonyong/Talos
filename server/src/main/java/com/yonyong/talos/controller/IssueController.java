package com.yonyong.talos.controller;

import com.yonyong.talos.entity.IssueEntity;
import com.yonyong.talos.repository.IssueRepository;
import com.yonyong.talos.service.AdmissionService;
import com.yonyong.talos.service.WorkflowService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/** Issue 录入与查询：录入后自动触发准入判定 */
@RestController
@RequestMapping("/api/issues")
@RequiredArgsConstructor
public class IssueController {

    private final IssueRepository issueRepository;
    private final AdmissionService admissionService;
    private final WorkflowService workflowService;

    @GetMapping
    public List<IssueEntity> list(@RequestParam(required = false) String status,
                                  @RequestParam(required = false) String type,
                                  @RequestParam(required = false) String owner) {
        if (status != null) return issueRepository.findByStatus(status);
        if (type != null) return issueRepository.findByType(type);
        if (owner != null) return issueRepository.findByOwner(owner);
        return issueRepository.findAll();
    }

    @GetMapping("/{code}")
    public ResponseEntity<IssueEntity> get(@PathVariable String code) {
        IssueEntity e = issueRepository.findByCode(code);
        return e == null ? ResponseEntity.notFound().build() : ResponseEntity.ok(e);
    }

    /** 录入 Issue：必填 业务、诉求类型、标题、描述、期望完成时间、责任人 */
    @PostMapping
    public ResponseEntity<?> create(@RequestBody Map<String, Object> body) {
        IssueEntity e = new IssueEntity();
        e.setCode(String.valueOf(body.getOrDefault("code", nextCode(body.get("type")))));
        e.setTitle(String.valueOf(body.getOrDefault("title", "")));
        e.setBiz(String.valueOf(body.getOrDefault("biz", "")));
        e.setType(String.valueOf(body.getOrDefault("type", "REQ")));
        e.setOwner(String.valueOf(body.getOrDefault("owner", "")));
        e.setReporter(String.valueOf(body.getOrDefault("reporter", e.getOwner())));
        e.setPriority(String.valueOf(body.getOrDefault("priority", "P1")));
        e.setDescription(String.valueOf(body.getOrDefault("description", "")));
        Object due = body.get("dueDate");
        if (due != null && !String.valueOf(due).isBlank()) e.setDueDate(LocalDate.parse(String.valueOf(due)));
        e.setClientId((String) body.get("clientId"));
        IssueEntity saved = issueRepository.save(e);

        // 录入即触发准入判定
        admissionService.judge(saved.getCode());
        return ResponseEntity.ok(issueRepository.findByCode(saved.getCode()));
    }

    /** 准入通过后启动工作流 */
    @PostMapping("/{code}/start")
    public ResponseEntity<?> start(@PathVariable String code) {
        return ResponseEntity.ok(workflowService.start(code));
    }

    private String nextCode(Object type) {
        String prefix = "REQ".equals(String.valueOf(type)) ? "REQ" : "BUG";
        return prefix + "-" + (2100 + (int) (Math.random() * 800));
    }
}
