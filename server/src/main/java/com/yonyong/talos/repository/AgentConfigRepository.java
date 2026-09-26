package com.yonyong.talos.repository;

import com.yonyong.talos.entity.AgentConfigEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface AgentConfigRepository extends JpaRepository<AgentConfigEntity, Long> {
    List<AgentConfigEntity> findByScope(String scope);
    AgentConfigEntity findByScopeAndBackend(String scope, String backend);
}
