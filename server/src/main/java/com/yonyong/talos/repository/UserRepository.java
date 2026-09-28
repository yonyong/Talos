package com.yonyong.talos.repository;

import com.yonyong.talos.entity.UserEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface UserRepository extends JpaRepository<UserEntity, Long> {
    UserEntity findByEmpNo(String empNo);
    List<UserEntity> findByRole(String role);
    /** 按姓名找用户：Issue 的提出人/责任人存的是姓名，自动启动开关按姓名反查工号 */
    UserEntity findFirstByName(String name);
    /** 按客户端找绑定用户：个人设置（Agent 覆盖 / Git 凭据）下发时定位 */
    List<UserEntity> findByClientId(String clientId);
    /** 按登录邮箱找用户：授权码登录的身份来源（邮箱大小写不敏感，由调用方统一小写） */
    UserEntity findFirstByEmailIgnoreCase(String email);
    /** 校验邮箱是否已被其他用户占用（新增/编辑用户时用） */
    UserEntity findFirstByEmailIgnoreCaseAndIdNot(String email, Long id);
}
