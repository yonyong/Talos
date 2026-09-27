package com.yonyong.talos.repository;

import com.yonyong.talos.entity.LlmConfigEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LlmConfigRepository extends JpaRepository<LlmConfigEntity, Long> {

    LlmConfigEntity findByChannel(String channel);
}
