package com.yonyong.talos.service;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 静默升级指令的构造入口。
 *
 * 服务端在两个地方会下发它：客户端上线时版本落后（自动），以及控制台手工点「升级」。
 * 两处共用同一构造逻辑，避免字段名走偏。
 */
public final class UpgradeCommand {

    public static final String NAME = "UPGRADE";

    public static Map<String, Object> build(AgentReleaseService.Release release) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("command", NAME);
        m.put("version", release.version());
        m.put("url", release.downloadUrl());
        m.put("sha256", release.sha256());
        m.put("size", release.size());
        m.put("restart", true);
        return m;
    }

    private UpgradeCommand() { }
}
