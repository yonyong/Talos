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
}
