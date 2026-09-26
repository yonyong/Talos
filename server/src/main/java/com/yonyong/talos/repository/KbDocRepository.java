package com.yonyong.talos.repository;

import com.yonyong.talos.entity.KbDocEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface KbDocRepository extends JpaRepository<KbDocEntity, Long> {
    List<KbDocEntity> findByNameContainingIgnoreCase(String name);
    List<KbDocEntity> findByStatus(String status);
    KbDocEntity findByName(String name);
}
