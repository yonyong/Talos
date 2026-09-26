package com.yonyong.talos.service;

/** 客户端连接的抽象出口：gRPC 双向流适配此接口，服务端顺流推送指令 */
@FunctionalInterface
public interface ClientSink {
    void send(Object message);

    /** 关闭底层流，默认不做处理 */
    default void close() { }
}
