package com.yonyong.talos.repository;

import com.yonyong.talos.entity.ClientEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ClientRepository extends JpaRepository<ClientEntity, Long> {
    ClientEntity findByClientId(String clientId);
    List<ClientEntity> findByStatus(String status);
}
