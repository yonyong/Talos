package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/** Coding Agent 配置：服务端统管，按客户端差异化覆盖 */
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

    /** 单任务 token 限额 */
    private Long tokenLimit;

    /** 月度费用限额（元） */
    private java.math.BigDecimal monthlyQuota;

    /** HTTP LLM 接入地址（OpenAI 兼容格式） */
    @Column(length = 256)
    private String httpEndpoint;

    /** API Key（生产环境建议加密存储） */
    @Column(length = 256)
    private String apiKey;

    /** 采样温度 */
    private Double temperature;

    /** 已用百分比 */
    private Integer usagePercent;

    /** 是否仅允许私有化（敏感场景） */
    private Boolean privateOnly;

    private LocalDateTime updatedAt;
}
