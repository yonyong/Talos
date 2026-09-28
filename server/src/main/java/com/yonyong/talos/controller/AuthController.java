package com.yonyong.talos.controller;

import com.yonyong.talos.service.AuthService;
import com.yonyong.talos.service.AuthSessionService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 控制台登录：邮箱 + 邮件授权码。
 *
 * <pre>
 * POST /api/auth/send-code  {email}        下发授权码到该邮箱
 * POST /api/auth/verify     {email, code}  校验授权码，成功返回会话 token
 * GET  /api/auth/me                        当前登录用户（需 token）
 * POST /api/auth/logout                    注销当前会话（需 token）
 * </pre>
 *
 * send-code / verify 是白名单（登录前当然没有 token），其余 /api/** 一律要求携带 token。
 */
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    /** 下发授权码。force=true 用于「重新发送」（要新邮件），缺省为幂等取码（有效期内沿用上一条） */
    @PostMapping("/send-code")
    public Map<String, Object> sendCode(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) throw AuthException.badRequest("请求缺少 email 参数");
        Object email = body.get("email");
        return authService.sendCode(email == null ? null : String.valueOf(email),
                Boolean.TRUE.equals(body.get("force")));
    }

    @PostMapping("/verify")
    public Map<String, Object> verify(@RequestBody(required = false) Map<String, String> body) {
        if (body == null) throw AuthException.badRequest("请求缺少 email / code 参数");
        return authService.verify(body.get("email"), body.get("code"));
    }

    /** 前端启动时用它确认本地 token 是否还有效 */
    @GetMapping("/me")
    public Map<String, Object> me(@RequestAttribute(name = AuthSessionService.REQ_ATTR)
                                 AuthSessionService.Session session) {
        return authService.me(session);
    }

    @PostMapping("/logout")
    public Map<String, Object> logout(@RequestHeader(value = "Authorization", required = false) String authorization,
                                      @RequestParam(value = "token", required = false) String token) {
        authService.logout(AuthSessionService.tokenOf(authorization, token));
        return Map.of("loggedOut", true);
    }
}
