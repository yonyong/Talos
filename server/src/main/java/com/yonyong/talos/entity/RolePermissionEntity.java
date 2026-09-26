package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;

/** 角色能力矩阵：每个角色对每个能力的权限级别 */
@Data
@Entity
@Table(name = "t_role_permission", uniqueConstraints = {
        @UniqueConstraint(columnNames = {"role", "capability"})
})
public class RolePermissionEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** admin / pm / lead / dev / qa / guest */
    @Column(length = 16, nullable = false)
    private String role;

    /** 能力标识 */
    @Column(length = 64, nullable = false)
    private String capability;

    /** full / part / none */
    @Column(length = 8, nullable = false)
    private String level;
}
