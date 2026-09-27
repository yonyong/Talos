package com.yonyong.talos.repository;

import com.yonyong.talos.entity.UserAgentEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface UserAgentRepository extends JpaRepository<UserAgentEntity, Long> {
    /** 按优先级排序取该用户的 Agent 配置（sortOrder 相同按 id 兜底，保证顺序稳定） */
    List<UserAgentEntity> findByEmpNoOrderBySortOrderAscIdAsc(String empNo);

    void deleteByEmpNo(String empNo);
}
