package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * Coding Agent 配置：服务端统管，按客户端差异化覆盖。
 * 执行方式为「调用客户端本地 CLI / 内部 SDK」——服务端只下发可执行路径与参数模板，
 * 不持有也不下发任何模型密钥（服务端自身 LLM 走 application.yml 的 talos.llm）。
 */
@Data
@Entity
@Table(name = "t_agent_config")
public class AgentConfigEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 作用范围：GLOBAL 或具体 clientId */
    @Column(length = 64)
    private String scope;

    /** claude / cursor / codex / codebuddy */
    @Column(length = 32)
    private String backend;

    @Column(length = 64)
    private String model;

    private Boolean enabled;

    /** 执行方式：CLI = 本地命令行 / SDK = 内部私有化 SDK */
    @Column(length = 16)
    private String transport;

    /** CLI 可执行文件路径或命令名，如 claude / Cursor.exe / /usr/local/bin/codex */
    @Column(length = 256)
    private String execPath;

    /** 启动参数模板，支持 {prompt} {repo} {branch} {model} 占位符 */
    @Column(length = 512)
    private String argsTemplate;

    /** 执行工作目录（相对仓库根，默认 . ） */
    @Column(length = 256)
    private String workDir;

    /** 附加环境变量，格式 KEY=VALUE;KEY2=VALUE2 */
    @Column(length = 512)
    private String envVars;

    /** 客户端要求的最低 agent 版本，低于此值拒绝执行并告警 */
    @Column(length = 32)
    private String minVersion;

    /** 单日 token 限额（0 = 不限） */
    private Long tokenLimit;

    /** 月度费用限额（元） */
    private java.math.BigDecimal monthlyQuota;

    /** 已用百分比 */
    private Integer usagePercent;

    /** 是否仅允许私有化（敏感场景） */
    private Boolean privateOnly;

    private LocalDateTime updatedAt;
}
