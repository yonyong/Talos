package com.yonyong.talos.service;

import com.yonyong.talos.entity.IssueEntity;
import com.yonyong.talos.repository.IssueRepository;
import com.yonyong.talos.repository.UserRepository;
import com.yonyong.talos.service.PromptRenderService.RenderResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 准入判定 + 项目分拣：
 * 1) 规则前置（字段完整性、明显重复）
 * 2) 知识库召回
 * 3) LangChain4J 渲染 Prompt → 大模型判定
 * 4) 分拣：匹配项目与仓库地址
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AdmissionService {

    private static final Pattern CONF = Pattern.compile("置信度[:：]\\s*([0-9.]+)");
    private static final String TEMPLATE = "admission_judge.md";

    private final IssueRepository issueRepository;
    private final UserRepository userRepository;
    private final KnowledgeService knowledgeService;
    private final PromptRenderService promptRenderService;
    private final LlmService llmService;
    private final AiLogService aiLogService;
    private final SortService sortService;
    private final AutoStartService autoStartService;

    /** 判定入口 */
    public IssueEntity judge(String issueCode) {
        IssueEntity issue = issueRepository.findByCode(issueCode);
        if (issue == null) throw new IllegalArgumentException("Issue 不存在: " + issueCode);

        // 1) 规则前置
        if (issue.getTitle() == null || issue.getTitle().isBlank() || issue.getDescription() == null || issue.getDescription().isBlank()) {
            finish(issue, "reject", 0.3, "描述不完整，无法评估，请补充现象与期望结果", List.of());
            return issueRepository.save(issue);
        }

        // 2) 知识库召回
        List<KnowledgeService.Hit> hits = knowledgeService.search(issue.getTitle() + " " + issue.getDescription(), 5);
        String hitsText = hits.isEmpty() ? "（无命中）" : hits.stream()
                .map(h -> String.format("- %s（相似度 %.2f）", h.doc().getName(), h.sim()))
                .reduce("", (a, b) -> a + b + "\n");

        // 3) Prompt 渲染 + LLM 判定
        Map<String, Object> vars = new HashMap<>();
        vars.put("issue.code", issue.getCode());
        vars.put("issue.type", issue.getType());
        vars.put("issue.title", issue.getTitle());
        vars.put("issue.desc", issue.getDescription());
        vars.put("issue.priority", issue.getPriority());
        vars.put("kb.hits", hitsText);

        RenderResult rr = promptRenderService.render(TEMPLATE, vars);
        long t = System.currentTimeMillis();
        String out = llmService.chatPublic(rr.text());
        long cost = System.currentTimeMillis() - t;

        aiLogService.record(issue.getCode(), "准入判定", "服务端LLM", llmService.publicModelName(),
                rr.text(), rr.missingVars(), cost, 0L, BigDecimal.ZERO, null);

        // 4) 解析结论
        String result = out != null && out.contains("reject") ? "reject" : "admit";
        Matcher m = CONF.matcher(out == null ? "" : out);
        double confidence = m.find() ? Double.parseDouble(m.group(1)) : 0.8;

        finish(issue, result, confidence, out, hits);

        // 5) 分拣（准入通过才分拣）；分拣成功后按提出人设置自动启动工作流
        boolean resolved = "admit".equals(result) && sort(issue);

        IssueEntity saved = issueRepository.save(issue);
        if (resolved) autoStartService.tryAutoStart(saved.getCode(), "准入通过自动启动");
        return saved;
    }

    /**
     * 项目分拣：由 SortService 查业务域表与仓库表得出，不再使用关键词硬编码。
     * 分拣未定时状态停留在 sorting，由人工在 Issue 详情指定业务域后重新分拣。
     *
     * @return 分拣是否落到明确业务域（resolved）
     */
    private boolean sort(IssueEntity issue) {
        // 人工指定的业务域编码优先作为分拣提示，其次才是自由文本业务名
        String hint = (issue.getBizCode() != null && !issue.getBizCode().isBlank())
                ? issue.getBizCode() : issue.getBiz();
        SortService.Result r = sortService.sort(issue.getCode(), issue.getTitle(), issue.getDescription(), hint);

        issue.setSortMethod(r.method());
        issue.setSortReason(r.reason());
        issue.setCandidateBiz(r.candidates().isEmpty() ? null
                : r.candidates().stream().map(SortService.Candidate::code).reduce((a, b) -> a + "," + b).orElse(null));

        if (r.resolved()) {
            issue.setBizCode(r.bizCode());
            issue.setBiz(r.bizName());
            issue.setProject(r.project());
            issue.setRepoUrl(r.repoUrl());
            issue.setBranch(r.branch());
            issue.setClientId(r.clientId());
            if (issue.getOwner() == null || issue.getOwner().isBlank()) issue.setOwner(r.owner());
        }
        issue.setStatus("sorting");
        return r.resolved();
    }

    /** 人工覆写 */
    public IssueEntity override(String issueCode, String result, String operator) {
        IssueEntity issue = issueRepository.findByCode(issueCode);
        if (issue == null) throw new IllegalArgumentException("Issue 不存在: " + issueCode);
        finish(issue, result, 1.0, "人工覆写（操作人 " + operator + "）", List.of());
        return issueRepository.save(issue);
    }

    private void finish(IssueEntity issue, String result, double confidence, String reason, List<KnowledgeService.Hit> hits) {
        issue.setAdmissionResult(result);
        issue.setConfidence(confidence);
        issue.setAdmissionReason(reason);
        issue.setStatus("admit".equals(result) ? "admitted" : "rejected");
        if (!hits.isEmpty()) {
            issue.setKbHits(hits.stream().map(h -> h.doc().getName() + ":" + String.format("%.2f", h.sim()))
                    .reduce("", (a, b) -> a.isEmpty() ? b : a + "," + b));
        }
    }
}
