package com.yonyong.talos.repository;

import com.yonyong.talos.entity.PromptTemplateEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface PromptTemplateRepository extends JpaRepository<PromptTemplateEntity, Long> {
    PromptTemplateEntity findByName(String name);
    List<PromptTemplateEntity> findByBackend(String backend);
}
