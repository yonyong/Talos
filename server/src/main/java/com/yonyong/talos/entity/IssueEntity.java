package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDate;
import java.time.LocalDateTime;

/** Issue：一条研发诉求或缺陷 */
@Data
@Entity
@Table(name = "t_issue", indexes = { @Index(name = "idx_issue_code", columnList = "code") })
public class IssueEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false, length = 32)
    private String code;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(length = 64)
    private String biz;

    /** REQ / BUG */
    @Column(length = 8)
    private String type;

    @Column(length = 64)
    private String owner;

    /** 提出人 */
    @Column(length = 64)
    private String reporter;

    private LocalDate dueDate;

    /** P0 / P1 / P2 */
    @Column(length = 8)
    private String priority;

    /** admitting / admitted / rejected / sorting / running / blocked / reviewing / done / closed */
    @Column(length = 24)
    private String status;

    /** 关闭原因（人工关闭时填写） */
    @Column(length = 500)
    private String closeReason;

    @Column(length = 4000)
    private String description;

    /** 分拣结果：项目与仓库 */
    @Column(length = 128)
    private String project;

    @Column(length = 256)
    private String repoUrl;

    /** 业务域编码（分拣第一依据，对应 t_biz_domain.code） */
    @Column(length = 32)
    private String bizCode;

    /** 工作分支：由仓库的 branchPrefix + code 生成 */
    @Column(length = 128)
    private String branch;

    /** 分拣方式：auto（关键词唯一命中）/ llm（歧义裁决）/ manual（人工指定）/ none（待人工） */
    @Column(length = 16)
    private String sortMethod;

    /** 分拣依据说明，供人工复核 */
    @Column(length = 2000)
    private String sortReason;

    /** 歧义候选业务域编码，逗号分隔 */
    @Column(length = 512)
    private String candidateBiz;

    @Column(length = 64)
    private String clientId;

    /** 准入结论：admit / reject / pending */
    @Column(length = 16)
    private String admissionResult;

    private Double confidence;

    @Column(length = 4000)
    private String admissionReason;

    @Column(length = 2000)
    private String kbHits;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    @PrePersist
    public void prePersist() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = this.createdAt;
        if (this.status == null) this.status = "admitting";
    }

    @PreUpdate
    public void preUpdate() { this.updatedAt = LocalDateTime.now(); }
}
