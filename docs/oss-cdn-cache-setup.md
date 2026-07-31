# OSS CDN 与浏览器缓存配置

本项目把资源链路拆成两条：

- 上传：浏览器使用临时签名 URL 直接 `PUT` 到 OSS，不经过 CDN。
- 读取：配置完成后，缩略图、附件预览和下载使用 CDN Type A 鉴权 URL；未配置时自动回退 OSS/API 代理。

## 1. CDN 控制台

1. 加速域名的源站选择当前 OSS Bucket。
2. 完成 CNAME，并配置 HTTPS 证书与强制 HTTPS。
3. 私有 Bucket 开启“阿里云 OSS 私有 Bucket 回源”。
4. 在“访问控制 → URL 鉴权”中选择 **Type A**：
   - 主 Key：生成一个 6～128 位随机字符串。
   - TTL：`604800` 秒（7 天）。
   - Key 和 TTL 必须与服务端环境变量一致。
5. 开启 Range 回源，推荐“跟随客户端 Range 请求”。
6. 缓存规则建议：
   - 目录 `/prod/`：30 天～1 年。
   - 图片、PDF、Office、压缩包、音视频等不可变对象：至少 30 天。
   - 开启“客户端跟随 CDN 缓存策略”，让浏览器收到 `Cache-Control`。
7. Cache Key 必须保留：
   - `x-oss-process`：区分 240/320/480px 等不同缩略图。
   - `response-content-disposition`：区分内联预览和附件下载。
   - 不要配置“忽略全部查询参数”。Type A 的 `auth_key` 会由 CDN 在鉴权成功后自动移除。

## 2. CORS

CDN 读取域名允许业务站点执行 `GET`、`HEAD`。

OSS Bucket 的 CORS 用于直传，建议：

- Allowed Origin：生产前端域名；开发环境另加本地地址，生产不要使用 `*`。
- Allowed Methods：`PUT`、`GET`、`HEAD`。
- Allowed Headers：`Content-Type`、`Cache-Control`、`x-oss-*`。
- Expose Headers：`ETag`、`Content-Length`、`Content-Range`、`Accept-Ranges`。
- Max Age：`86400`。

## 3. 服务端环境变量

```env
# 上传仍使用 OSS 公网域名，不要改成 CDN 域名
OSS_PUBLIC_ENDPOINT=oss-cn-beijing.aliyuncs.com

# CDN 只用于读取
OSS_CDN_DOMAIN=https://assets.example.com
OSS_CDN_AUTH_TYPE=A
OSS_CDN_AUTH_KEY=<与 CDN 控制台相同的 Key>
OSS_CDN_AUTH_TTL_SECONDS=604800
OSS_CDN_URL_STABLE_SECONDS=86400

# API 代理回退使用独立密钥
OSS_PREVIEW_SECRET=<随机长字符串>
```

`OSS_CDN_AUTH_KEY` 和 `OSS_PREVIEW_SECRET` 只放服务器环境变量，不提交到 Git，也不要放进任何 `VITE_*` 变量。

## 4. 验证

部署并重启 API 后检查日志：

```text
OSS CDN 读取已启用: domain=https://..., auth=Type A, ttl=604800s
```

在浏览器 Network 面板验证：

1. 附件 URL 的 Host 是 CDN 加速域名。
2. 第一次访问响应头通常为 `X-Cache: MISS`，再次访问应为 `HIT`。
3. 刷新页面后已加载图片应显示 `(disk cache)` 或 `(memory cache)`。
4. 240/320/480px 缩略图 URL 应包含不同的 `x-oss-process`。
5. PDF/视频 Range 请求应返回 `206 Partial Content`。
6. 下载 URL 包含 `response-content-disposition=attachment...`，预览 URL为 `inline`。

上线后重点观察 CDN 请求命中率、字节命中率、回源流量以及附件首包时间。
