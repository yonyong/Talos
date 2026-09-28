package com.yonyong.talos.service;

import com.yonyong.talos.entity.*;
import com.yonyong.talos.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

/** 首次启动初始化：两套工作流模板、Prompt 模板、知识库、用户、LLM 通道与默认 Agent 配置 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DataInitializer implements CommandLineRunner {

    private final WorkflowTemplateRepository templateRepository;
    private final PromptTemplateRepository promptTemplateRepository;
    private final KbDocRepository kbDocRepository;
    private final UserRepository userRepository;
    private final AgentConfigRepository agentConfigRepository;
    private final RolePermissionRepository rolePermissionRepository;
    private final BizDomainRepository bizDomainRepository;
    private final RepoRepository repoRepository;
    private final LlmConfigRepository llmConfigRepository;

    // LLM 通道的初始值来自 application.yml；一旦在控制台改过就以库里的为准
    @Value("${talos.llm.provider:qwen}") private String dftPublicProvider;
    @Value("${talos.llm.base-url:}") private String dftPublicBaseUrl;
    @Value("${talos.llm.api-key:}") private String dftPublicApiKey;
    @Value("${talos.llm.model:qwen-max}") private String dftPublicModel;
    @Value("${talos.private-model.enabled:true}") private boolean dftPrivateEnabled;
    @Value("${talos.private-model.base-url:}") private String dftPrivateBaseUrl;
    @Value("${talos.private-model.model:cb-internal}") private String dftPrivateModel;

    @Override
    public void run(String... args) {
        initTemplates();
        initPrompts();
        initKb();
        initUsers();
        initRolePermissions();
        initLlmConfigs();
        initAgentConfigs();
        initBizDomains();
        initRepos();
        migrateRepoBizBinding();
        log.info("初始化完成：模板 {} 套 · Prompt {} 个 · 知识库 {} 篇 · 用户 {} 个 · 角色权限 {} 条 · LLM 通道 {} 条 · 业务域 {} 个 · 仓库 {} 个",
                templateRepository.count(), promptTemplateRepository.count(),
                kbDocRepository.count(), userRepository.count(), rolePermissionRepository.count(),
                llmConfigRepository.count(),
                bizDomainRepository.count(), repoRepository.count());
    }

    private void initTemplates() {
        // 旧版种子是「节点数组」的线性链；图引擎要求 {nodes, edges}。检测到旧形态即整体重建，
        // 否则老库里的模板跑不出条件边与并行分支。
        if (templateRepository.count() > 0) {
            boolean stale = false;
            for (String code : new String[]{"REQ", "BUG"}) {
                WorkflowTemplate t = templateRepository.findByCode(code);
                if (t == null || t.getDefinitionJson() == null || !t.getDefinitionJson().trim().startsWith("{")) {
                    stale = true;
                    break;
                }
            }
            if (!stale) {
                migrateDocNodeBackend();
                return;
            }
            log.warn("检测到旧版线性模板定义，重建为 DAG 图定义");
            templateRepository.deleteAll();
        }

        templateRepository.save(tpl("REQ", "需求工作流", 7, """
                {
                  "version": 2,
                  "nodes": [
                    {"step":1,"name":"拉取 Git","kind":"git","execLocation":"客户端","backend":"—","promptTemplate":"—","gate":"—"},
                    {"step":2,"name":"需求分析","kind":"doc","execLocation":"客户端","backend":"责任人选定","promptTemplate":"requirement_outline.md","gate":"—"},
                    {"step":3,"name":"详细设计","kind":"doc","execLocation":"客户端","backend":"责任人选定","promptTemplate":"detail_design.md","gate":"—"},
                    {"step":4,"name":"设计评审","kind":"rev","execLocation":"服务端","backend":"—","promptTemplate":"review_checklist.md","gate":"人工闸门"},
                    {"step":5,"name":"编码","kind":"code","execLocation":"客户端","backend":"责任人选定","promptTemplate":"coding_task.md","gate":"分支隔离"},
                    {"step":6,"name":"测试","kind":"test","execLocation":"客户端","backend":"责任人选定","promptTemplate":"test_plan.md","gate":"覆盖率门禁"},
                    {"step":7,"name":"验收","kind":"rev","execLocation":"服务端","backend":"—","promptTemplate":"—","gate":"人工闸门"}
                  ],
                  "edges": [
                    {"from":1,"to":2,"condition":"always","label":"","kind":"forward"},
                    {"from":2,"to":3,"condition":"expr:issue.priority != P2","label":"常规流程 · 先详设","kind":"forward"},
                    {"from":2,"to":4,"condition":"expr:issue.priority == P2","label":"P2 简化 · 跳过详设","kind":"forward"},
                    {"from":3,"to":4,"condition":"always","label":"","kind":"forward"},
                    {"from":4,"to":5,"condition":"gate:pass","label":"评审通过","kind":"forward"},
                    {"from":4,"to":3,"condition":"gate:blocked","label":"评审驳回 · 打回重做","kind":"loopback"},
                    {"from":5,"to":6,"condition":"always","label":"","kind":"forward"},
                    {"from":6,"to":7,"condition":"always","label":"","kind":"forward"},
                    {"from":6,"to":5,"condition":"failed","label":"回归失败 · 回编码","kind":"loopback"}
                  ]
                }"""));
        templateRepository.save(tpl("BUG", "缺陷工作流", 7, """
                {
                  "version": 2,
                  "nodes": [
                    {"step":1,"name":"拉取 Git","kind":"git","execLocation":"客户端","backend":"—","promptTemplate":"—","gate":"—"},
                    {"step":2,"name":"问题分析","kind":"doc","execLocation":"客户端","backend":"责任人选定","promptTemplate":"fault_report.md","gate":"—"},
                    {"step":3,"name":"方案设计","kind":"doc","execLocation":"客户端","backend":"责任人选定","promptTemplate":"fix_design.md","gate":"—"},
                    {"step":4,"name":"设计评审","kind":"rev","execLocation":"服务端","backend":"—","promptTemplate":"review_checklist.md","gate":"人工闸门"},
                    {"step":5,"name":"编码","kind":"code","execLocation":"客户端","backend":"责任人选定","promptTemplate":"fix_coding.md","gate":"分支隔离"},
                    {"step":6,"name":"测试","kind":"test","execLocation":"客户端","backend":"责任人选定","promptTemplate":"regression_test.md","gate":"覆盖率门禁"},
                    {"step":7,"name":"验收","kind":"rev","execLocation":"服务端","backend":"—","promptTemplate":"—","gate":"人工闸门"}
                  ],
                  "edges": [
                    {"from":1,"to":2,"condition":"always","label":"","kind":"forward"},
                    {"from":2,"to":3,"condition":"always","label":"","kind":"forward"},
                    {"from":3,"to":4,"condition":"always","label":"","kind":"forward"},
                    {"from":4,"to":5,"condition":"gate:pass","label":"评审通过","kind":"forward"},
                    {"from":4,"to":3,"condition":"gate:blocked","label":"评审驳回 · 打回重做","kind":"loopback"},
                    {"from":5,"to":6,"condition":"always","label":"","kind":"forward"},
                    {"from":6,"to":7,"condition":"always","label":"","kind":"forward"},
                    {"from":6,"to":5,"condition":"failed","label":"回归失败 · 回编码","kind":"loopback"},
                    {"from":7,"to":5,"condition":"gate:blocked","label":"验收不通过 · 回编码","kind":"loopback"}
                  ]
                }"""));
    }

    /**
     * 一次性迁移：早期模板把文档节点写死 {@code backend=codebuddy}（源自杀掉了的"服务端默认后端"）。
     * 现已取消任何预设默认后端，这类节点应改为「责任人选定」——执行时按该用户本人配置的优先级解析。
     * 幂等：definitionJson 内 {@code "backend":"codebuddy"} 只可能出现在节点上，替换安全。
     */
    private void migrateDocNodeBackend() {
        for (String code : new String[]{"REQ", "BUG"}) {
            WorkflowTemplate t = templateRepository.findByCode(code);
            if (t == null || t.getDefinitionJson() == null) continue;
            String json = t.getDefinitionJson();
            String patched = json.replace("\"backend\":\"codebuddy\"", "\"backend\":\"责任人选定\"");
            if (!patched.equals(json)) {
                t.setDefinitionJson(patched);
                t.setUpdatedAt(LocalDateTime.now());
                templateRepository.save(t);
                log.info("迁移工作流 {}：文档节点 backend codebuddy → 责任人选定", code);
            }
        }
    }

    private WorkflowTemplate tpl(String code, String name, int nodeCount, String json) {
        WorkflowTemplate t = new WorkflowTemplate();
        t.setCode(code);
        t.setName(name);
        t.setNodeCount(nodeCount);
        t.setDefinitionJson(json);
        t.setEnabled(true);
        t.setUpdatedAt(LocalDateTime.now());
        return t;
    }

    /** Prompt 模板：逐条按名称补齐，已存在的库也能增量加入新模板 */
    private void initPrompts() {
        prompt("admission_judge.md", "准入判定", "服务端LLM",
                "issue.code,issue.type,issue.title,issue.desc,issue.priority,kb.hits",
                """
                        你是研发需求评审助手。请判断该 Issue 是否准入。

                        【编号】{{issue.code}}
                        【类型】{{issue.type}}
                        【标题】{{issue.title}}
                        【描述】{{issue.desc}}
                        【优先级】{{issue.priority}}
                        【知识库命中】
                        {{kb.hits}}

                        输出格式（严格遵守）：
                        结论：admit 或 reject
                        置信度：0~1 之间的小数
                        理由：一句话说明理由""");

        prompt("requirement_outline.md", "需求分析 · 概要文档", "codebuddy",
                "issue.title,issue.desc,kb.hits,repo.tree", """
                        你是资深架构师，请基于以下代码仓库上下文输出需求概要文档。

                        【需求】{{issue.title}}
                        【描述】{{issue.desc}}
                        【知识库命中】{{kb.hits}}
                        【仓库结构】{{repo.tree}}

                        输出：背景与目标 / 范围 / 关键流程 / 风险""");

        prompt("detail_design.md", "详细设计", "codebuddy",
                "issue.title,repo.path,outline.doc,kb.hits", """
                        请输出详细设计文档。

                        【需求】{{issue.title}}
                        【仓库路径】{{repo.path}}
                        【概要文档】{{outline.doc}}
                        【知识库命中】{{kb.hits}}

                        输出：方案对比 / 接口定义 / 数据结构 / 兼容性 / 测试要点""");

        prompt("fault_report.md", "问题分析 · 故障报告", "codebuddy",
                "issue.desc,log.context,repo.path", """
                        请分析以下故障并输出故障报告。

                        【现象】{{issue.desc}}
                        【日志上下文】{{log.context}}
                        【仓库路径】{{repo.path}}

                        输出：影响范围 / 根因推断 / 复现路径 / 修复建议""");

        prompt("fix_design.md", "方案设计 · 修复方案", "codebuddy",
                "issue.title,fault.doc,repo.path", """
                        请输出修复方案设计。

                        【问题】{{issue.title}}
                        【故障报告】{{fault.doc}}
                        【仓库路径】{{repo.path}}

                        输出：修复思路 / 改动点 / 回滚方案 / 验证方式""");

        prompt("coding_task.md", "编码", "责任人选定",
                "design.doc,repo.path,branch", """
                        请按设计文档完成编码。

                        【设计文档】{{design.doc}}
                        【仓库路径】{{repo.path}}
                        【分支】{{branch}}

                        约束：仅改动必要文件；不直推主干；补充单元测试""");

        prompt("test_plan.md", "测试", "责任人选定",
                "design.doc,repo.path,branch", """
                        请生成并执行测试计划。

                        【设计文档】{{design.doc}}
                        【仓库路径】{{repo.path}}
                        【分支】{{branch}}

                        要求：覆盖率不低于 80%，未达标需说明原因""");

        prompt("fix_coding.md", "编码 · 缺陷修复", "责任人选定",
                "design.doc,repo.path,branch", """
                        请按修复方案完成编码。

                        【修复方案】{{design.doc}}
                        【仓库路径】{{repo.path}}
                        【分支】{{branch}}

                        约束：最小改动；补充回归用例""");

        prompt("regression_test.md", "回归测试", "责任人选定",
                "design.doc,repo.path,branch", """
                        请执行回归测试，重点覆盖本次改动影响面。

                        【修复方案】{{design.doc}}
                        【仓库路径】{{repo.path}}
                        【分支】{{branch}}""");

        prompt("review_checklist.md", "设计评审辅助", "服务端LLM",
                "design.doc,issue.title", """
                        请按评审清单检查设计文档。

                        【需求】{{issue.title}}
                        【文档】{{design.doc}}

                        输出：是否通过 / 问题清单 / 建议""");

        prompt("workflow_gate.md", "工作流闸门判定", "服务端LLM",
                "issue.code,issue.title,node.name,node.gate,node.log", """
                        请判断该节点是否满足放行条件。

                        【Issue】{{issue.code}} {{issue.title}}
                        【节点】{{node.name}}
                        【闸门】{{node.gate}}
                        【执行日志】{{node.log}}

                        输出格式：
                        结论：pass 或 blocked
                        理由：一句话说明""");

        prompt("biz_sort.md", "业务域分拣 · 歧义裁决", "服务端LLM",
                "issue.code,issue.title,issue.desc,biz.candidates", """
                        你是研发 Issue 分拣助手。一条 Issue 只能归属一个业务域。

                        【编号】{{issue.code}}
                        【标题】{{issue.title}}
                        【描述】{{issue.desc}}

                        【候选业务域】
                        {{biz.candidates}}

                        请从候选中选出最匹配的一个。若确实无法判断，输出 unknown。

                        输出格式（严格遵守）：
                        结论：<业务域编码>
                        理由：一句话说明""");
    }

    private void prompt(String name, String scene, String backend, String vars, String content) {
        if (promptTemplateRepository.findByName(name) != null) return;
        PromptTemplateEntity p = new PromptTemplateEntity();
        p.setName(name);
        p.setScene(scene);
        p.setBackend(backend);
        p.setVariables(vars);
        p.setContent(content);
        p.setUpdatedAt(LocalDateTime.now());
        promptTemplateRepository.save(p);
    }

    private void initKb() {
        if (kbDocRepository.count() > 0) return;
        kb("快照导出规范 v2", "编码规范", 14, """
                1. 快照导出接口应支持分页参数 offset/limit，单次上限 5000 行。
                2. 大数据量场景启用流式写出（StreamingResponseBody），避免内存溢出。
                3. 导出文件统一采用 CSV 格式，表头使用英文下划线命名。
                4. 敏感字段（如客户资产）需脱敏处理，默认不下发明细。
                5. 失败重试策略：指数退避，最多 3 次，写入监控日志。""");
        kb("行情接入故障手册", "故障库", 22, """
                1. 夜盘行情丢包：首先检查 UDP 组播心跳，确认网络组播是否正常。
                2. 行情延迟突增：查看队列积压指标，必要时扩容 consumer。
                3. 快照与逐笔不一致：按 symbol + seq 对齐，缺包触发补录流程。
                4. 交易所通道切换：主备通道状态由 ChannelManager 维护，切换时广播通知。""");
        kb("回测服务设计文档", "设计文档", 31, """
                1. 回测引擎采用事件驱动架构，支持 Bar 级与 Tick 级回放。
                2. 策略接口统一为 Strategy.on_bar / on_tick / on_order，避免业务侵入。
                3. 绩效分析模块计算夏普、最大回撤、胜率，并生成 HTML 报告。
                4. 数据源支持本地 Parquet 与远程对象存储，按需懒加载。""");
        kb("账户中心接口约定", "接口文档", 18, """
                1. 账户查询统一走 /account/v1/{userId}，返回资产、持仓、委托聚合视图。
                2. 资金变动接口需幂等键 idempotency-key，防止重复入金。
                3. 密码与密钥类操作必须经 MFA 校验，并记录安全审计日志。
                4. 对外 SDK 封装 REST + gRPC 双协议。""");
        kb("发布与回滚流程", "流程规范", 9, """
                1. 发布前必须通过准入判定、代码评审、自动化测试三门禁。
                2. 灰度发布按 1% → 10% → 50% → 100% 阶梯推进，每步观察 15 分钟。
                3. 回滚触发条件：P0 告警、错误率 > 0.1%、人工一键回滚。
                4. 回滚必须在 5 分钟内完成，并通知相关责任人。""");
    }

    private void kb(String name, String cat, int chunks, String content) {
        KbDocEntity d = new KbDocEntity();
        d.setName(name);
        d.setCategory(cat);
        d.setChunks(chunks);
        d.setContent(content);
        d.setStatus("已索引");
        d.setIndexedAt(LocalDateTime.now());
        kbDocRepository.save(d);
    }

    private void initUsers() {
        if (userRepository.count() == 0) {
            user("杨德", "24988", "admin,lead", "全部", null);
            user("王磊", "25102", "dev", "行情", "dev-windows-07");
            user("李娜", "25331", "dev,qa", "行情", "dev-mac-03");
            user("陈昊", "25007", "lead,dev", "回测/指标", "dev-linux-11");
            user("赵敏", "25419", "dev", "账户", "dev-windows-09");
            user("孙悦", "25520", "qa", "资讯", "dev-mac-15");
        }
        // 存量库：roles 为空时按工号补多角色示范
        ensureRoles("24988", "admin", "lead");
        ensureRoles("25331", "dev", "qa");
        ensureRoles("25007", "lead", "dev");
    }

    /** 存量升级：roles 为空，或仅有与主角色相同的单项时，写入示范多角色 */
    private void ensureRoles(String empNo, String... roles) {
        UserEntity u = userRepository.findByEmpNo(empNo);
        if (u == null) return;
        List<String> want = List.of(roles);
        List<String> have = u.getRoles() == null ? List.of() : u.getRoles();
        boolean upgrade = have.isEmpty()
                || (have.size() == 1 && want.size() > 1 && have.get(0).equalsIgnoreCase(want.get(0)));
        if (!upgrade) return;
        u.setRoles(want);
        u.setRole(want.get(0));
        userRepository.save(u);
    }

    private void user(String name, String empNo, String role, String biz, String clientId) {
        UserEntity u = new UserEntity();
        u.setName(name);
        u.setEmpNo(empNo);
        List<String> roles = java.util.Arrays.stream(role.split(","))
                .map(String::trim).filter(s -> !s.isEmpty()).distinct().toList();
        if (roles.isEmpty()) roles = List.of("guest");
        u.setRoles(roles);
        u.setRole(roles.get(0));
        u.setBizDomain(biz);
        u.setClientId(clientId);
        userRepository.save(u);
    }

    private void initRolePermissions() {
        String[] caps = {
                "Issue 查看", "Issue 录入", "Issue 分拣", "Issue 删除",
                "工作流查看", "工作流编辑", "客户端查看", "客户端启停",
                "Agent 配置", "知识库管理", "用户管理", "权限管理"
        };
        String[][] matrix = {
                {"admin", "full", "full", "full", "full", "full", "full", "full", "full", "full", "full", "full", "full"},
                {"pm", "full", "full", "part", "none", "full", "none", "full", "none", "part", "none", "none", "none"},
                {"lead", "full", "part", "full", "none", "full", "part", "full", "part", "full", "none", "none", "none"},
                {"dev", "part", "full", "none", "none", "full", "none", "part", "none", "part", "none", "none", "none"},
                {"qa", "full", "part", "none", "none", "full", "none", "part", "none", "part", "none", "none", "none"},
                {"guest", "part", "none", "none", "none", "part", "none", "part", "none", "none", "none", "none", "none"},
        };
        // 期望条目数 = 角色数 × 能力数；不一致（含改过能力项）时整体重建，避免残留半套数据
        long expected = (long) matrix.length * caps.length;
        if (rolePermissionRepository.count() == expected) return;
        rolePermissionRepository.deleteAll();
        for (String[] row : matrix) {
            String role = row[0];
            for (int i = 0; i < caps.length; i++) {
                rolePerm(role, caps[i], i + 1 < row.length ? row[i + 1] : "none");
            }
        }
    }

    private void rolePerm(String role, String cap, String level) {
        RolePermissionEntity rp = new RolePermissionEntity();
        rp.setRole(role);
        rp.setCapability(cap);
        rp.setLevel(level);
        rolePermissionRepository.save(rp);
    }

    /**
     * LLM 通道：公网（准入 / 分拣 / QA）与私有化（涉代码场景）。
     * 按 channel 逐条补齐，已存在的记录不覆盖 —— 控制台上改过的配置优先级高于 yml 默认值。
     */
    private void initLlmConfigs() {
        llmChannel(LlmConfigEntity.PUBLIC, "公网通道", dftPublicProvider, dftPublicBaseUrl, dftPublicApiKey,
                dftPublicModel, 0.2, 60, true, false);
        llmChannel(LlmConfigEntity.PRIVATE, "私有化通道", "openai-compatible", dftPrivateBaseUrl, null,
                dftPrivateModel, 0.1, 120, dftPrivateEnabled, true);
    }

    private void llmChannel(String channel, String label, String provider, String baseUrl, String apiKey,
                            String model, Double temperature, Integer timeout, boolean enabled, boolean privateOnly) {
        if (llmConfigRepository.findByChannel(channel) != null) return;
        LlmConfigEntity c = new LlmConfigEntity();
        c.setChannel(channel);
        c.setLabel(label);
        c.setProvider(provider);
        c.setBaseUrl(baseUrl);
        c.setApiKey(apiKey);
        c.setModel(model);
        c.setTemperature(temperature);
        c.setTimeoutSeconds(timeout);
        c.setEnabled(enabled);
        c.setPrivateOnly(privateOnly);
        c.setUpdatedAt(LocalDateTime.now());
        c.setUpdatedBy("init");
        llmConfigRepository.save(c);
    }

    /**
     * Agent 配置不再由服务端预设默认目录。
     *
     * 旧版在此种 GLOBAL 的 claude/cursor/codex/codebuddy 四条记录，merged() 永远先叠它们，
     * 导致管理端「Coding Agent 配置」页在每个客户端作用域都显示 4 个"默认后端"，与用户实际配置脱节。
     * 新模型：每个用户（设置面板）自行配置自己的 Coding Agent，服务端只采集、汇总、下发；
     * agent_config 这张"全局/客户端覆盖"表已废弃，这里清空残留数据，避免旧默认继续生效。
     */
    private void initAgentConfigs() {
        long n = agentConfigRepository.count();
        if (n > 0) {
            log.info("清空已废弃的 agent_config 表（{} 条）；Coding Agent 改由用户个人配置驱动", n);
            agentConfigRepository.deleteAll();
        }
    }

    /** 业务域：分拣的第一依据，业务/开发双负责人 / 优先级 / 敏感等级都在这里 */
    private void initBizDomains() {
        if (bizDomainRepository.count() == 0) {
            biz(null, "quote", "行情", "行情,quote,K线,盘口,组播,延迟,丢包,订阅,分发",
                    "杨德,王磊", "王磊,李娜", "P1", null, "普通", 8,
                    "实时行情接入、订阅分发与主备通道切换");
            biz(null, "backtest", "回测·指标", "回测,backtest,策略,夏普,回撤,胜率,绩效,因子,指标",
                    "杨德", "陈昊,王磊", "P1", "dev-linux-11", "普通", 16,
                    "回测引擎、绩效分析与指标计算");
            biz(null, "account", "账户", "账户,登录,资金,持仓,委托,入金,资产,密码,MFA",
                    "李娜", "赵敏,陈昊", "P0", "dev-windows-09", "核心", 4,
                    "账户中心与资金变动；核心业务，仅走私有化后端");
            biz(null, "research", "资讯", "研报,资讯,新闻,公告,披露,舆情",
                    "孙悦", "孙悦", "P2", "dev-mac-15", "普通", 24,
                    "研报检索、公告与资讯采集");
        }
        initBizHierarchy();
    }

    /**
     * 业务域层级示例：行情下挂「快照导出」「逐笔链路」两个子域。
     *
     * <p>子域只配编码 / 关键词 / 负责人与 SLA，仓库、优先级、敏感等级全部继承父域 ——
     * 演示「细分到子业务域，但共用同一套工程配置」。同时把「快照 / 逐笔」这类更具体的关键词
     * 从父域下放到子域，配合分拣引擎的「子域优先」收敛，避免父子同时命中造成伪歧义。
     */
    private void initBizHierarchy() {
        if (bizDomainRepository.findByCode("quote-snapshot") != null) return;

        BizDomainEntity parent = bizDomainRepository.findByCode("quote");
        if (parent != null && parent.getKeywords() != null && parent.getKeywords().contains("快照")) {
            parent.setKeywords("行情,quote,K线,盘口,组播,延迟,丢包,订阅,分发");
            parent.setUpdatedAt(LocalDateTime.now());
            bizDomainRepository.save(parent);
        }

        biz("quote", "quote-snapshot", "行情·快照导出",
                "快照,snapshot,导出,分页,offset,limit,CSV",
                "王磊", "王磊,李娜", null, null, null, 8,
                "快照导出接口与批量落盘；复用行情工程，仅关键词与负责人独立");
        biz("quote", "quote-tick", "行情·逐笔链路",
                "逐笔,tick,成交明细,委托队列,seq,补录",
                "李娜", "李娜,王磊", null, null, null, 12,
                "逐笔回放与补录链路；复用行情工程");
    }

    private void biz(String parentCode, String code, String name, String keywords, String bizOwners,
                     String devOwners, String priority, String clientId, String level, int sla, String desc) {
        BizDomainEntity d = new BizDomainEntity();
        d.setCode(code);
        d.setParentCode(parentCode);
        d.setName(name);
        d.setKeywords(keywords);
        d.setBizOwners(bizOwners);
        d.setDevOwners(devOwners);
        d.setDefaultPriority(priority);
        d.setDefaultClientId(clientId);
        d.setSensitiveLevel(level);
        d.setSlaHours(sla);
        d.setEnabled(true);
        d.setDescription(desc);
        d.setUpdatedAt(LocalDateTime.now());
        bizDomainRepository.save(d);
    }

    /** 仓库：承载 git 地址、分支策略与构建/测试命令；与业务域的绑定写在业务域侧（repoProject） */
    private void initRepos() {
        if (repoRepository.count() > 0) return;
        repo("quote-service", "quote", "git@git.yonyong.dev:quote/quote-service.git", "feature/",
                "mvn -DskipTests package", false, null, "dev-windows-07",
                "行情快照、逐笔与订阅分发服务");
        repo("backtest-api", "backtest", "git@git.yonyong.dev:backtest/backtest-api.git", "feature/",
                "mvn -DskipTests package", false, null, "dev-linux-11",
                "回测引擎与绩效分析 API");
        repo("account-center", "account", "git@git.yonyong.dev:account/account-center.git", "fix/",
                "mvn -DskipTests package", true, "codebuddy", "dev-windows-09",
                "账户中心；敏感仓库，仅允许内网客户端与私有化后端执行");
        repo("research-search", "research", "git@git.yonyong.dev:research/research-search.git", "feature/",
                "mvn -DskipTests package", false, null, "dev-mac-15",
                "研报检索与资讯采集服务");
    }

    private void repo(String project, String bizCode, String url, String prefix, String build,
                      boolean sensitive, String requiredBackend, String clientId, String desc) {
        RepoEntity r = new RepoEntity();
        r.setProject(project);
        r.setRepoUrl(url);
        r.setBaselineBranch("main");
        r.setBranchPrefix(prefix);
        r.setLanguage("Java");
        r.setBuildCmd(build);
        r.setTestCmd("mvn test");
        r.setSensitive(sensitive);
        r.setRequiredBackend(requiredBackend);
        r.setDefaultClientId(clientId);
        r.setEnabled(true);
        r.setDescription(desc);
        r.setUpdatedAt(LocalDateTime.now());
        repoRepository.save(r);

        // 绑定写在业务域侧：bizCode 参数语义为「该仓库默认服务的业务域」
        BizDomainEntity d = bizDomainRepository.findByCode(bizCode);
        if (d != null) {
            d.setRepoProject(project);
            d.setUpdatedAt(LocalDateTime.now());
            bizDomainRepository.save(d);
        }
    }

    /**
     * 旧版把「业务域 ↔ 仓库」绑定存在仓库表（t_repo.bizCode，唯一），只能一仓一域；
     * 新版绑定存在业务域侧（t_biz_domain.repoProject），一仓可服务多域。
     * 每次启动幂等迁移：有旧值就搬到对应业务域并清空旧列。
     */
    private void migrateRepoBizBinding() {
        for (RepoEntity r : repoRepository.findAll()) {
            String bc = r.getBizCode();
            if (bc == null || bc.isBlank()) continue;
            r.setBizCode(null);
            BizDomainEntity d = bizDomainRepository.findByCode(bc.trim());
            if (d != null && (d.getRepoProject() == null || d.getRepoProject().isBlank())) {
                d.setRepoProject(r.getProject());
                d.setUpdatedAt(LocalDateTime.now());
                bizDomainRepository.save(d);
            }
            repoRepository.save(r);
            log.info("仓库绑定迁移：{} 的业务域 {} 迁至 t_biz_domain.repoProject", r.getProject(), bc.trim());
        }
    }
}
