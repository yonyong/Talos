package com.yonyong.talos.service;

import com.yonyong.talos.controller.AuthException;
import com.yonyong.talos.entity.UserEntity;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 控制台会话（登录态）。
 *
 * <p>授权码校验通过后签发一个不透明 token，前端存 localStorage 并在每个请求携带
 * {@code Authorization: Bearer <token>}；{@code AuthInterceptor} 据此放行或被白名单放行。</p>
 *
 * <p>为什么用「服务端存表 + 不透明 token」而不是 JWT：① 退出登录能真正立刻失效；
 * ② 用户被删除或改邮箱时可以直接踢下线；③ 无需引入签名库。代价是服务端重启后所有人重新登录
 * —— 对内网工具来说这个代价可以接受，也避免了吊销名单那套复杂度。</p>
 */
@Service
public class AuthSessionService {

    /** 请求属性名：拦截器校验通过后把会话放进 request，控制器用 {@code @RequestAttribute} 取 */
    public static final String REQ_ATTR = "talos.session";

    /**
     * 从请求里取 token。优先 {@code Authorization: Bearer xxx}；
     * 其次 {@code ?token=xxx} —— {@code <img src>} / {@code <a href>} 这类浏览器直链没法自定义请求头，
     * 文档预览与下载走的就是 query。
     */
    public static String tokenOf(String authorizationHeader, String queryToken) {
        if (authorizationHeader != null) {
            String h = authorizationHeader.trim();
            if (h.regionMatches(true, 0, "Bearer ", 0, 7)) h = h.substring(7).trim();
            if (!h.isEmpty()) return h;
        }
        return queryToken == null || queryToken.isBlank() ? null : queryToken.trim();
    }

    private final SecureRandom random = new SecureRandom();
    private final Map<String, Session> sessions = new ConcurrentHashMap<>();

    @Value("${talos.auth.session-ttl-hours:12}")
    private int sessionTtlHours;

    /** 会话快照：登录时定格，改用户资料不影响本次会话（下次登录生效） */
    public record Session(Long userId, String empNo, String name, String role, String email,
                          String clientId, List<String> bizCodes, Instant expireAt) {

        /** 接口返回给前端的用户信息（不包含任何凭据） */
        public Map<String, Object> toView() {
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("empNo", empNo == null ? "" : empNo);
            m.put("name", name == null ? "" : name);
            m.put("role", role == null ? "guest" : role);
            m.put("email", email == null ? "" : email);
            m.put("clientId", clientId == null ? "" : clientId);
            m.put("bizCodes", bizCodes == null ? List.of() : bizCodes);
            return m;
        }
    }

    /** 签发结果：token + 过期时刻 + 该 token 对应的会话快照 */
    public record Issued(String token, Instant expireAt, Session session) {
    }

    /** 签发新会话 */
    public Issued issue(UserEntity user) {
        purgeExpired();
        byte[] buf = new byte[32];
        random.nextBytes(buf);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(buf);
        Instant expireAt = Instant.now().plus(Duration.ofHours(Math.max(1, sessionTtlHours)));
        Session session = new Session(
                user.getId(), user.getEmpNo(), user.getName(), user.getRole(), user.getEmail(),
                user.getClientId(), user.getBizCodes(), expireAt);
        sessions.put(token, session);
        return new Issued(token, expireAt, session);
    }

    /** 会话有效期（小时），日志与前端提示用 */
    public int ttlHours() {
        return Math.max(1, sessionTtlHours);
    }

    /** 校验 token；过期或不存在都会顺手清掉 */
    public Optional<Session> find(String token) {
        if (token == null || token.isBlank()) return Optional.empty();
        Session s = sessions.get(token);
        if (s == null) return Optional.empty();
        if (Instant.now().isAfter(s.expireAt())) {
            sessions.remove(token);
            return Optional.empty();
        }
        return Optional.of(s);
    }

    /** 同 {@link #find}，但失效时抛 401，供拦截器与 /api/auth/me 使用 */
    public Session require(String token) {
        return find(token).orElseThrow(() -> AuthException.unauthorized("登录已失效，请重新登录"));
    }

    public void revoke(String token) {
        if (token != null) sessions.remove(token);
    }

    /** 踢掉某用户的全部会话：用户被删除时调用，避免已删除的账号继续用着旧 token */
    public int revokeUser(Long userId) {
        if (userId == null) return 0;
        int n = 0;
        for (Map.Entry<String, Session> e : sessions.entrySet()) {
            if (userId.equals(e.getValue().userId())) {
                sessions.remove(e.getKey());
                n++;
            }
        }
        return n;
    }

    /** 当前在线会话数（自检/排障用） */
    public int size() {
        return sessions.size();
    }

    /** 会话量很小，签发时顺带清理过期项即可，不必上定时任务 */
    private void purgeExpired() {
        Instant now = Instant.now();
        sessions.entrySet().removeIf(e -> now.isAfter(e.getValue().expireAt()));
    }
}
