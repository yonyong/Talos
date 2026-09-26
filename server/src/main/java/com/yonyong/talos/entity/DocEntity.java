package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/** 过程文档：客户端生成后回传服务端，集中可见 */
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

    /** 概要 / 详设 / 故障报告 / 修复方案 / 测试报告 */
    @Column(length = 32)
    private String kind;

    @Column(length = 128)
    private String source;

    @Column(length = 32)
    private String sizeText;

    @Column(columnDefinition = "TEXT")
    private String content;

    @Column(length = 64)
    private String clientId;

    private LocalDateTime createdAt;

    @PrePersist
    public void prePersist() { this.createdAt = LocalDateTime.now(); }
}
