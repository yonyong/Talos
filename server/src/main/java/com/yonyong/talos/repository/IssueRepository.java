package com.yonyong.talos.repository;

import com.yonyong.talos.entity.IssueEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface IssueRepository extends JpaRepository<IssueEntity, Long> {
    IssueEntity findByCode(String code);
    List<IssueEntity> findByStatus(String status);
    List<IssueEntity> findByOwner(String owner);
    List<IssueEntity> findByType(String type);
}
