package com.yonyong.talos.repository;

import com.yonyong.talos.entity.DocEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface DocRepository extends JpaRepository<DocEntity, Long> {
    List<DocEntity> findByIssueCode(String issueCode);
    List<DocEntity> findByKind(String kind);
}
