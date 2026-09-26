package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/** Prompt 模板：全部落库，变量由系统注入，禁止硬编码 */
@Data
@Entity
@Table(name = "t_prompt_template")
public class PromptTemplateEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, length = 128)
    private String name;

    @Column(length = 128)
    private String scene;

    @Column(length = 32)
    private String backend;

    /** 逗号分隔的变量名，如 issue.title,repo.path,kb.hits */
    @Column(length = 512)
    private String variables;

    /** 模板正文，使用 {{var}} 占位 */
    @Column(columnDefinition = "TEXT")
    private String content;

    private LocalDateTime updatedAt;
}
