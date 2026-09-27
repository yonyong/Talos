package com.yonyong.talos.controller;

import com.yonyong.talos.entity.DocEntity;
import com.yonyong.talos.repository.DocRepository;
import com.yonyong.talos.service.DocStorageService;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 文档：工作流过程产出的过程文档（客户端回传）+ Issue 提出时上传的原始材料。
 * 原始材料落盘到 data/docs，数据库只留相对路径与文本摘录。
 */
@RestController
@RequestMapping("/api/docs")
@RequiredArgsConstructor
public class DocController {

    private static final long MAX_FILE = 20L * 1024 * 1024; // 单文件 20MB
    private static final int TEXT_EXCERPT = 20000;          // 文本摘录上限（字符）
    private static final Set<String> TEXT_EXT = Set.of(
            "txt", "md", "markdown", "json", "xml", "yml", "yaml", "csv", "log", "ini", "properties",
            "java", "py", "js", "ts", "tsx", "jsx", "sql", "html", "css", "sh", "bat", "gradle", "go", "c", "cpp", "h");

    private final DocRepository docRepository;
    private final DocStorageService storage;

    /** 列表：按 Issue 查时不做 kind/category 过滤，前端自行分组 */
    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) String issueCode,
                                         @RequestParam(required = false) String kind,
                                         @RequestParam(required = false) String category) {
        List<DocEntity> src;
        if (issueCode != null) src = docRepository.findByIssueCode(issueCode);
        else if (kind != null) src = docRepository.findByKind(kind);
        else src = docRepository.findAll();

        List<Map<String, Object>> out = new ArrayList<>();
        for (DocEntity d : src) {
            if (category != null && !category.equalsIgnoreCase(norm(d.getCategory()))) continue;
            out.add(view(d));
        }
        return out;
    }

    /** 客户端 gRPC 之外的 JSON 回传通道（过程文档） */
    @PostMapping
    public ResponseEntity<?> upload(@RequestBody DocEntity doc) {
        if (doc.getCategory() == null || doc.getCategory().isBlank()) doc.setCategory("PROCESS");
        if (doc.getSource() == null || doc.getSource().isBlank()) doc.setSource("客户端回传");
        return ResponseEntity.ok(view(docRepository.save(doc)));
    }

    /**
     * 多文件上传（Ctrl+V 粘贴 / 拖拽 / 选择）：默认记为提出人上传的原始材料。
     *
     * @param files     支持一次多个，逐个落盘，单文件失败不影响其他文件
     * @param category  RAW（原始材料）| PROCESS（过程文档）
     */
    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> uploadFiles(@RequestParam("issueCode") String issueCode,
                                         @RequestParam(value = "files") List<MultipartFile> files,
                                         @RequestParam(value = "category", defaultValue = "RAW") String category,
                                         @RequestParam(value = "kind", required = false) String kind,
                                         @RequestParam(value = "uploader", required = false) String uploader) {
        boolean raw = !"PROCESS".equalsIgnoreCase(category);
        List<Map<String, Object>> saved = new ArrayList<>();
        List<String> failed = new ArrayList<>();

        for (MultipartFile f : files) {
            String name = f.getOriginalFilename() == null || f.getOriginalFilename().isBlank()
                    ? "pasted-file" : f.getOriginalFilename();
            try {
                if (f.getSize() > MAX_FILE) {
                    failed.add(name + "（超过 20MB）");
                    continue;
                }
                byte[] bytes = f.getBytes();
                DocEntity d = new DocEntity();
                d.setIssueCode(issueCode);
                d.setName(name);
                d.setCategory(raw ? "RAW" : "PROCESS");
                d.setKind(kind != null && !kind.isBlank() ? kind : (raw ? "原始材料" : "过程文档"));
                d.setSource(raw ? "提出人上传" : "控制台上传");
                d.setUploader(uploader);
                d.setSizeBytes((long) bytes.length);
                d.setSizeText(fmtSize(bytes.length));
                d.setMimeType(f.getContentType());
                d.setStoredPath(storage.save(issueCode, name, bytes));
                if (isText(name, f.getContentType())) {
                    String text = new String(bytes, StandardCharsets.UTF_8);
                    d.setContent(text.length() > TEXT_EXCERPT ? text.substring(0, TEXT_EXCERPT) : text);
                }
                saved.add(view(docRepository.save(d)));
            } catch (IOException e) {
                failed.add(name + "（写入失败）");
            }
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("saved", saved);
        out.put("failed", failed);
        return ResponseEntity.ok(out);
    }

    /** 文件内容：文本/图片走 inline 预览，其余走 attachment 下载（dl=1 强制下载） */
    @GetMapping("/{id}/raw")
    public ResponseEntity<?> raw(@PathVariable Long id,
                                 @RequestParam(defaultValue = "0") String dl) throws IOException {
        DocEntity d = docRepository.findById(id).orElse(null);
        if (d == null) return ResponseEntity.status(404).body(Map.of("message", "文档不存在: " + id));

        byte[] bytes = d.getStoredPath() != null && !d.getStoredPath().isBlank()
                ? storage.read(d.getStoredPath())
                : (d.getContent() == null ? new byte[0] : d.getContent().getBytes(StandardCharsets.UTF_8));

        String mime = d.getMimeType() != null && !d.getMimeType().isBlank()
                ? d.getMimeType()
                : guessMime(d.getName(), bytes);
        boolean inline = !"1".equals(dl) && (mime.startsWith("text/") || mime.startsWith("image/")
                || mime.contains("json") || mime.contains("xml"));

        ByteArrayResource res = new ByteArrayResource(bytes);
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.parseMediaType(mime));
        String enc = URLEncoder.encode(d.getName() == null ? "file" : d.getName(), StandardCharsets.UTF_8).replace("+", "%20");
        h.add(HttpHeaders.CONTENT_DISPOSITION,
                (inline ? "inline" : "attachment") + "; filename*=UTF-8''" + enc);
        return ResponseEntity.ok().headers(h).body(res);
    }

    /** 删除文档（含落盘文件）：原始材料可被提出人撤回 */
    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id) {
        DocEntity d = docRepository.findById(id).orElse(null);
        if (d == null) return ResponseEntity.status(404).body(Map.of("message", "文档不存在: " + id));
        storage.delete(d.getStoredPath());
        docRepository.delete(d);
        return ResponseEntity.ok(Map.of("deleted", true, "id", id));
    }

    /* ------------------------- 视图与工具 ------------------------- */

    /** 对外视图：不带正文（正文可能很大，按需走 /{id}/raw） */
    private static Map<String, Object> view(DocEntity d) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", d.getId());
        m.put("issueCode", d.getIssueCode());
        m.put("name", d.getName());
        m.put("kind", d.getKind());
        m.put("category", norm(d.getCategory()));
        m.put("source", d.getSource());
        m.put("sizeText", d.getSizeText());
        m.put("sizeBytes", d.getSizeBytes());
        m.put("mimeType", d.getMimeType());
        m.put("uploader", d.getUploader());
        m.put("clientId", d.getClientId());
        m.put("hasFile", d.getStoredPath() != null && !d.getStoredPath().isBlank());
        m.put("hasText", d.getContent() != null && !d.getContent().isBlank());
        m.put("createdAt", d.getCreatedAt() == null ? null : d.getCreatedAt().toString());
        return m;
    }

    private static String norm(String c) {
        return c == null || c.isBlank() ? "PROCESS" : c.trim().toUpperCase();
    }

    private static boolean isText(String name, String mime) {
        if (mime != null && (mime.startsWith("text/") || mime.contains("json") || mime.contains("xml"))) return true;
        int i = name.lastIndexOf('.');
        return i > 0 && TEXT_EXT.contains(name.substring(i + 1).toLowerCase());
    }

    private static String guessMime(String name, byte[] bytes) {
        int i = name == null ? -1 : name.lastIndexOf('.');
        String ext = i > 0 ? name.substring(i + 1).toLowerCase() : "";
        return switch (ext) {
            case "png" -> "image/png";
            case "jpg", "jpeg" -> "image/jpeg";
            case "gif" -> "image/gif";
            case "webp" -> "image/webp";
            case "bmp" -> "image/bmp";
            case "svg" -> "image/svg+xml";
            case "pdf" -> "application/pdf";
            case "zip" -> "application/zip";
            case "json" -> "application/json";
            case "xml" -> "application/xml";
            default -> isText(name, null) ? "text/plain; charset=utf-8" : "application/octet-stream";
        };
    }

    private static String fmtSize(long b) {
        if (b < 1024) return b + " B";
        double kb = b / 1024.0;
        if (kb < 1024) return String.format("%.1f KB", kb);
        double mb = kb / 1024.0;
        return mb < 1024 ? String.format("%.1f MB", mb) : String.format("%.2f GB", mb / 1024.0);
    }
}
