package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/** AI 调用日志：含变量替换后的最终 Prompt，服务端可观测 */
@Data
@Entity
@Table(name = "t_ai_call_log", indexes = { @Index(name = "idx_log_issue", columnList = "issueCode") })
public class AiCallLogEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 32)
    private String issueCode;

    @Column(length = 64)
    private String node;

    @Column(length = 32)
    private String backend;

    @Column(length = 64)
    private String model;

    private Long tokenUsed;

    private java.math.BigDecimal cost;

    private Long latencyMs;

    /** 变量替换后的最终 Prompt */
    @Column(columnDefinition = "TEXT")
    private String renderedPrompt;

    /** LLM 返回的原始输出 */
    @Column(columnDefinition = "TEXT")
    private String renderedResponse;

    /** 模板是否命中全部变量 */
    private Boolean missingVars;

    @Column(length = 64)
    private String clientId;

    private LocalDateTime createdAt;

    @PrePersist
    public void prePersist() { this.createdAt = LocalDateTime.now(); }
}
