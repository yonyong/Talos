package com.yonyong.talos.controller;

import com.yonyong.talos.entity.DocEntity;
import com.yonyong.talos.entity.IssueEntity;
import com.yonyong.talos.entity.WorkflowInstance;
import com.yonyong.talos.repository.DocRepository;
import com.yonyong.talos.repository.IssueRepository;
import com.yonyong.talos.repository.TaskNodeRepository;
import com.yonyong.talos.service.AdmissionService;
import com.yonyong.talos.service.WorkflowService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Issue 录入、查询与生命周期动作（启动 / 改派 / 关闭） */
@RestController
@RequestMapping("/api/issues")
@RequiredArgsConstructor
public class IssueController {

    private final IssueRepository issueRepository;
    private final AdmissionService admissionService;
    private final WorkflowService workflowService;
    private final TaskNodeRepository nodeRepository;
    private final DocRepository docRepository;

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

    /** 详情聚合：Issue + 最近一次实例 + 节点进度，详情页一次拉齐，避免 Issue 与监控页各自为战 */
    @GetMapping("/{code}/detail")
    public ResponseEntity<?> detail(@PathVariable String code) {
        IssueEntity e = issueRepository.findByCode(code);
        if (e == null) return ResponseEntity.status(404).body(Map.of("message", "Issue 不存在: " + code));

        WorkflowInstance inst = workflowService.latestInstance(code);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("issue", e);
        out.put("instance", inst);
        out.put("nodes", inst == null || inst.getInstanceCode() == null
                ? List.of()
                : nodeRepository.findByInstanceCodeOrderByStepAsc(inst.getInstanceCode()));
        // 文档：提出人上传的原始材料 + 工作流产出的过程文档（不含正文，按需走 /api/docs/{id}/raw）
        out.put("docs", docRepository.findByIssueCode(code).stream().map(IssueController::docView).toList());
        return ResponseEntity.ok(out);
    }

    /** 录入 Issue：必填 业务、诉求类型、标题、描述、期望完成时间、责任人 */
    @PostMapping
    public ResponseEntity<?> create(@RequestBody Map<String, Object> body) {
        IssueEntity e = new IssueEntity();
        e.setCode(String.valueOf(body.getOrDefault("code", nextCode(body.get("type")))));
        e.setTitle(String.valueOf(body.getOrDefault("title", "")));
        e.setBiz(String.valueOf(body.getOrDefault("biz", "")));
        Object bizCode = body.get("bizCode");
        if (bizCode != null && !String.valueOf(bizCode).isBlank()) e.setBizCode(String.valueOf(bizCode));
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

    /** 准入通过且已分拣到仓库后启动工作流 */
    @PostMapping("/{code}/start")
    public ResponseEntity<?> start(@PathVariable String code) {
        WorkflowInstance inst = workflowService.start(code);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("started", true);
        out.put("instanceCode", inst.getInstanceCode());
        out.put("status", inst.getStatus());
        out.put("currentStep", inst.getCurrentStep());
        out.put("totalSteps", inst.getTotalSteps());
        return ResponseEntity.ok(out);
    }

    /** 改派责任人：只影响后续下发，已在执行的实例保持原执行客户端 */
    @PostMapping("/{code}/reassign")
    public ResponseEntity<?> reassign(@PathVariable String code, @RequestBody(required = false) Map<String, Object> body) {
        String owner = body == null ? "" : String.valueOf(body.getOrDefault("owner", "")).trim();
        if (owner.isEmpty() || "null".equals(owner)) {
            return ResponseEntity.badRequest().body(Map.of("message", "责任人不能为空"));
        }
        IssueEntity e = issueRepository.findByCode(code);
        if (e == null) return ResponseEntity.status(404).body(Map.of("message", "Issue 不存在: " + code));

        String from = e.getOwner() == null ? "" : e.getOwner();
        if (owner.equals(from)) {
            return ResponseEntity.badRequest().body(Map.of("message", "责任人未变更（当前已是 " + owner + "）"));
        }
        e.setOwner(owner);
        issueRepository.save(e);

        WorkflowInstance running = workflowService.latestRunning(code);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("saved", true);
        out.put("code", code);
        out.put("from", from);
        out.put("owner", owner);
        out.put("hint", running == null
                ? "已改派，后续启动的实例将按新责任人下发"
                : "已改派；当前实例 " + running.getInstanceCode() + " 正在执行，执行客户端不会自动切换，如需切换请先取消实例");
        return ResponseEntity.ok(out);
    }

    /** 关闭 Issue：同步取消未完成的实例，未执行节点标记为 skipped */
    @PostMapping("/{code}/close")
    public ResponseEntity<?> close(@PathVariable String code, @RequestBody(required = false) Map<String, Object> body) {
        String reason = body == null ? "" : String.valueOf(body.getOrDefault("reason", "")).trim();
        IssueEntity e = issueRepository.findByCode(code);
        if (e == null) return ResponseEntity.status(404).body(Map.of("message", "Issue 不存在: " + code));
        if ("done".equals(e.getStatus())) {
            return ResponseEntity.badRequest().body(Map.of("message", "Issue 已验收通过，无需关闭"));
        }
        if ("closed".equals(e.getStatus())) {
            return ResponseEntity.badRequest().body(Map.of("message", "Issue 已处于关闭状态"));
        }

        String cancelled = null;
        WorkflowInstance running = workflowService.latestRunning(code);
        if (running != null && running.getInstanceCode() != null) {
            workflowService.cancel(running.getInstanceCode(), reason.isEmpty() ? "Issue 被人工关闭" : reason);
            cancelled = running.getInstanceCode();
        }
        e.setStatus("closed");
        e.setCloseReason(reason.isEmpty() ? "人工关闭" : reason);
        issueRepository.save(e);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("closed", true);
        out.put("code", code);
        out.put("cancelledInstance", cancelled);
        return ResponseEntity.ok(out);
    }

/** 生命周期终态之外的在途状态：处于这些状态时不需要（也不允许）重新处理 */
    private static final List<String> IN_FLIGHT =
            List.of("admitting", "admitted", "sorting", "running", "blocked", "reviewing");

    /**
     * 重新处理：被驳回 / 已关闭的 Issue 回到准入环节重判。
     * 可一并提交新的描述（通常是补充了现象与期望结果后重试），重判通过则继续走分拣。
     */
    @PostMapping("/{code}/reopen")
    public ResponseEntity<?> reopen(@PathVariable String code, @RequestBody(required = false) Map<String, Object> body) {
        IssueEntity e = issueRepository.findByCode(code);
        if (e == null) return ResponseEntity.status(404).body(Map.of("message", "Issue 不存在: " + code));

        String from = e.getStatus() == null ? "" : e.getStatus();
        if (IN_FLIGHT.contains(from)) {
            return ResponseEntity.status(409).body(Map.of("message", "该 Issue 正在流程中（" + from + "），无需重新处理"));
        }
        if ("done".equals(from)) {
            return ResponseEntity.badRequest().body(Map.of("message", "Issue 已验收通过，不支持重新处理"));
        }

        // 补充描述：以重新处理时提交的内容为准
        Object d = body == null ? null : body.get("description");
        if (d != null) {
            String desc = String.valueOf(d).trim();
            if (!desc.isEmpty()) e.setDescription(desc);
        }

        // 清掉上一次的结论痕迹，回到准入中再判一次
        e.setStatus("admitting");
        e.setAdmissionResult(null);
        e.setConfidence(null);
        e.setAdmissionReason(null);
        e.setCloseReason(null);
        e.setSortMethod(null);
        e.setSortReason(null);
        e.setCandidateBiz(null);
        e.setProject(null);
        e.setRepoUrl(null);
        e.setBranch(null);
        issueRepository.save(e);

        admissionService.judge(code);
        IssueEntity fresh = issueRepository.findByCode(code);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("reopened", true);
        out.put("code", code);
        out.put("from", from);
        out.put("status", fresh.getStatus());
        out.put("admissionResult", fresh.getAdmissionResult());
        out.put("hint", "admit".equals(fresh.getAdmissionResult())
                ? "已重新准入并完成分拣，可在详情中启动工作流"
                : "重新判定仍未通过，可补充描述后再试，或在准入判定页人工覆写为准入");
        return ResponseEntity.ok(out);
    }

    /** 文档轻量视图：与 /api/docs 的视图保持一致，但不带正文 */
    private static Map<String, Object> docView(DocEntity d) {
        Map<String, Object> m = new LinkedHashMap<>();
        String cat = d.getCategory() == null || d.getCategory().isBlank() ? "PROCESS" : d.getCategory().trim().toUpperCase();
        m.put("id", d.getId());
        m.put("issueCode", d.getIssueCode());
        m.put("name", d.getName());
        m.put("kind", d.getKind());
        m.put("category", cat);
        m.put("source", d.getSource());
        m.put("sizeText", d.getSizeText());
        m.put("sizeBytes", d.getSizeBytes());
        m.put("mimeType", d.getMimeType());
        m.put("uploader", d.getUploader());
        m.put("clientId", d.getClientId());
        m.put("hasFile", d.getStoredPath() != null && !d.getStoredPath().isBlank());
        m.put("hasText", d.getContent() != null && !d.getContent().isBlank());
        m.put("createdAt", d.getCreatedAt() == null ? null : d.getCreatedAt().toString());
        return m;
    }

    private String nextCode(Object type) {
        String prefix = "REQ".equals(String.valueOf(type)) ? "REQ" : "BUG";
        return prefix + "-" + (2100 + (int) (Math.random() * 800));
    }
}
