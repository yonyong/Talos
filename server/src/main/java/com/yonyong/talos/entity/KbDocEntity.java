package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/** 知识库文档：准入判定与项目分拣的知识来源 */
@Data
@Entity
@Table(name = "t_kb_doc")
public class KbDocEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 200)
    private String name;

    @Column(length = 64)
    private String category;

    private Integer chunks;

    /** 已索引 / 索引中 / 失败 */
    @Column(length = 16)
    private String status;

    /** 文档原始内容（摘要或全文，用于详情查看） */
    @Column(columnDefinition = "TEXT")
    private String content;

    /** 向量化后的向量（JSON 数组，生产环境建议 pgvector） */
    @Column(columnDefinition = "TEXT")
    private String embeddingJson;

    private LocalDateTime indexedAt;
}
