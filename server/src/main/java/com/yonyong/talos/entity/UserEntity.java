package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;

/** 用户与角色：RBAC 按业务域鉴权 */
@Data
@Entity
@Table(name = "t_user")
public class UserEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 64)
    private String name;

    @Column(unique = true, length = 32)
    private String empNo;

    /** admin / pm / lead / dev / qa / guest */
    @Column(length = 16)
    private String role;

    @Column(length = 128)
    private String bizDomain;

    @Column(length = 64)
    private String clientId;
}
