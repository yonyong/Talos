package com.yonyong.talos.service;

import com.yonyong.talos.entity.*;
import com.yonyong.talos.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/** 首次启动初始化：两套工作流模板、Prompt 模板、知识库、用户与默认 Agent 配置 */
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

    @Override
    public void run(String... args) {
        initTemplates();
        initPrompts();
        initKb();
        initUsers();
        initRolePermissions();
        initAgentConfigs();
        log.info("初始化完成：模板 {} 套 · Prompt {} 个 · 知识库 {} 篇 · 用户 {} 个 · 角色权限 {} 条",
                templateRepository.count(), promptTemplateRepository.count(),
                kbDocRepository.count(), userRepository.count(), rolePermissionRepository.count());
    }

    private void initTemplates() {
        if (templateRepository.count() > 0) return;
        templateRepository.save(tpl("REQ", "需求工作流", """
                [
                  {"step":1,"name":"拉取 Git","kind":"git","execLocation":"客户端","backend":"—","promptTemplate":"—","gate":"—"},
                  {"step":2,"name":"需求分析","kind":"doc","execLocation":"客户端","backend":"codebuddy","promptTemplate":"requirement_outline.md","gate":"—"},
                  {"step":3,"name":"详细设计","kind":"doc","execLocation":"客户端","backend":"codebuddy","promptTemplate":"detail_design.md","gate":"—"},
                  {"step":4,"name":"设计评审","kind":"rev","execLocation":"服务端","backend":"—","promptTemplate":"review_checklist.md","gate":"人工闸门"},
                  {"step":5,"name":"编码","kind":"code","execLocation":"客户端","backend":"责任人选定","promptTemplate":"coding_task.md","gate":"分支隔离"},
                  {"step":6,"name":"测试","kind":"test","execLocation":"客户端","backend":"责任人选定","promptTemplate":"test_plan.md","gate":"覆盖率门禁"},
                  {"step":7,"name":"验收","kind":"rev","execLocation":"服务端","backend":"—","promptTemplate":"—","gate":"人工闸门"}
                ]"""));
        templateRepository.save(tpl("BUG", "缺陷工作流", """
                [
                  {"step":1,"name":"拉取 Git","kind":"git","execLocation":"客户端","backend":"—","promptTemplate":"—","gate":"—"},
                  {"step":2,"name":"问题分析","kind":"doc","execLocation":"客户端","backend":"codebuddy","promptTemplate":"fault_report.md","gate":"—"},
                  {"step":3,"name":"方案设计","kind":"doc","execLocation":"客户端","backend":"codebuddy","promptTemplate":"fix_design.md","gate":"—"},
                  {"step":4,"name":"设计评审","kind":"rev","execLocation":"服务端","backend":"—","promptTemplate":"review_checklist.md","gate":"人工闸门"},
                  {"step":5,"name":"编码","kind":"code","execLocation":"客户端","backend":"责任人选定","promptTemplate":"fix_coding.md","gate":"分支隔离"},
                  {"step":6,"name":"测试","kind":"test","execLocation":"客户端","backend":"责任人选定","promptTemplate":"regression_test.md","gate":"覆盖率门禁"},
                  {"step":7,"name":"验收","kind":"rev","execLocation":"服务端","backend":"—","promptTemplate":"—","gate":"人工闸门"}
                ]"""));
    }

    private WorkflowTemplate tpl(String code, String name, String json) {
        WorkflowTemplate t = new WorkflowTemplate();
        t.setCode(code);
        t.setName(name);
        t.setNodeCount(7);
        t.setDefinitionJson(json);
        t.setEnabled(true);
        t.setUpdatedAt(LocalDateTime.now());
        return t;
    }

    private void initPrompts() {
        if (promptTemplateRepository.count() > 0) return;
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
    }

    private void prompt(String name, String scene, String backend, String vars, String content) {
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
        if (userRepository.count() > 0) return;
        user("杨德", "24988", "admin", "全部", null);
        user("王磊", "25102", "dev", "行情", "dev-windows-07");
        user("李娜", "25331", "dev", "行情", "dev-mac-03");
        user("陈昊", "25007", "lead", "回测/指标", "dev-linux-11");
        user("赵敏", "25419", "dev", "账户", "dev-windows-09");
        user("孙悦", "25520", "qa", "资讯", "dev-mac-15");
    }

    private void user(String name, String empNo, String role, String biz, String clientId) {
        UserEntity u = new UserEntity();
        u.setName(name);
        u.setEmpNo(empNo);
        u.setRole(role);
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

    private void initAgentConfigs() {
        if (agentConfigRepository.count() > 0) return;
        cfg(ConfigService.GLOBAL, "claude", "claude-opus-4", true, 200_000L, new BigDecimal("1200"), 72, false);
        cfg(ConfigService.GLOBAL, "cursor", "cursor-pro", true, 200_000L, new BigDecimal("400"), 18, false);
        cfg(ConfigService.GLOBAL, "codex", "codex-1", false, 100_000L, new BigDecimal("300"), 0, false);
        cfg(ConfigService.GLOBAL, "codebuddy", "cb-internal", true, 0L, BigDecimal.ZERO, 0, true);
    }

    private void cfg(String scope, String backend, String model, boolean enabled,
                     Long tokenLimit, BigDecimal quota, int usage, boolean privateOnly) {
        AgentConfigEntity c = new AgentConfigEntity();
        c.setScope(scope);
        c.setBackend(backend);
        c.setModel(model);
        c.setEnabled(enabled);
        c.setTokenLimit(tokenLimit);
        c.setMonthlyQuota(quota);
        c.setUsagePercent(usage);
        c.setPrivateOnly(privateOnly);
        c.setUpdatedAt(LocalDateTime.now());
        agentConfigRepository.save(c);
    }
}
