package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 文档：既包括工作流过程中客户端回传的产物（PROCESS），
 * 也包括 Issue 提出时由提出人直接上传的原始材料（RAW，如截图、日志、需求稿）。
 */
@Data
@Entity
@Table(name = "t_document")
public class DocEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 32)
    private String issueCode;

    @Column(length = 200)
    private String name;

    /** 概要 / 详设 / 故障报告 / 修复方案 / 测试报告 / 原始材料 */
    @Column(length = 32)
    private String kind;

    /** RAW = 提出人上传的原始材料；PROCESS = 工作流执行过程产出（含客户端回传） */
    @Column(length = 16)
    private String category = "PROCESS";

    @Column(length = 128)
    private String source;

    @Column(length = 32)
    private String sizeText;

    /** 精确字节数：上传文件时使用，过程文档可能只有 sizeText */
    private Long sizeBytes;

    /** 文件落盘相对路径（data/docs 之下）；为空表示仅存文本 */
    @Column(length = 512)
    private String storedPath;

    @Column(length = 128)
    private String mimeType;

    /** 上传者（原始材料为提出人姓名；过程文档为空，由 clientId 标识来源） */
    @Column(length = 64)
    private String uploader;

    @Column(columnDefinition = "TEXT")
    private String content;

    @Column(length = 64)
    private String clientId;

    private LocalDateTime createdAt;

    @PrePersist
    public void prePersist() {
        this.createdAt = LocalDateTime.now();
        if (this.category == null || this.category.isBlank()) this.category = "PROCESS";
    }
}
