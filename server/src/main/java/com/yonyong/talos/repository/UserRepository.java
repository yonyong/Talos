package com.yonyong.talos.repository;

import com.yonyong.talos.entity.UserEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface UserRepository extends JpaRepository<UserEntity, Long> {
    UserEntity findByEmpNo(String empNo);
    List<UserEntity> findByRole(String role);
}
