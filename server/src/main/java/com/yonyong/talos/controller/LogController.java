package com.yonyong.talos.controller;

import com.yonyong.talos.entity.AiCallLogEntity;
import com.yonyong.talos.repository.AiCallLogRepository;
import com.yonyong.talos.service.WorkflowService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** AI 调用日志：渲染后的 Prompt、模型、用量与耗时 */
@RestController
@RequestMapping("/api/logs")
@RequiredArgsConstructor
public class LogController {

    private final AiCallLogRepository logRepository;
    private final WorkflowService workflowService;

    /**
     * 调用明细。机械节点（拉取 Git 等）不调用模型，其排查痕迹走节点执行日志，
     * 不该出现在这里 —— 旧版客户端上报过的这类记录在展示端过滤掉，库里保留原始行。
     */
    @GetMapping
    public List<AiCallLogEntity> list(@RequestParam(required = false) String issueCode) {
        List<AiCallLogEntity> raw = issueCode == null
                ? logRepository.findTop100ByOrderByCreatedAtDesc()
                : logRepository.findByIssueCode(issueCode);
        return workflowService.filterRealAiCalls(raw);
    }
}
