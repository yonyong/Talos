package com.yonyong.talos.controller;

import com.yonyong.talos.entity.AiCallLogEntity;
import com.yonyong.talos.repository.AiCallLogRepository;
import com.yonyong.talos.service.WorkflowService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/** AI 调用日志：渲染后的 Prompt、模型、用量与耗时 */
@RestController
@RequestMapping("/api/logs")
@RequiredArgsConstructor
public class LogController {

    private final AiCallLogRepository logRepository;
    private final WorkflowService workflowService;

    /**
     * 调用明细（服务端分页 + 关键字过滤）。
     *
     * <p>机械节点（拉取 Git 等）不调用模型，其排查痕迹走节点执行日志，
     * 不该出现在这里 —— 旧版客户端上报过的这类记录在展示端过滤掉，库里保留原始行。
     *
     * <p>分页在内存里做线性扫描，对调用日志这类体量（千级行）足够；若日后涨到十万级，
     * 把 {@code findByOrderByCreatedAtDesc} 换成带 {@code LIKE} 的 DB 查询即可，接口契约不变。
     */
    @GetMapping
    public Map<String, Object> list(
            @RequestParam(required = false) String issueCode,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int size) {
        int p = Math.max(1, page);
        int s = Math.max(1, Math.min(size, 200)); // 上限防滥用

        List<AiCallLogEntity> all = issueCode == null
                ? logRepository.findByOrderByCreatedAtDesc()
                : logRepository.findByIssueCode(issueCode);
        // 剔除机械节点（拉取 Git 等）留下的假调用记录，只留真正调模型的行
        all = workflowService.filterRealAiCalls(all);

        if (q != null && !q.isBlank()) {
            String kw = q.toLowerCase();
            all = all.stream().filter(l -> matches(l, kw)).collect(Collectors.toList());
        }

        int total = all.size();
        int totalPages = Math.max(1, (int) Math.ceil((double) total / s));
        int from = Math.min((p - 1) * s, Math.max(0, total - 1));
        int to = Math.min(from + s, total);
        List<AiCallLogEntity> content = from < to ? all.subList(from, to) : List.of();

        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("content", content);
        out.put("page", p);
        out.put("size", s);
        out.put("total", total);
        out.put("totalPages", totalPages);
        return out;
    }

    /** 关键字命中 Issue / 节点 / 后端 / 模型 任一字段即保留 */
    private boolean matches(AiCallLogEntity l, String kw) {
        return Stream.of(l.getIssueCode(), l.getNode(), l.getBackend(), l.getModel())
                .anyMatch(v -> v != null && v.toLowerCase().contains(kw));
    }
}
