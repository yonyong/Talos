package com.yonyong.talos.repository;

import com.yonyong.talos.entity.UserSettingEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserSettingRepository extends JpaRepository<UserSettingEntity, Long> {
    UserSettingEntity findByEmpNo(String empNo);
}
