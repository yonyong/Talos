package com.yonyong.talos.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yonyong.talos.entity.*;
import com.yonyong.talos.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 工作流编排引擎：模板图 → 实例 → 节点推进。
 *
 * <p>执行模型是<b>有向无环图 + 条件边</b>，不是线性 step+1：
 * <ul>
 *   <li>节点就绪条件 = 全部前驱已终结，且至少一条入边的条件成立；多条入边同时成立即<b>并行下发</b>。</li>
 *   <li>条件边支持 {@code always / gate:pass / gate:blocked / success / failed} 与
 *       {@code expr:} 表达式（{@code && || ! () == != in}）。</li>
 *   <li>{@code loopback} 回退边会把「目标 → 源」路径上的节点重置重做（如设计评审驳回打回重做），
 *       轮次有上限，超限阻塞待人工介入。</li>
 * </ul>
 *
 * <p>整条链路 fail-safe：表达式解析不出按「条件不成立」处理，闸门结论解析不出按「阻断」处理，
 * 分支走空时实例转 blocked 而不是静默 done。
 *
 * <p>langchain4j 在这里只承担两件事：PromptTemplate 渲染与 ChatLanguageModel 调用；
 * 图遍历与选路是本类自己实现的确定性算法，不依赖编排框架。
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
    private final ClientRegistry clientRegistry;
    private final ClientLogService clientLog;
    private final PromptRenderService promptRenderService;
    private final LlmService llmService;
    private final AiLogService aiLogService;

    /** 闸门判定输出格式：结论：pass 或 blocked */
    private static final Pattern GATE_RESULT = Pattern.compile("结论[:：]\\s*(pass|blocked)", Pattern.CASE_INSENSITIVE);

    /** 回退边最多重做轮次，防止「评审驳回 ↔ 修改」无限循环 */
    public static final int MAX_ROUNDS = 3;

    /** 已终结的节点状态 */
    private static final Set<String> TERMINAL = Set.of("success", "failed", "skipped", "cancelled");

    /** 正在等客户端回执 / 已下发 */
    private static final Set<String> ACTIVE = Set.of("dispatched", "running");

    /**
     * 机械节点类型：确定性操作，与模型无关（如「拉取 Git」只做 clone/fetch/切分支）。
     *
     * <p>客户端 execute() 对这类节点不选后端、不渲染 Prompt、不起 Coding Agent CLI；
     * 服务端也要认这张表，才能挡住旧版客户端把这类节点误记成 AI 调用
     * （见 {@link AgentGrpcService#callLog}）。两端同步维护。
     */
    private static final Set<String> MECHANICAL_KINDS = Set.of("git");

    /** 节点是否为机械节点（不产生 AI 调用） */
    public static boolean isMechanicalKind(String kind) {
        return kind != null && MECHANICAL_KINDS.contains(kind.trim().toLowerCase());
    }

    private final ObjectMapper om = new ObjectMapper();

    /* ==================== 图定义模型 ==================== */

    public record NodeDef(int step, String name, String kind, String execLocation,
                          String backend, String promptTemplate, String gate) {}

    /** kind: forward（前向） | loopback（回退重做） */
    public record EdgeDef(int from, int to, String condition, String label, String kind) {}

    public record GraphDef(List<NodeDef> nodes, List<EdgeDef> edges) {}

    /**
     * 图定义非法（悬空连线 / 自环 / 无节点 / JSON 语法错）。
     * 继承 IllegalArgumentException：这是「请求体有问题」，应当返回 400 而不是 409。
     */
    public static class GraphDefException extends IllegalArgumentException {
        public GraphDefException(String message) { super(message); }
        public GraphDefException(String message, Throwable cause) { super(message, cause); }
    }

    /* ==================== 图解析 / 序列化 ==================== */

    /**
     * 解析模板定义为图结构。
     * 兼容旧版「节点数组」格式：自动补成 always 线性链，便于平滑迁移。
     */
    public GraphDef parseGraph(String json) {
        if (json == null || json.isBlank()) throw new GraphDefException("工作流定义为空");
        try {
            JsonNode root = om.readTree(json);
            boolean legacyArray = root.isArray();

            JsonNode nodesNode = legacyArray ? root : root.path("nodes");
            List<NodeDef> nodes = new ArrayList<>();
            if (nodesNode.isArray()) {
                for (JsonNode n : nodesNode) {
                    nodes.add(new NodeDef(
                            n.path("step").asInt(nodes.size() + 1),
                            n.path("name").asText("节点"),
                            n.path("kind").asText("doc"),
                            n.path("execLocation").asText("客户端"),
                            n.path("backend").asText("—"),
                            n.path("promptTemplate").asText("—"),
                            n.path("gate").asText("—")));
                }
            }
            if (nodes.isEmpty()) throw new GraphDefException("工作流定义中没有节点");

            List<EdgeDef> edges = new ArrayList<>();
            JsonNode edgesNode = legacyArray ? null : root.path("edges");
            if (edgesNode != null && edgesNode.isArray() && edgesNode.size() > 0) {
                for (JsonNode e : edgesNode) {
                    int from = e.path("from").asInt();
                    int to = e.path("to").asInt();
                    String condition = e.path("condition").asText("always");
                    String label = e.path("label").asText("");
                    // 未显式声明时按方向推导：指向自身或更早步骤即为回退边
                    String kind = e.path("kind").asText(to <= from ? "loopback" : "forward");
                    edges.add(new EdgeDef(from, to, condition, label, kind));
                }
            } else {
                List<NodeDef> sorted = nodes.stream().sorted(Comparator.comparingInt(NodeDef::step)).toList();
                for (int i = 0; i + 1 < sorted.size(); i++) {
                    edges.add(new EdgeDef(sorted.get(i).step(), sorted.get(i + 1).step(), "always", "", "forward"));
                }
            }

            Set<Integer> steps = nodes.stream().map(NodeDef::step).collect(Collectors.toSet());
            for (EdgeDef e : edges) {
                if (!steps.contains(e.from()) || !steps.contains(e.to())) {
                    throw new GraphDefException("连线引用了不存在的节点: " + e.from() + " → " + e.to());
                }
                if (e.from() == e.to()) throw new GraphDefException("不允许节点自环连线: " + e.from());
            }

            return new GraphDef(
                    nodes.stream().sorted(Comparator.comparingInt(NodeDef::step)).toList(),
                    edges);
        } catch (GraphDefException e) {
            throw e;
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new GraphDefException("工作流定义解析失败: " + e.getMessage(), e);
        }
    }

    /** 序列化图定义（写入实例快照用），保证与 parseGraph 对称 */
    public String serializeGraph(GraphDef g) {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("version", 2);
        List<Map<String, Object>> ns = new ArrayList<>();
        for (NodeDef n : g.nodes()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("step", n.step());
            m.put("name", n.name());
            m.put("kind", n.kind());
            m.put("execLocation", n.execLocation());
            m.put("backend", n.backend());
            m.put("promptTemplate", n.promptTemplate());
            m.put("gate", n.gate());
            ns.add(m);
        }
        List<Map<String, Object>> es = new ArrayList<>();
        for (EdgeDef e : g.edges()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("from", e.from());
            m.put("to", e.to());
            m.put("condition", e.condition());
            m.put("label", e.label());
            m.put("kind", e.kind());
            es.add(m);
        }
        root.put("nodes", ns);
        root.put("edges", es);
        try {
            return om.writeValueAsString(root);
        } catch (Exception e) {
            throw new IllegalStateException("工作流定义序列化失败", e);
        }
    }

    /** 从节点图推导入口节点（无入边的节点），支持多入口并行 */
    private List<NodeDef> entryNodes(GraphDef g) {
        Set<Integer> hasIn = g.edges().stream().map(EdgeDef::to).collect(Collectors.toSet());
        return g.nodes().stream().filter(n -> !hasIn.contains(n.step())).toList();
    }

    /* ==================== 启动 ==================== */

    /** 启动工作流：准入通过、未关闭、已分拣到仓库才可执行 */
    public WorkflowInstance start(String issueCode) {
        IssueEntity issue = issueRepository.findByCode(issueCode);
        if (issue == null) throw new IllegalArgumentException("Issue 不存在: " + issueCode);
        if (!"admit".equals(issue.getAdmissionResult())) {
            throw new IllegalStateException("Issue 未通过准入，不能启动工作流: " + issueCode);
        }
        if ("closed".equals(issue.getStatus())) {
            throw new IllegalStateException("Issue 已关闭，不能启动工作流: " + issueCode);
        }
        // 工作流的 Git 节点需要仓库地址；未分拣到仓库时启动只会产生空转实例
        if (issue.getRepoUrl() == null || issue.getRepoUrl().isBlank()) {
            throw new IllegalStateException("Issue 尚未分拣到仓库，无法启动工作流；请先在详情中人工指定业务域: " + issueCode);
        }
        WorkflowInstance running = latestRunning(issueCode);
        if (running != null) {
            throw new IllegalStateException("Issue 已有运行中的实例 " + running.getInstanceCode() + "，请勿重复启动: " + issueCode);
        }
        WorkflowTemplate tpl = templateRepository.findByCode(issue.getType());
        if (tpl == null) throw new IllegalStateException("未找到工作流模板: " + issue.getType());
        GraphDef graph = parseStoredGraph(tpl.getDefinitionJson(), "模板 " + tpl.getCode());

        // 未绑定执行客户端的实例没有下发通道，排队补发（resumeQueued）也按 clientId 匹配、永远轮不到它，
        // 只会造出「执行中但全部待执行」的僵尸实例；客户端离线但已绑定则允许启动，靠上线补发消化队列
        boolean needsClient = graph.nodes().stream().anyMatch(n -> "客户端".equals(n.execLocation()));
        if (needsClient && (issue.getClientId() == null || issue.getClientId().isBlank())) {
            throw new IllegalStateException("Issue 未绑定执行客户端（承接人未绑定客户端或业务域未配置负责人），无法启动工作流；"
                    + "请在「客户端」页为责任人绑定客户端后重新分拣: " + issueCode);
        }

        WorkflowInstance inst = new WorkflowInstance();
        inst.setInstanceCode("WI-" + (1000 + (int) (Math.random() * 9000)));
        inst.setIssueCode(issueCode);
        inst.setTemplateCode(tpl.getCode());
        inst.setCurrentStep(0);
        inst.setTotalSteps(graph.nodes().size());
        inst.setStatus("running");
        inst.setClientId(issue.getClientId());
        inst.setRound(1);
        // 固化图快照：模板后续改动不影响已在执行的实例
        inst.setDefinitionJson(serializeGraph(graph));
        instanceRepository.save(inst);

        List<TaskNodeEntity> nodes = new ArrayList<>();
        for (NodeDef d : graph.nodes()) {
            TaskNodeEntity n = new TaskNodeEntity();
            n.setInstanceCode(inst.getInstanceCode());
            n.setStep(d.step());
            n.setName(d.name());
            n.setKind(d.kind());
            n.setExecLocation(d.execLocation());
            n.setBackend(d.backend());
            n.setPromptTemplate(d.promptTemplate());
            n.setGate(d.gate());
            n.setRound(1);
            n.setStatus("waiting");
            nodes.add(nodeRepository.save(n));
        }

        issue.setStatus("running");
        issueRepository.save(issue);

        for (NodeDef entry : entryNodes(graph)) {
            TaskNodeEntity n = nodes.stream().filter(x -> Objects.equals(x.getStep(), entry.step())).findFirst().orElse(null);
            if (n != null) pushNext(n, issue, inst.getClientId());
        }
        return syncProgress(inst);
    }

    /* ==================== 推进 ==================== */

    /**
     * 节点推进。
     *
     * @param step    节点步骤；传 null / &lt;=0 时由引擎自动挑选当前可推进的节点（人工回执场景）
     * @param success 节点执行是否成功
     */
    public WorkflowInstance advance(String instanceCode, Integer step, boolean success, String logText) {
        WorkflowInstance inst = instanceRepository.findByInstanceCode(instanceCode);
        if (inst == null) throw new IllegalArgumentException("实例不存在: " + instanceCode);
        if ("done".equals(inst.getStatus())) throw new IllegalStateException("实例已完成，无法推进: " + instanceCode);
        if ("cancelled".equals(inst.getStatus())) throw new IllegalStateException("实例已取消，无法推进: " + instanceCode);

        GraphDef graph = graphOf(inst);
        List<TaskNodeEntity> nodes = nodeRepository.findByInstanceCodeOrderByStepAsc(instanceCode);
        IssueEntity issue = issueRepository.findByCode(inst.getIssueCode());

        TaskNodeEntity cur = (step == null || step <= 0) ? pickActive(nodes, graph) : byStep(nodes).get(step);
        if (cur == null) throw new IllegalArgumentException("实例 " + instanceCode + " 不存在步骤 " + step);
        if (TERMINAL.contains(cur.getStatus())) {
            throw new IllegalStateException("步骤 " + cur.getStep() + " 已终结（" + cur.getStatus() + "），不能重复推进");
        }

        cur.setStatus(success ? "success" : "failed");
        cur.setFinishedAt(LocalDateTime.now());
        cur.setExecLog(append(cur.getExecLog(),
                (logText == null || logText.isBlank()) ? ("节点回执：" + (success ? "执行成功" : "执行失败")) : logText));
        nodeRepository.save(cur);

        // 有闸门的节点成功执行后，再挂一次 LLM 判定；结论写入 gateResult 供条件边选路
        if (success && hasGate(cur)) {
            boolean pass = gateDecision(cur, issue);
            cur.setGateResult(pass ? "pass" : "blocked");
            nodeRepository.save(cur);
        }

        // 回退边：把「目标 → 源」路径上的节点整体重置重做
        Set<Integer> loopbackTargets = new LinkedHashSet<>();
        List<String> brokenEdges = new ArrayList<>();
        boolean exceededRounds = false;
        int backs = 0;
        for (EdgeDef e : outgoing(graph, cur.getStep())) {
            if (!"loopback".equals(e.kind())) continue;
            Verdict v = verdictOf(e, cur, ctxOf(cur, issue, inst));
            if (v == Verdict.BROKEN) brokenEdges.add(edgeLabel(e));
            if (v != Verdict.TAKEN) continue;
            backs++;
            int nextRound = (inst.getRound() == null ? 1 : inst.getRound()) + 1;
            if (nextRound > MAX_ROUNDS) {
                exceededRounds = true;
                log.warn("回退重做已达上限 {} 轮: instance={} 节点 {}→{}", MAX_ROUNDS, instanceCode, e.from(), e.to());
                break;
            }
            inst.setRound(nextRound);
            resetPath(graph, nodes, e.to(), e.from(), nextRound, e.label());
            loopbackTargets.add(e.to());
        }
        if (backs > 0 && !exceededRounds) {
            instanceRepository.save(inst);
            nodes = nodeRepository.findByInstanceCodeOrderByStepAsc(instanceCode);
        }

        // 全局扫描：推导「就绪节点」（全部前向前驱已终结 + 至少一条入边成立），并级联跳过条件不成立的分支
        Set<Integer> ready = sweep(graph, nodes, issue, inst, loopbackTargets, brokenEdges);

        if (!ready.isEmpty()) {
            Map<Integer, TaskNodeEntity> idx = byStep(nodes);
            for (int s : ready) {          // 多分支同时就绪 → 并行下发
                TaskNodeEntity n = idx.get(s);
                if (n != null) pushNext(n, issue, inst.getClientId());
            }
            inst.setStatus("running");
            if (issue != null && !"closed".equals(issue.getStatus())) {
                issue.setStatus("running");
                issueRepository.save(issue);
            }
            return syncProgress(inst);
        }

        nodes = nodeRepository.findByInstanceCodeOrderByStepAsc(instanceCode);
        boolean anyActive = nodes.stream().anyMatch(n -> "waiting".equals(n.getStatus()) || ACTIVE.contains(n.getStatus()));

        if (exceededRounds) {
            return block(inst, issue, "回退重做超过 " + MAX_ROUNDS + " 轮上限，转人工介入", false);
        }
        if (anyActive) {
            // 仍有分支在等客户端回执：实例保持运行中，不误判为完成
            inst.setStatus("running");
            return syncProgress(inst);
        }

        // 条件写错导致分支走空：必须转人工，绝不能因「无节点可跑」就标记完成
        if (!brokenEdges.isEmpty()) {
            return block(inst, issue,
                    "存在无法解析的条件边（" + String.join("；", brokenEdges) + "），无法确定后续走向，转人工介入", false);
        }

        boolean anyFailed = nodes.stream().anyMatch(n -> "failed".equals(n.getStatus()));
        boolean anyGateBlocked = nodes.stream().anyMatch(n -> "blocked".equals(n.getGateResult()));
        if (anyFailed) {
            return block(inst, issue, "存在执行失败且无后续分支可承接，转人工处理", false);
        }
        if (anyGateBlocked) {
            return block(inst, issue, "闸门阻断且无回退分支，转人工评审", true);
        }

        inst.setStatus("done");
        inst.setCurrentStep(nodes.size());
        instanceRepository.save(inst);
        if (issue != null && !"closed".equals(issue.getStatus())) {
            issue.setStatus("done");
            issueRepository.save(issue);
        }
        log.info("工作流实例已完成: {}", instanceCode);
        return inst;
    }

    /** 实例阻塞：写状态与原因，可选落到「评审待决」 */
    private WorkflowInstance block(WorkflowInstance inst, IssueEntity issue, String reason, boolean review) {
        inst.setStatus("blocked");
        instanceRepository.save(inst);
        if (issue != null && !"closed".equals(issue.getStatus())) {
            issue.setStatus(review ? "reviewing" : "blocked");
            issueRepository.save(issue);
        }
        log.info("工作流实例阻塞: {} · {}", inst.getInstanceCode(), reason);
        return syncProgress(inst);
    }

    /**
     * 全局扫描并推导就绪节点。
     *
     * <p>反复迭代到不动点：条件全部不成立的节点标记 skipped，并继续向下游级联跳过。
     *
     * <p><b>回退边不参与前驱就绪判定</b>：否则「评审 →（驳回）→ 详设」会让详设永远等不到
     * 评委终结，形成死锁。回退边的唯一作用是重置路径，重置后的目标由
     * {@code loopbackTargets} 直接入就绪集合。
     */
    private Set<Integer> sweep(GraphDef graph, List<TaskNodeEntity> nodes, IssueEntity issue,
                               WorkflowInstance inst, Set<Integer> loopbackTargets, List<String> brokenEdges) {
        return sweep(graph, nodes, issue, inst, loopbackTargets, brokenEdges, true);
    }

    /**
     * @param allowSkip false 时不做「条件不成立 → skipped」的落库判定，只挑就绪节点。
     *                  客户端上线补发排队任务时用：那是重试而不是推进，不应顺带终结分支。
     */
    private Set<Integer> sweep(GraphDef graph, List<TaskNodeEntity> nodes, IssueEntity issue,
                               WorkflowInstance inst, Set<Integer> loopbackTargets, List<String> brokenEdges,
                               boolean allowSkip) {
        Map<Integer, TaskNodeEntity> idx = byStep(nodes);
        Set<Integer> ready = new LinkedHashSet<>();
        boolean changed = true;
        while (changed) {
            changed = false;
            for (TaskNodeEntity n : nodes) {
                if (!"waiting".equals(n.getStatus()) || ready.contains(n.getStep())) continue;
                List<EdgeDef> ins = incoming(graph, n.getStep());
                if (ins.isEmpty()) continue;                     // 入口节点由 start 负责下发
                // 若该节点是被回退边重置的目标，直接进入就绪（其前向前驱可能仍在重做中）
                if (loopbackTargets.contains(n.getStep())) {
                    ready.add(n.getStep());
                    changed = true;
                    continue;
                }
                List<EdgeDef> fwdIns = ins.stream().filter(e -> !"loopback".equals(e.kind())).toList();
                if (fwdIns.isEmpty()) continue;                  // 仅由回退边驱动的节点，等待回退触发
                boolean allPredTerminal = fwdIns.stream().allMatch(e -> {
                    TaskNodeEntity p = idx.get(e.from());
                    return p != null && TERMINAL.contains(p.getStatus());
                });
                if (!allPredTerminal) continue;

                boolean taken = false;
                for (EdgeDef e : fwdIns) {
                    Verdict v = verdictOf(e, idx.get(e.from()), ctxOf(idx.get(e.from()), issue, inst));
                    if (v == Verdict.TAKEN) { taken = true; break; }
                    if (v == Verdict.BROKEN && !brokenEdges.contains(edgeLabel(e))) brokenEdges.add(edgeLabel(e));
                }
                if (taken) {
                    ready.add(n.getStep());
                } else if (allowSkip) {
                    n.setStatus("skipped");
                    n.setFinishedAt(LocalDateTime.now());
                    n.setExecLog(append(n.getExecLog(), "[条件不成立] 所有入边条件均未命中，节点跳过"));
                    nodeRepository.save(n);
                    changed = true;
                }
            }
        }
        return ready;
    }

    /** 回退重做：重置 target → source 路径上的节点（含两端），清空判定与执行痕迹 */
    private void resetPath(GraphDef graph, List<TaskNodeEntity> nodes, int target, int source, int round, String label) {
        Set<Integer> onPath = pathNodes(graph, target, source);
        String tip = "[第 " + round + " 轮重做] " + (label == null || label.isBlank() ? ("由步骤 " + source + " 回退") : label);
        for (TaskNodeEntity n : nodes) {
            if (!onPath.contains(n.getStep())) continue;
            n.setStatus("waiting");
            n.setGateResult(null);
            n.setRound(round);
            n.setStartedAt(null);
            n.setFinishedAt(null);
            n.setExecLog(append(n.getExecLog(), tip));
            nodeRepository.save(n);
        }
        log.info("回退重做: 步骤 {} → {}（第 {} 轮），重置节点 {}", source, target, round, onPath);
    }

    /** 求出 target 到 source 路径上的全部节点（正向可达 ∩ 反向可达） */
    private Set<Integer> pathNodes(GraphDef graph, int target, int source) {
        Set<Integer> fwd = reach(graph, target, true);
        Set<Integer> back = reach(graph, source, false);
        Set<Integer> onPath = new LinkedHashSet<>(fwd);
        onPath.retainAll(back);
        onPath.add(target);
        onPath.add(source);
        return onPath;
    }

    /** 图可达性：forward=true 沿出边，false 沿入边 */
    private Set<Integer> reach(GraphDef graph, int start, boolean forward) {
        Set<Integer> seen = new LinkedHashSet<>();
        Deque<Integer> queue = new ArrayDeque<>();
        queue.add(start);
        while (!queue.isEmpty()) {
            int cur = queue.poll();
            for (EdgeDef e : graph.edges()) {
                if (forward && e.from() != cur) continue;
                if (!forward && e.to() != cur) continue;
                int nxt = forward ? e.to() : e.from();
                if (seen.add(nxt)) queue.add(nxt);
            }
        }
        return seen;
    }

    /** 挑选当前可推进的节点：优先已在客户端执行中的，其次前驱已全部终结的待执行节点 */
    private TaskNodeEntity pickActive(List<TaskNodeEntity> nodes, GraphDef graph) {
        Map<Integer, TaskNodeEntity> idx = byStep(nodes);
        Optional<TaskNodeEntity> running = nodes.stream()
                .filter(n -> ACTIVE.contains(n.getStatus()))
                .min(Comparator.comparingInt(TaskNodeEntity::getStep));
        if (running.isPresent()) return running.get();
        Optional<TaskNodeEntity> next = nodes.stream()
                .filter(n -> "waiting".equals(n.getStatus()))
                .filter(n -> {
                    List<EdgeDef> ins = incoming(graph, n.getStep());
                    if (ins.isEmpty()) return true;          // 入口节点：无前驱，随时可推进
                    List<EdgeDef> fwdIns = ins.stream().filter(e -> !"loopback".equals(e.kind())).toList();
                    if (fwdIns.isEmpty()) return false;      // 仅由回退边驱动的节点，等待回退触发
                    return fwdIns.stream().allMatch(e -> {
                        TaskNodeEntity p = idx.get(e.from());
                        return p != null && TERMINAL.contains(p.getStatus());
                    });
                })
                .min(Comparator.comparingInt(TaskNodeEntity::getStep));
        if (next.isPresent()) return next.get();
        throw new IllegalStateException("实例没有可推进的节点：可能已全部终结，或仍在等待客户端回执");
    }

    private WorkflowInstance syncProgress(WorkflowInstance inst) {
        List<TaskNodeEntity> nodes = nodeRepository.findByInstanceCodeOrderByStepAsc(inst.getInstanceCode());
        inst.setCurrentStep((int) nodes.stream().filter(n -> TERMINAL.contains(n.getStatus())).count());
        return instanceRepository.save(inst);
    }

    /* ==================== 条件边求值 ==================== */

    private List<EdgeDef> outgoing(GraphDef g, int step) {
        return g.edges().stream().filter(e -> e.from() == step).toList();
    }

    private List<EdgeDef> incoming(GraphDef g, int step) {
        return g.edges().stream().filter(e -> e.to() == step).toList();
    }

    /** 边判定三态：命中 / 未命中 / 条件本身无法解析 */
    private enum Verdict { TAKEN, NOT_TAKEN, BROKEN }

    /**
     * 判断一条边是否被采纳。
     * 无条件边（always）只在前驱「成功」时生效——失败默认中断链路，
     * 需要续接必须显式写 failed / expr 分支，避免失败被静默放过。
     */
    private Verdict verdictOf(EdgeDef e, TaskNodeEntity src, Map<String, Object> vars) {
        if (src == null) return Verdict.NOT_TAKEN;
        String st = src.getStatus();
        // 跳过 / 取消向上游传播：不选任何出边，下游级联跳过
        if ("skipped".equals(st) || "cancelled".equals(st)) return Verdict.NOT_TAKEN;
        String cond = e.condition() == null ? "" : e.condition().trim();
        boolean isAlways = cond.isEmpty() || "always".equalsIgnoreCase(cond) || "—".equals(cond);
        if (isAlways) return "success".equals(st) ? Verdict.TAKEN : Verdict.NOT_TAKEN;
        Boolean v = evalCondition(cond, vars);
        if (v == null) return Verdict.BROKEN;
        return v ? Verdict.TAKEN : Verdict.NOT_TAKEN;
    }

    private String edgeLabel(EdgeDef e) {
        return e.from() + " → " + e.to() + "（" + (e.condition() == null ? "always" : e.condition()) + "）";
    }

    /** 节点上下文：执行结果 + 闸门结论 + Issue 维度变量 */
    private Map<String, Object> ctxOf(TaskNodeEntity src, IssueEntity issue) {
        return ctxOf(src, issue, null);
    }

    private Map<String, Object> ctxOf(TaskNodeEntity src, IssueEntity issue, WorkflowInstance inst) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("result", src == null ? "pending" : src.getStatus());
        m.put("gate", src == null || src.getGateResult() == null ? "none" : src.getGateResult());
        m.put("round", inst == null || inst.getRound() == null ? 1 : inst.getRound());
        if (issue != null) {
            m.put("issue.priority", nz(issue.getPriority()));
            m.put("issue.type", nz(issue.getType()));
            m.put("issue.biz", nz(issue.getBizCode()));
            m.put("issue.owner", nz(issue.getOwner()));
            m.put("issue.project", nz(issue.getProject()));
            m.put("issue.clientId", nz(issue.getClientId()));
        }
        return m;
    }

    private String nz(String s) { return s == null ? "" : s; }

    /**
     * 条件求值。支持：
     * <pre>
     *   always / never
     *   success / failed / gate:pass / gate:blocked
     *   expr:issue.priority == P0 &amp;&amp; gate == pass
     *   expr:issue.biz in quote,backtest
     * </pre>
     * @return TRUE=命中 FALSE=不命中 null=<b>条件本身无法解析</b>。
     *         调用方必须把 null 与 FALSE 区别对待：不命中可以正常走空，
     *         无法解析则要转人工，避免写错表达式导致分支被静默跳过、实例照常 done。
     */
    public Boolean evalCondition(String cond, Map<String, Object> vars) {
        if (cond == null) return Boolean.TRUE;
        String c = cond.trim();
        if (c.isEmpty() || "always".equalsIgnoreCase(c) || "—".equals(c)) return Boolean.TRUE;
        if ("never".equalsIgnoreCase(c)) return Boolean.FALSE;
        if (c.length() > 5 && c.regionMatches(true, 0, "expr:", 0, 5)) c = c.substring(5).trim();

        switch (c.toLowerCase()) {
            case "success":
            case "result:success":
                return "success".equals(vars.get("result")) ? Boolean.TRUE : Boolean.FALSE;
            case "failed":
            case "result:failed":
                return "failed".equals(vars.get("result")) ? Boolean.TRUE : Boolean.FALSE;
            case "gate:pass":
                return "pass".equals(vars.get("gate")) ? Boolean.TRUE : Boolean.FALSE;
            case "gate:blocked":
                return "blocked".equals(vars.get("gate")) ? Boolean.TRUE : Boolean.FALSE;
            default:
                break;
        }

        Boolean v = new ExprParser(c, vars).parse();
        if (v == null) log.warn("条件表达式无法解析，转人工判定: {}", cond);
        return v;
    }

    /** 极简布尔表达式解析器：|| / && / ! / () / == / != / in / 字面量 */
    private static final class ExprParser {
        private final String src;
        private final Map<String, Object> vars;
        private int pos;

        ExprParser(String src, Map<String, Object> vars) { this.src = src; this.vars = vars; }

        Boolean parse() {
            try {
                boolean v = or();
                skipWs();
                if (pos < src.length()) return null;       // 有残留字符 → 非法表达式
                return v;
            } catch (RuntimeException e) {
                return null;
            }
        }

        private boolean or() {
            boolean v = and();
            while (match("||")) {
                boolean r = and();
                v = v || r;
            }
            return v;
        }

        private boolean and() {
            boolean v = not();
            while (match("&&")) {
                boolean r = not();
                v = v && r;
            }
            return v;
        }

        private boolean not() {
            skipWs();
            if (peekIs('!') && !peekIsAt(pos + 1, '=')) {
                pos++;
                return !not();
            }
            return primary();
        }

        private boolean primary() {
            skipWs();
            if (match("(")) {
                boolean v = or();
                if (!match(")")) throw new IllegalStateException("表达式缺少右括号");
                return v;
            }
            return comparison();
        }

        private boolean comparison() {
            String name = ident();
            skipWs();
            if (match("==")) return Objects.equals(value(name), literal());
            if (match("!=")) return !Objects.equals(value(name), literal());
            if (matchWord("in")) {
                List<String> set = new ArrayList<>();
                set.add(literal());
                while (match(",")) set.add(literal());
                return set.stream().anyMatch(x -> Objects.equals(x, value(name)));
            }
            // 裸标识符按真值判断
            Object v = value(name);
            if (v == null) return false;
            String s = String.valueOf(v);
            return "true".equalsIgnoreCase(s) || "yes".equalsIgnoreCase(s) || "1".equals(s);
        }

        private Object value(String name) {
            if (vars.containsKey(name)) return vars.get(name);
            // 允许省略 issue. 前缀
            if (vars.containsKey("issue." + name)) return vars.get("issue." + name);
            return null;
        }

        private String ident() {
            skipWs();
            int start = pos;
            while (pos < src.length()) {
                char ch = src.charAt(pos);
                if (Character.isLetterOrDigit(ch) || ch == '_' || ch == '.') pos++;
                else break;
            }
            if (pos == start) throw new IllegalStateException("表达式缺少变量名");
            return src.substring(start, pos);
        }

        private String literal() {
            skipWs();
            if (pos < src.length() && (src.charAt(pos) == '"' || src.charAt(pos) == '\'')) {
                char quote = src.charAt(pos++);
                int start = pos;
                while (pos < src.length() && src.charAt(pos) != quote) pos++;
                String s = src.substring(start, pos);
                if (pos < src.length()) pos++;
                return s;
            }
            int start = pos;
            while (pos < src.length()) {
                char ch = src.charAt(pos);
                if (Character.isWhitespace(ch) || ch == ',' || ch == ')' || ch == '&' || ch == '|') break;
                pos++;
            }
            if (pos == start) throw new IllegalStateException("表达式缺少比较值");
            return src.substring(start, pos);
        }

        private boolean match(String token) {
            skipWs();
            if (src.startsWith(token, pos)) {
                pos += token.length();
                return true;
            }
            return false;
        }

        private boolean matchWord(String word) {
            skipWs();
            if (!src.regionMatches(true, pos, word, 0, word.length())) return false;
            int end = pos + word.length();
            if (end < src.length()) {
                char ch = src.charAt(end);
                if (Character.isLetterOrDigit(ch) || ch == '_' || ch == '.') return false;   // 避免把 index 当成 in
            }
            pos = end;
            return true;
        }

        private void skipWs() {
            while (pos < src.length() && Character.isWhitespace(src.charAt(pos))) pos++;
        }

        private boolean peekIs(char c) { return peekIsAt(pos, c); }

        private boolean peekIsAt(int i, char c) { return i < src.length() && src.charAt(i) == c; }
    }

    /* ==================== 闸门判定 ==================== */

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

        // fail-safe：判定缺失或无法解析一律阻断，避免模型异常/超时导致自动放行
        Boolean decision = parseGate(out);
        boolean pass = Boolean.TRUE.equals(decision);
        String verdict;
        if (decision == null) {
            verdict = "阻断（判定不可解析，fail-safe）";
            log.warn("闸门判定不可解析，按 fail-safe 阻断: issue={} node={} output={}",
                    issue.getCode(), node.getName(), out);
        } else {
            verdict = pass ? "通过" : "阻断";
        }

        node.setExecLog(append(node.getExecLog(), "[闸门判定] " + verdict));
        nodeRepository.save(node);
        return pass;
    }

    /**
     * 解析闸门结论。
     * @return TRUE=放行 FALSE=阻断 null=无法判定（调用方按 fail-safe 阻断）
     */
    private Boolean parseGate(String out) {
        if (out == null || out.isBlank()) return null;
        Matcher m = GATE_RESULT.matcher(out);
        if (m.find()) return "pass".equalsIgnoreCase(m.group(1));
        String s = out.toLowerCase();
        if (s.contains("blocked") || s.contains("不通过") || s.contains("驳回")) return false;
        if (s.contains("pass") || s.contains("通过")) return true;
        return null;
    }

    /* ==================== 节点类型回查 ==================== */

    /**
     * 按 Issue + 节点名回查节点类型。
     *
     * <p>用途：判定一条客户端上报的 AI 调用是否真实。旧版客户端（≤1.4.2）对机械节点
     * 也会上报 CALL_LOG，只有在服务端按节点名回查类型才能挡住，否则「拉取 Git」会被
     * 永久记成 codebuddy 调用。
     *
     * @return 节点类型；Issue 无实例、节点名匹配不上（如服务端 LLM 的「XX·闸门」）时返回 null
     */
    public String nodeKindOf(String issueCode, String nodeName) {
        if (issueCode == null || issueCode.isBlank() || nodeName == null || nodeName.isBlank()) return null;
        try {
            WorkflowInstance inst = latestInstance(issueCode);
            if (inst == null) return null;
            for (TaskNodeEntity n : nodeRepository.findByInstanceCodeOrderByStepAsc(inst.getInstanceCode())) {
                if (nodeName.equals(n.getName())) return n.getKind();
            }
        } catch (Exception e) {
            log.warn("回查节点类型失败: issue={} node={} - {}", issueCode, nodeName, e.getMessage());
        }
        return null;
    }

    /**
     * 该条调用日志是否来自机械节点（应当被 AI 调用日志拒收 / 过滤）。
     *
     * <p>优先用调用方带来的 kind（新版客户端会上报），缺失时按节点名回查兜底。
     */
    public boolean isMechanicalNodeCall(String issueCode, String nodeName, String kindHint) {
        if (isMechanicalKind(kindHint)) return true;
        return isMechanicalKind(nodeKindOf(issueCode, nodeName));
    }

    /**
     * AI 调用日志展示过滤：剔除机械节点留下的假记录。
     *
     * <p>只影响展示，<b>不删库</b> —— 历史行留在 t_ai_call_log 里可回溯，
     * 但「拉取 Git · codebuddy · token 0 · 无输出」这类记录不该出现在 AI 调用日志里。
     */
    public List<AiCallLogEntity> filterRealAiCalls(List<AiCallLogEntity> logs) {
        if (logs == null || logs.isEmpty()) return logs;
        Map<String, Boolean> cache = new HashMap<>();
        List<AiCallLogEntity> out = new ArrayList<>();
        for (AiCallLogEntity l : logs) {
            boolean mechanical = cache.computeIfAbsent(
                    nz(l.getIssueCode()) + "\u0000" + nz(l.getNode()),
                    k -> isMechanicalNodeCall(l.getIssueCode(), l.getNode(), null));
            if (!mechanical) out.add(l);
        }
        return out;
    }

    /* ==================== 查询 / 取消 ==================== */

    /** 取 Issue 最近一次实例（含已完成 / 已取消） */
    public WorkflowInstance latestInstance(String issueCode) {        WorkflowInstance found = null;
        for (WorkflowInstance i : instanceRepository.findByIssueCode(issueCode)) {
            if (found == null || (i.getId() != null && found.getId() != null && i.getId() > found.getId())) found = i;
        }
        return found;
    }

    /** 取 Issue 仍在执行中的实例（pending / running / blocked） */
    public WorkflowInstance latestRunning(String issueCode) {
        WorkflowInstance found = null;
        for (WorkflowInstance i : instanceRepository.findByIssueCode(issueCode)) {
            String s = i.getStatus();
            if ("pending".equals(s) || "running".equals(s) || "blocked".equals(s)) {
                if (found == null || (i.getId() != null && found.getId() != null && i.getId() > found.getId())) found = i;
            }
        }
        return found;
    }

    /** 实例的图定义：优先用启动时固化的快照，旧实例回退到当前模板 */
    public GraphDef graphOf(WorkflowInstance inst) {
        if (inst.getDefinitionJson() != null && !inst.getDefinitionJson().isBlank()) {
            return parseStoredGraph(inst.getDefinitionJson(), "实例 " + inst.getInstanceCode() + " 的图快照");
        }
        WorkflowTemplate tpl = templateRepository.findByCode(inst.getTemplateCode());
        if (tpl == null) throw new IllegalStateException("实例缺少图定义，且模板已不存在: " + inst.getInstanceCode());
        return parseStoredGraph(tpl.getDefinitionJson(), "模板 " + tpl.getCode());
    }

    /** 解析已入库的模板图定义（损坏时按服务端状态问题处理，不误报 400） */
    public GraphDef templateGraphOf(WorkflowTemplate tpl) {
        if (tpl == null) throw new IllegalArgumentException("模板不存在");
        return parseStoredGraph(tpl.getDefinitionJson(), "模板 " + tpl.getCode());
    }

    /**
     * 解析已入库的图定义。
     * 入库时已通过校验，这里再解析失败说明存量数据损坏 —— 属服务端状态问题（409/500），
     * 不能当成「请求体非法」返回 400 误导调用方。
     */
    private GraphDef parseStoredGraph(String json, String source) {
        try {
            return parseGraph(json);
        } catch (GraphDefException e) {
            throw new IllegalStateException(source + "的定义已损坏：" + e.getMessage(), e);
        }
    }

    /** 实例图 + 节点实时状态，供前端渲染 DAG 视图 */
    public Map<String, Object> instanceGraph(String instanceCode) {
        WorkflowInstance inst = instanceRepository.findByInstanceCode(instanceCode);
        if (inst == null) throw new IllegalArgumentException("实例不存在: " + instanceCode);
        GraphDef g = graphOf(inst);
        List<TaskNodeEntity> nodes = nodeRepository.findByInstanceCodeOrderByStepAsc(instanceCode);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("instanceCode", instanceCode);
        out.put("issueCode", inst.getIssueCode());
        out.put("templateCode", inst.getTemplateCode());
        out.put("status", inst.getStatus());
        out.put("round", inst.getRound() == null ? 1 : inst.getRound());
        out.put("maxRounds", MAX_ROUNDS);
        out.put("currentStep", inst.getCurrentStep());
        out.put("totalSteps", inst.getTotalSteps());

        List<Map<String, Object>> ns = new ArrayList<>();
        for (NodeDef d : g.nodes()) {
            TaskNodeEntity n = nodes.stream().filter(x -> Objects.equals(x.getStep(), d.step())).findFirst().orElse(null);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("step", d.step());
            m.put("name", d.name());
            m.put("kind", d.kind());
            m.put("execLocation", d.execLocation());
            m.put("backend", d.backend());
            m.put("promptTemplate", d.promptTemplate());
            m.put("gate", d.gate());
            m.put("status", n == null ? "waiting" : n.getStatus());
            m.put("gateResult", n == null ? null : n.getGateResult());
            m.put("round", n == null ? 1 : n.getRound());
            m.put("execLog", n == null ? null : n.getExecLog());
            ns.add(m);
        }
        out.put("nodes", ns);
        out.put("edges", g.edges());
        return out;
    }

    /** 取消实例：未执行完的节点标记 skipped，已完成的节点保留原状 */
    public WorkflowInstance cancel(String instanceCode, String reason) {
        WorkflowInstance inst = instanceRepository.findByInstanceCode(instanceCode);
        if (inst == null) throw new IllegalArgumentException("实例不存在: " + instanceCode);
        if ("done".equals(inst.getStatus())) throw new IllegalStateException("实例已完成，无法取消: " + instanceCode);
        if ("cancelled".equals(inst.getStatus())) return inst;

        String why = (reason == null || reason.isBlank()) ? "人工取消" : reason;
        inst.setStatus("cancelled");
        instanceRepository.save(inst);

        for (TaskNodeEntity n : nodeRepository.findByInstanceCodeOrderByStepAsc(instanceCode)) {
            if (TERMINAL.contains(n.getStatus())) continue;
            n.setStatus("skipped");
            n.setFinishedAt(LocalDateTime.now());
            n.setExecLog(append(n.getExecLog(), "[已取消] " + why));
            nodeRepository.save(n);
        }

        // 实例取消后 Issue 回到「已准入」待再次启动；已关闭 / 已验收的保持原状
        IssueEntity issue = issueRepository.findByCode(inst.getIssueCode());
        if (issue != null && !"closed".equals(issue.getStatus()) && !"done".equals(issue.getStatus())) {
            issue.setStatus("admitted");
            issueRepository.save(issue);
        }
        log.info("工作流实例已取消: {}（{}）", instanceCode, why);
        return syncProgress(inst);
    }

    /* ==================== 重新执行 ==================== */

    /**
     * 重新执行（监控页人工触发）。
     *
     * <ul>
     *   <li><b>不传 step</b>：整图重跑 —— 全部节点重置为 waiting，从入口节点重新下发。</li>
     *   <li><b>传 step</b>：从该节点起重跑 —— 该节点及其全部下游（正向可达）重置，
     *       上游已完成的节点结果保留，随后重新下发该节点，下游由推进扫描接续。</li>
     * </ul>
     *
     * <p>范围（scope）内仍有「已下发 / 执行中」的节点时拒绝执行：此时客户端可能随时回执，
     * 重置会造成同一步骤双重执行。先等回执或取消实例再重跑。
     *
     * <p>已完成 / 已取消 / 已阻塞的实例都可以重跑：实例状态拉回 running，
     * Issue 状态同步拉回 running（已关闭的 Issue 除外）。
     *
     * <p>范围内含客户端侧节点时，要求承接客户端在线，否则 409 拦截：离线下发只会静默排队，
     * 而「重新执行」是人工要求立即跑的动作，不该假装成功。
     */
    public WorkflowInstance rerun(String instanceCode, Integer step, String reason) {
        WorkflowInstance inst = instanceRepository.findByInstanceCode(instanceCode);
        if (inst == null) throw new IllegalArgumentException("实例不存在: " + instanceCode);

        GraphDef graph = graphOf(inst);
        List<TaskNodeEntity> nodes = nodeRepository.findByInstanceCodeOrderByStepAsc(instanceCode);
        Map<Integer, TaskNodeEntity> idx = byStep(nodes);
        IssueEntity issue = issueRepository.findByCode(inst.getIssueCode());
        boolean fullRerun = step == null || step <= 0;

        Set<Integer> scope = new LinkedHashSet<>();
        if (fullRerun) {
            nodes.forEach(n -> scope.add(n.getStep()));
        } else {
            if (!idx.containsKey(step)) throw new IllegalArgumentException("实例 " + instanceCode + " 不存在步骤 " + step);
            scope.addAll(reach(graph, step, true));
            scope.add(step);
        }

        List<Integer> activeInScope = nodes.stream()
                .filter(n -> scope.contains(n.getStep()) && ACTIVE.contains(n.getStatus()))
                .map(TaskNodeEntity::getStep)
                .toList();
        if (!activeInScope.isEmpty()) {
            throw new IllegalStateException("节点 " + activeInScope + " 正在客户端执行，请等待回执或先取消实例后再重新执行");
        }

        // 离线拦截：范围内只要有客户端侧节点，就必须有在线的承接客户端。
        // 不拦截的话，dispatch() 会静默返回 false、节点留在 waiting，接口却返回成功，
        // 控制台看起来「重新执行成功」，实际任务永远趴着（见 resumeQueued 的说明）。
        boolean needsClient = nodes.stream()
                .anyMatch(n -> scope.contains(n.getStep()) && "客户端".equals(n.getExecLocation()));
        if (needsClient) {
            String cid = inst.getClientId();
            if (cid == null || cid.isBlank()) {
                throw new IllegalStateException("实例未绑定执行客户端，无法重新执行（范围内含客户端侧节点）");
            }
            if (!clientRegistry.isOnline(cid)) {
                throw new IllegalStateException("目标客户端 " + cid + " 离线，无法下发任务；请先启动客户端后重新执行");
            }
        }

        int nextRound = (inst.getRound() == null ? 1 : inst.getRound()) + 1;
        String why = (reason == null || reason.isBlank()) ? "人工触发重新执行" : reason;
        String tip = "[重新执行·第 " + nextRound + " 轮] "
                + (fullRerun ? "整图重跑" : "自步骤 " + step + " 起重跑（含下游）") + " · " + why;
        for (TaskNodeEntity n : nodes) {
            if (!scope.contains(n.getStep())) continue;
            n.setStatus("waiting");
            n.setGateResult(null);
            n.setRound(nextRound);
            n.setStartedAt(null);
            n.setFinishedAt(null);
            n.setExecLog(append(n.getExecLog(), tip));
            nodeRepository.save(n);
        }

        inst.setRound(nextRound);
        inst.setStatus("running");
        instanceRepository.save(inst);
        if (issue != null && !"closed".equals(issue.getStatus()) && !"done".equals(issue.getStatus())) {
            issue.setStatus("running");
            issueRepository.save(issue);
        }

        // 重新下发：整图重跑推入口节点；从指定节点重跑直接推该节点
        List<Integer> kick = fullRerun
                ? entryNodes(graph).stream().map(NodeDef::step).toList()
                : List.of(step);
        for (int s : kick) {
            TaskNodeEntity n = idx.get(s);
            if (n != null) pushNext(n, issue, inst.getClientId());
        }

        log.info("工作流实例重新执行: {} scope={} 原因: {}", instanceCode, scope, why);
        return syncProgress(inst);
    }

    /* ==================== 排队补发 ==================== */

    /**
     * 客户端上线时补发该客户端名下「排队中」的节点任务。
     *
     * <p>下发链路上的失败是静默的：{@link DispatchService#dispatch} 遇到客户端离线只返回 false，
     * 节点保持 waiting，调用方（启动 / 重新执行 / 推进）照样返回成功。注释写的是「任务保持排队」，
     * 但原先没有任何地方去消化这个队列 —— 尤其入口节点只有 start/rerun 会推，
     * 一旦下发失败就再也没有触发点，任务永久挂起。
     *
     * <p>这里在客户端注册成功后统一补发：只挑「waiting 且已就绪（无入边，或前向前驱全部终结
     * 且至少一条入边条件成立）」的节点，且实例内没有正在飞的节点（避免同一步骤双重执行）。
     * 不做 skipped 判定，也不改变任何实例状态 —— 这只是重试，不是推进。
     *
     * @return 实际成功下发的节点数
     */
    public int resumeQueued(String clientId) {
        if (clientId == null || clientId.isBlank()) return 0;

        int sent = 0;
        for (WorkflowInstance inst : instanceRepository.findByStatus("running")) {
            if (!clientId.equals(inst.getClientId())) continue;
            try {
                List<TaskNodeEntity> nodes = nodeRepository.findByInstanceCodeOrderByStepAsc(inst.getInstanceCode());
                // 有节点还在客户端执行：交给回执推进，不插手
                if (nodes.stream().anyMatch(n -> ACTIVE.contains(n.getStatus()))) continue;
                if (nodes.stream().noneMatch(n -> "waiting".equals(n.getStatus()))) continue;

                IssueEntity issue = issueRepository.findByCode(inst.getIssueCode());
                if (issue == null) continue;
                GraphDef graph = graphOf(inst);
                Map<Integer, TaskNodeEntity> idx = byStep(nodes);

                Set<Integer> kick = new LinkedHashSet<>(
                        sweep(graph, nodes, issue, inst, Set.of(), new ArrayList<>(), false));
                // 入口节点由 start 负责下发，sweep 不处理；排队补发必须覆盖到
                for (NodeDef entry : entryNodes(graph)) {
                    TaskNodeEntity n = idx.get(entry.step());
                    if (n != null && "waiting".equals(n.getStatus())) kick.add(entry.step());
                }

                for (int s : kick) {
                    TaskNodeEntity n = idx.get(s);
                    if (n == null || !"waiting".equals(n.getStatus())) continue;
                    pushNext(n, issue, clientId);
                    if (!"waiting".equals(n.getStatus())) {
                        sent++;
                        clientLog.info(clientId, "server", "排队任务已补发 · " + n.getName()
                                + " · 实例 " + inst.getInstanceCode() + " 步骤 " + n.getStep());
                        log.info("排队任务已补发: client={} instance={} step={} node={}",
                                clientId, inst.getInstanceCode(), n.getStep(), n.getName());
                    }
                }
            } catch (Exception e) {
                log.warn("补发排队任务失败: instance={} - {}", inst.getInstanceCode(), e.getMessage());
            }
        }
        if (sent > 0) log.info("客户端上线补发排队任务: client={} 节点数={}", clientId, sent);
        return sent;
    }

    /* ==================== 内部工具 ==================== */

    /** 推送节点：客户端节点下发，服务端节点直接等待人工处理 */
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

    private Map<Integer, TaskNodeEntity> byStep(List<TaskNodeEntity> nodes) {
        return nodes.stream().collect(Collectors.toMap(TaskNodeEntity::getStep, n -> n, (a, b) -> a, LinkedHashMap::new));
    }

    private String append(String old, String line) {
        if (line == null || line.isBlank()) return old;
        return (old == null || old.isBlank()) ? line : old + "\n" + line;
    }
}
