package com.yonyong.talos.repository;

import com.yonyong.talos.entity.AiCallLogEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface AiCallLogRepository extends JpaRepository<AiCallLogEntity, Long> {
    List<AiCallLogEntity> findByIssueCode(String issueCode);
    List<AiCallLogEntity> findTop100ByOrderByCreatedAtDesc();
}
