package com.yonyong.talos.controller;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 登录链路专用异常：需要精确区分 HTTP 语义，不能都落 400/409。
 *
 * <ul>
 *   <li>400 邮箱非法 / 授权码错误 / 邮箱未绑定账号</li>
 *   <li>401 token 缺失或失效（未登录）</li>
 *   <li>429 发信过于频繁 / 试错次数超限</li>
 *   <li>502 授权码邮件发送失败（下游 SMTP 的问题，不是调用方参数错）</li>
 * </ul>
 * 统一由 {@link GlobalExceptionHandler} 以 {"message": "..."} 返回，前端可直接展示。
 */
@Getter
public class AuthException extends RuntimeException {

    private final HttpStatus status;

    private AuthException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public static AuthException badRequest(String message) {
        return new AuthException(HttpStatus.BAD_REQUEST, message);
    }

    public static AuthException unauthorized(String message) {
        return new AuthException(HttpStatus.UNAUTHORIZED, message);
    }

    public static AuthException tooMany(String message) {
        return new AuthException(HttpStatus.TOO_MANY_REQUESTS, message);
    }

    public static AuthException mailFailed(String message) {
        return new AuthException(HttpStatus.BAD_GATEWAY, message);
    }
}
