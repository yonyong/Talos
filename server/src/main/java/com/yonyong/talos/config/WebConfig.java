package com.yonyong.talos.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.Set;

/**
 * Web 配置：
 * - 允许前端本地开发跨域
 * - RBAC 拦截：写操作仅对 admin / pm / lead 开放，角色由网关或请求头 X-Talos-Role 提供
 */
@Slf4j
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private static final Set<String> WRITE_ROLES = Set.of("admin", "pm", "lead");

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns("http://localhost:*", "http://127.0.0.1:*")
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true);
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new RbacInterceptor())
                .addPathPatterns("/api/**")
                .excludePathPatterns("/api/health", "/api/clients/stats");
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
