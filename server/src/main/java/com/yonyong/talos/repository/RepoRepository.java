package com.yonyong.talos.repository;

import com.yonyong.talos.entity.RepoEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RepoRepository extends JpaRepository<RepoEntity, Long> {

    List<RepoEntity> findByEnabledTrueOrderByProjectAsc();

    RepoEntity findByProject(String project);
}
