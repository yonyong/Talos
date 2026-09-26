package com.yonyong.talos.repository;

import com.yonyong.talos.entity.WorkflowInstance;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface WorkflowInstanceRepository extends JpaRepository<WorkflowInstance, Long> {
    WorkflowInstance findByInstanceCode(String instanceCode);
    List<WorkflowInstance> findByIssueCode(String issueCode);
    List<WorkflowInstance> findByStatus(String status);
}
