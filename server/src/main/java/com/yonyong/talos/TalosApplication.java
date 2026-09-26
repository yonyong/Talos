package com.yonyong.talos;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Talos 服务端：Issue 录入、准入判定、分拣、工作流编排与任务下发 */
@EnableScheduling
@SpringBootApplication
public class TalosApplication {
    public static void main(String[] args) {
        SpringApplication.run(TalosApplication.class, args);
    }
}
