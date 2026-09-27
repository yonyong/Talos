package com.yonyong.talos.repository;

import com.yonyong.talos.entity.BizDomainEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface BizDomainRepository extends JpaRepository<BizDomainEntity, Long> {

    List<BizDomainEntity> findByEnabledTrueOrderByCodeAsc();

    BizDomainEntity findByCode(String code);

    BizDomainEntity findByName(String name);

    /** 仓库 → 业务域列表：一个仓库可被多个业务域指向 */
    List<BizDomainEntity> findByRepoProject(String repoProject);
}
