package com.yonyong.talos.config;

import com.yonyong.talos.service.AuthSessionService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.charset.StandardCharsets;
import java.util.Set;

/**
 * Web 配置：
 * - 允许前端本地开发跨域
 * - 登录态拦截：除白名单外，所有 /api/** 必须携带有效会话 token，否则 401
 * - RBAC 拦截：写操作仅对 admin / pm / lead 开放，角色由网关或请求头 X-Talos-Role 提供
 */
@Slf4j
@Configuration
@RequiredArgsConstructor
public class WebConfig implements WebMvcConfigurer {

    private static final Set<String> WRITE_ROLES = Set.of("admin", "pm", "lead");

    /**
     * 免登录白名单（务必保持最小）：
     * <ul>
     *   <li>{@code /api/auth/send-code}、{@code /api/auth/verify} —— 登录本身的入口</li>
     *   <li>{@code /api/health} —— 探活</li>
     *   <li>{@code /api/agent/release}、{@code /api/agent/release/download} —— 官网下载页免登录，
     *       客户端的静默升级（Upgrader）与 Windows/Linux 升级脚本也直接打这两个地址取包，
     *       它们没有 token，必须放行；版本库的 list / upload / activate / delete 仍要求登录</li>
     * </ul>
     */
    private static final String[] PUBLIC_PATHS = {
            "/api/auth/send-code",
            "/api/auth/verify",
            "/api/health",
            "/api/agent/release",
            "/api/agent/release/download",
    };

    private final AuthSessionService sessionService;

    /**
     * 允许的跨域来源，逗号分隔，支持通配（如 {@code https://*.example.com}），默认全部放行。
     *
     * <p>为什么默认 {@code *}：浏览器对所有 POST（包括同源）都会带 Origin 头，
     * Spring 对不在白名单里的 Origin 一律 403 "Invalid CORS request"——曾把生产域名
     * www.missyou.website 自己的登录请求整个拦死，且报错被前端吞成「请求失败 403」。
     * 本应用认证走 Authorization: Bearer 头、不依赖 Cookie，跨站页面拿不到 token，
     * 放开 Origin 没有实际攻击面。生产如需收紧，在 config/application.yml 配：</p>
     * <pre>talos:
     *   cors:
     *     allowed-origin-patterns: https://talos.example.com,http://localhost:*</pre>
     */
    @Value("${talos.cors.allowed-origin-patterns:*}")
    private String[] corsAllowedOriginPatterns;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns(corsAllowedOriginPatterns)
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true);
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // 登录态在前、角色在后：未登录直接 401，不必再谈权限
        registry.addInterceptor(new AuthInterceptor(sessionService))
                .addPathPatterns("/api/**")
                .excludePathPatterns(PUBLIC_PATHS);

        registry.addInterceptor(new RbacInterceptor())
                .addPathPatterns("/api/**")
                .excludePathPatterns("/api/health", "/api/clients/stats");
    }

    /**
     * 登录态拦截：校验 {@code Authorization: Bearer <token>}（或 {@code ?token=} 直链形式），
     * 通过后把会话放进 request 属性，控制器可 {@code @RequestAttribute} 取当前用户。
     */
    @RequiredArgsConstructor
    static class AuthInterceptor implements HandlerInterceptor {

        private final AuthSessionService sessionService;

        @Override
        public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
            if ("OPTIONS".equals(request.getMethod())) return true;

            String token = AuthSessionService.tokenOf(request.getHeader("Authorization"), request.getParameter("token"));
            AuthSessionService.Session session = sessionService.find(token).orElse(null);
            if (session == null) {
                respondUnauthorized(request, response, token == null ? "未登录" : "登录已失效");
                return false;
            }
            request.setAttribute(AuthSessionService.REQ_ATTR, session);
            return true;
        }

        @Override
        public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                    Object handler, Exception ex) {
            request.removeAttribute(AuthSessionService.REQ_ATTR);
        }

        private void respondUnauthorized(HttpServletRequest request, HttpServletResponse response, String why) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json;charset=UTF-8");
            try {
                response.getOutputStream().write(
                        ("{\"message\":\"" + why + "，请重新登录\"}").getBytes(StandardCharsets.UTF_8));
            } catch (Exception e) {
                log.debug("401 响应写出失败：{}", e.getMessage());
            }
            log.debug("拒绝未授权访问：{} {}（{}）", request.getMethod(), request.getRequestURI(), why);
        }
    }

    static class RbacInterceptor implements HandlerInterceptor {
        @Override
        public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
            String method = request.getMethod();
            if ("GET".equals(method) || "OPTIONS".equals(method)) return true;

            String role = request.getHeader("X-Talos-Role");
            if (role == null || role.isBlank()) role = "dev"; // 内网默认放行写操作，接企业 SSO 后收紧

            if (!WRITE_ROLES.contains(role) && !"dev".equals(role)) {
                log.warn("角色 {} 无写权限: {} {}", role, method, request.getRequestURI());
                response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                return false;
            }
            return true;
        }
    }
}
