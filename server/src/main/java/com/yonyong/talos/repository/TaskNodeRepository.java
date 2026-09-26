package com.yonyong.talos.repository;

import com.yonyong.talos.entity.TaskNodeEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface TaskNodeRepository extends JpaRepository<TaskNodeEntity, Long> {
    List<TaskNodeEntity> findByInstanceCodeOrderByStepAsc(String instanceCode);
}
