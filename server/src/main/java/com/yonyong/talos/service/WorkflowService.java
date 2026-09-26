package com.yonyong.talos.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yonyong.talos.entity.*;
import com.yonyong.talos.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.*;

/**
 * 工作流编排：模板 → 实例 → 节点推进。
 * 关键决策（是否放行下一节点）由 LangChain4J 渲染 Prompt 后交大模型判断，
 * 判定过程与渲染后的 Prompt 全部落 AI 调用日志。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class WorkflowService {

    private final IssueRepository issueRepository;
    private final WorkflowTemplateRepository templateRepository;
    private final WorkflowInstanceRepository instanceRepository;
    private final TaskNodeRepository nodeRepository;
    private final DispatchService dispatchService;
    private final PromptRenderService promptRenderService;
    private final LlmService llmService;
    private final AiLogService aiLogService;

    private final ObjectMapper om = new ObjectMapper();

    /** 启动工作流：准入通过后才可执行 */
    public WorkflowInstance start(String issueCode) {
        IssueEntity issue = issueRepository.findByCode(issueCode);
        if (issue == null) throw new IllegalArgumentException("Issue 不存在: " + issueCode);
        if (!"admit".equals(issue.getAdmissionResult())) {
            throw new IllegalStateException("Issue 未通过准入，不能启动工作流: " + issueCode);
        }
        WorkflowTemplate tpl = templateRepository.findByCode(issue.getType());
        if (tpl == null) throw new IllegalStateException("未找到工作流模板: " + issue.getType());

        List<NodeDef> defs;
        try {
            defs = om.readValue(tpl.getDefinitionJson(), new TypeReference<>() {});
        } catch (Exception e) {
            throw new IllegalStateException("模板解析失败", e);
        }

        WorkflowInstance inst = new WorkflowInstance();
        inst.setInstanceCode("WI-" + (1000 + (int) (Math.random() * 9000)));
        inst.setIssueCode(issueCode);
        inst.setTemplateCode(tpl.getCode());
        inst.setCurrentStep(1);
        inst.setTotalSteps(defs.size());
        inst.setStatus("running");
        inst.setClientId(issue.getClientId());
        instanceRepository.save(inst);

        List<TaskNodeEntity> nodes = new ArrayList<>();
        for (NodeDef d : defs) {
            TaskNodeEntity n = new TaskNodeEntity();
            n.setInstanceCode(inst.getInstanceCode());
            n.setStep(d.step());
            n.setName(d.name());
            n.setKind(d.kind());
            n.setExecLocation(d.execLocation());
            n.setBackend(d.backend());
            n.setPromptTemplate(d.promptTemplate());
            n.setGate(d.gate());
            n.setStatus("waiting");
            nodes.add(nodeRepository.save(n));
        }

        issue.setStatus("running");
        issueRepository.save(issue);

        pushNext(nodes.get(0), issue, inst.getClientId());
        return inst;
    }

    /** 节点回执推进：success 表示节点执行成功 */
    public WorkflowInstance advance(String instanceCode, int step, boolean success, String logText) {
        WorkflowInstance inst = instanceRepository.findByInstanceCode(instanceCode);
        if (inst == null) throw new IllegalArgumentException("实例不存在: " + instanceCode);

        List<TaskNodeEntity> nodes = nodeRepository.findByInstanceCodeOrderByStepAsc(instanceCode);
        TaskNodeEntity cur = nodes.stream().filter(n -> n.getStep() == step).findFirst().orElseThrow();
        cur.setStatus(success ? "success" : "failed");
        cur.setFinishedAt(LocalDateTime.now());
        cur.setExecLog(logText);
        nodeRepository.save(cur);

        IssueEntity issue = issueRepository.findByCode(inst.getIssueCode());

        if (!success) {
            inst.setStatus("blocked");
            instanceRepository.save(inst);
            issue.setStatus("blocked");
            issueRepository.save(issue);
            return inst;
        }

        // 有闸门的节点：用 LangChain4J 判断是否放行
        if (hasGate(cur)) {
            boolean pass = gateDecision(cur, issue);
            if (!pass) {
                inst.setStatus("blocked");
                instanceRepository.save(inst);
                issue.setStatus("reviewing");
                issueRepository.save(issue);
                return inst;
            }
        }

        TaskNodeEntity next = nodes.stream().filter(n -> n.getStep() == step + 1).findFirst().orElse(null);
        if (next == null) {
            inst.setStatus("done");
            inst.setCurrentStep(inst.getTotalSteps());
            instanceRepository.save(inst);
            issue.setStatus("done");
            issueRepository.save(issue);
            return inst;
        }

        inst.setCurrentStep(next.getStep());
        instanceRepository.save(inst);
        pushNext(next, issue, inst.getClientId());
        return inst;
    }

    /** 推送下一节点：客户端节点下发，服务端节点直接等待人工处理 */
    private void pushNext(TaskNodeEntity node, IssueEntity issue, String clientId) {
        if ("客户端".equals(node.getExecLocation())) {
            node.setStartedAt(LocalDateTime.now());
            boolean sent = dispatchService.dispatch(node, issue, clientId);
            node.setStatus(sent ? "dispatched" : "waiting");
        } else {
            node.setStatus("waiting");
        }
        nodeRepository.save(node);
    }

    private boolean hasGate(TaskNodeEntity n) {
        return n.getGate() != null && !n.getGate().isBlank() && !"—".equals(n.getGate());
    }

    /** 闸门决策：评审 / 测试门禁是否放行 */
    private boolean gateDecision(TaskNodeEntity node, IssueEntity issue) {
        Map<String, Object> vars = new HashMap<>();
        vars.put("issue.code", issue.getCode());
        vars.put("issue.title", issue.getTitle());
        vars.put("node.name", node.getName());
        vars.put("node.gate", node.getGate());
        vars.put("node.log", node.getExecLog() == null ? "" : node.getExecLog());

        var rr = promptRenderService.render("workflow_gate.md", vars);
        long t = System.currentTimeMillis();
        String out = llmService.chatPublic(rr.text());
        aiLogService.record(issue.getCode(), node.getName() + "·闸门", "服务端LLM",
                llmService.publicModelName(), rr.text(), rr.missingVars(),
                System.currentTimeMillis() - t, 0L, BigDecimal.ZERO, null);

        boolean pass = out == null || !out.contains("blocked");
        node.setExecLog((node.getExecLog() == null ? "" : node.getExecLog()) + "\n[闸门判定] " + (pass ? "通过" : "阻塞"));
        nodeRepository.save(node);
        return pass;
    }

    /** 模板节点定义 */
    public record NodeDef(int step, String name, String kind, String execLocation,
                          String backend, String promptTemplate, String gate) {}
}
