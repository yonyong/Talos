package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 服务端 LLM 通道配置（API 形式的模型）。
 *
 * <p>两条通道，各自一条记录：
 * <ul>
 *   <li>PUBLIC  —— 公网通道，承载准入判定 / 业务域分拣 / 通用 QA，不涉及代码</li>
 *   <li>PRIVATE —— 私有化通道，承载涉及代码的分析 / 编码 / 文档生成，默认不出内网</li>
 * </ul>
 *
 * <p>所有字段落库，配置变更即时生效（LlmService 按需构建客户端并缓存）。
 * 接口对外返回时会脱敏 apiKey，避免密钥回传到浏览器。
 */
@Data
@Entity
@Table(name = "t_llm_config", indexes = { @Index(name = "idx_llm_channel", columnList = "channel") })
public class LlmConfigEntity {

    public static final String PUBLIC = "PUBLIC";
    public static final String PRIVATE = "PRIVATE";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** PUBLIC / PRIVATE，一通道一条 */
    @Column(unique = true, nullable = false, length = 16)
    private String channel;

    /** 展示名，如「公网通道」 */
    @Column(length = 64)
    private String label;

    /** qwen | zhipu | openai-compatible —— 决定默认 baseUrl 与鉴权方式 */
    @Column(length = 32)
    private String provider;

    /** OpenAI 兼容的 /chat/completions 基址，如 https://dashscope.aliyuncs.com/compatible-mode/v1 */
    @Column(length = 256)
    private String baseUrl;

    /** 密钥。为空表示未接入，调用时降级 */
    @Column(length = 512)
    private String apiKey;

    /** 模型名，如 qwen-max / glm-4 / cb-internal */
    @Column(length = 128)
    private String model;

    /** 采样温度。结构化输出场景建议 0~0.3 */
    private Double temperature;

    /** 单次调用超时（秒） */
    private Integer timeoutSeconds;

    /** 通道是否启用。停用后该通道调用一律降级 */
    private Boolean enabled;

    /** 私有化通道有意义：为 true 时禁止公网出站 */
    private Boolean privateOnly;

    /** 最近一次连通性测试结果，供页面展示 */
    @Column(length = 256)
    private String lastTestResult;

    private LocalDateTime lastTestAt;

    private LocalDateTime updatedAt;

    @Column(length = 64)
    private String updatedBy;
}
