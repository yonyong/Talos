package com.yonyong.talos.repository;

import com.yonyong.talos.entity.WorkflowTemplate;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WorkflowTemplateRepository extends JpaRepository<WorkflowTemplate, Long> {
    WorkflowTemplate findByCode(String code);
}
