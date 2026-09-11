# OSS CDN 与浏览器缓存配置

本项目把资源链路拆成两条：

- 上传：浏览器使用临时签名 URL 直接 `PUT` 到 OSS，不经过 CDN。
- 读取：接入统一读取入口的图片、缩略图和附件使用 CDN Type A 鉴权 URL；未配置时自动回退 OSS/API 代理。显式 OSS 签名、模型输入和需要固定下载响应头的专用链路仍保留 OSS。

应用保存 object key；返回页面时再生成访问地址。对于历史数据中的本 Bucket OSS 直链、配置的 CDN 直链和受支持的同源预览代理，统一读取入口会提取 key 并重新签发，保留图片处理参数，移除过期的 OSS/CDN 签名。未知外部域名不转换为本桶地址。该转换不替代业务权限校验。

本轮已接入 FilesService 授权后的取链接与上传结果、图片库图片/缩略图、研发任务与工作区的附件预览、采购任务附件、问题库附件，以及研发数据表图片。预览和下载通过各自业务读取入口重新获取地址；已接入的图片控件在加载失败时可续签后重试，下载操作重新获取原文件地址。模型输入、导出归档等显式要求更长有效期的专用 OSS 链路继续保留。

研发数据表另有后台续签调度：可见页面每分钟检查一次，按 API 返回的剩余有效期提前约两分钟续签；标签页隐藏时停止定时调度，恢复可见后立即检查。最多一个在途批次，每批最多 100 张、单轮最多 1000 张，失败重试与不可续签来源均有间隔；卸载或切换账号时取消在途请求并清理监听与计时器。

续签只更新 Univer 当前图片的地址，不重新加载工作簿、不改动未保存文字/公式/图片位置、不增加撤销记录，也不标记为用户编辑。正在输入单元格时暂缓替换。保存与历史留档只保留对象 key 或带图片处理参数的稳定同源引用；读取时才恢复访问 URL。续签接口要求现有数据表权限，且对象必须是当前已保存快照实际引用的数据表图片，或请求者仍持有有效的同源资产能力；只有业务前缀不构成授权，外部图片与其他业务对象不能借此续签。

新图片保存前仍留在编辑器的 base64 内容中，图片转存只修改本次提交副本。保存失败时，当前编辑内容与本地草稿仍保留图片，可直接重试保存。尚未入库且已失效的历史 CDN 草稿链接不能凭对象 key 越过授权续签；有编辑权限的用户正常保存稳定引用后，再通过数据表读取/续签恢复。

## 1. CDN 控制台

1. 加速域名使用 `img.weoxymedical.com`，源站类型选择“OSS 域名”，源站地址选择当前 Bucket 的**公网**域名，不填写内网 endpoint。
2. 完成 CNAME，并为 `img.weoxymedical.com` 配置 HTTPS 证书与强制 HTTPS。
3. 私有 Bucket 开启“阿里云 OSS 私有 Bucket 回源”。HTTPS 回源的默认 Host 和 SNI 均配置为该 Bucket 的公网域名（如 `<bucket>.oss-cn-beijing.aliyuncs.com`），确认 443/HTTPS 回源可用。回源配置依据[阿里云源站配置文档](https://help.aliyun.com/zh/cdn/user-guide/configure-an-origin-server)。
4. 在“访问控制 → URL 鉴权”中选择 **Type A**：
   - 主 Key：生成一个 6～128 位随机字母数字字符串。
   - TTL：`1800` 秒（30 分钟）。
   - Key 和 TTL 必须与服务端环境变量一致。
   - 失效时刻为 URL 中的 `timestamp + TTL`，不是浏览器收到 URL 后再过 1800 秒。Type A 的编码与验签规则见[阿里云 Type A 文档](https://help.aliyun.com/zh/cdn/user-guide/type-a-signing)。
5. 开启 Range 回源，推荐“跟随客户端 Range 请求”。
6. 缓存规则建议：
   - 目录 `/prod/`：30 天～1 年。
   - 图片、PDF、Office、压缩包、音视频等不可变对象：至少 30 天。
   - CDN 节点缓存时间和浏览器缓存时间分别设置。浏览器需要收到合适的 `Cache-Control` 才能复用缓存；私有附件不要直接跟随 30 天～1 年的节点缓存配置。签名过期限制后续网络读取，不会撤回已经下载或保存在浏览器缓存中的内容。
7. Cache Key 必须保留：
   - `x-oss-process`：区分 240/320/480px 等不同缩略图。
   - `response-content-disposition`：区分内联预览和附件下载。
   - 不要配置“忽略全部查询参数”。Type A 的 `auth_key` 会由 CDN 在鉴权成功后自动移除，缓存命中时仍应先鉴权；不要配置跳过鉴权的缓存规则。见[阿里云 URL 鉴权说明](https://help.aliyun.com/zh/cdn/user-guide/configure-url-signing)。

## 2. CORS

CDN 读取域名允许业务站点执行 `GET`、`HEAD`。

OSS Bucket 的 CORS 用于直传，建议：

- Allowed Origin：生产前端域名；开发环境另加本地地址，生产不要使用 `*`。
- Allowed Methods：`PUT`、`GET`、`HEAD`。
- Allowed Headers：`Content-Type`、`Cache-Control`、`x-oss-*`。
- Expose Headers：`ETag`、`Content-Length`、`Content-Range`、`Accept-Ranges`。
- Max Age：`86400`。

没配 CORS 时的表现：浏览器直传会在预检阶段被拦，前端自动退回 `/api/files/upload` 服务端中转
（见 `src/app/lib/resourceUpload.ts`），控制台会打印一条提示。中转只兜底 ≤25MB 的文件——
再大就会直接失败，因为中转要把整个文件读进 API 进程内存。上线新域名时优先补 CORS，
不要长期靠中转扛上传流量。

## 3. 服务端环境变量

```env
# 上传仍使用 OSS 公网域名，不要改成 CDN 域名
OSS_PUBLIC_ENDPOINT=oss-cn-beijing.aliyuncs.com

# CDN 只用于读取
OSS_CDN_DOMAIN=https://img.weoxymedical.com
OSS_CDN_AUTH_TYPE=A
OSS_CDN_AUTH_KEY=<与 CDN 控制台相同的 Key>
OSS_CDN_AUTH_TTL_SECONDS=1800
OSS_CDN_URL_STABLE_SECONDS=300

# API 代理回退使用独立密钥
OSS_PREVIEW_SECRET=<随机长字符串>
```

`OSS_CDN_AUTH_KEY` 和 `OSS_PREVIEW_SECRET` 只放服务器环境变量，不提交到 Git，也不要放进任何 `VITE_*` 变量。

默认稳定窗口为 300 秒，同一窗口、同一对象和处理参数生成相同的 URL。时间戳向下对齐窗口后，1800 秒 TTL 对应返回时约 1501～1800 秒的剩余有效期；读取接口返回真实剩余秒数。缺失或错误的窗口配置会使用受 TTL 上限约束的默认值，避免把刚生成的地址回拨到已经过期的时间。生产控制台 TTL 若与服务端不同，这些计算便不成立，应先对齐配置。

## 4. 验证

部署并重启 API 后检查日志：

```text
OSS CDN 读取已启用: domain=https://img.weoxymedical.com, auth=Type A, ttl=1800s
```

在浏览器 Network 面板验证：

1. 已接入的附件 URL 的 Host 是 `img.weoxymedical.com`，只有新的 `auth_key`，不残留旧 `Signature`、`OSSAccessKeyId`、`Expires` 或预览 `sig`。
2. 第一次访问响应头通常为 `X-Cache: MISS`，再次访问应为 `HIT`。
3. 同一个 300 秒窗口内刷新页面，已加载图片应能复用相同 URL；是否显示 `(disk cache)` 或 `(memory cache)` 取决于实际响应的缓存头。
4. 240/320/480px 缩略图 URL 应包含不同的 `x-oss-process`。
5. PDF/视频 Range 请求应返回 `206 Partial Content`。
6. 设置下载响应头的 URL 应保持 `response-content-disposition=attachment...`，内联预览 URL 保持 `inline`；专用 OSS 下载入口仍可使用 OSS 响应头签名。
7. 对包含中文、空格和 `%` 的历史附件逐一检查原图与缩略图，确认对象名没有重复编码或解码，240/320/480px 实际响应尺寸互不混用。
8. 提交一次测试上传，确认 PUT 请求仍发往 OSS 公网域名。上传成功后重新读取，确认页面得到新的 CDN 地址。
9. 分别在图库、研发任务/工作区、采购任务、问题库中测试过期后的预览与下载，确认调用业务读取入口取得新地址，下载的是原文件，且无权限账号不能借续签获取附件。
10. 数据表保留一处未保存的文字修改，跨过 URL 有效期或隐藏标签页后再恢复，确认图片地址已更换，文字、公式、选区和图片位置不变，也没有额外撤销项或自动保存请求；修改/删除图片期间收到的旧续签结果不能覆盖当前内容。

鉴权过期必须另外做真实 CDN 边缘验证，单元测试只验证本地 URL 生成逻辑。先把测试资源访问至缓存 HIT，再用没有浏览器缓存的请求验证：有效签名返回 200/206，删除或篡改 `auth_key` 返回 403；超过该 URL 的 `timestamp + 1800` 后，原 URL 即使对应资源仍在 CDN 缓存也应返回 403，而从 API 新获取的地址仍能成功。测试 300 秒换窗前后及真实 1800 秒到期前后；不要把浏览器直接显示已缓存内容当成边缘鉴权失效。保留状态码、时间、`X-Cache` 和鉴权错误头作为验证记录。

上线后重点观察 CDN 请求命中率、字节命中率、回源流量以及附件首包时间。前端资源访问失败可通过 `POST /api/files/access-failures` 上报加载、续签、下载阶段和 HTTP 状态码；服务端校验登录身份并节流，只记录这些固定字段，不接收或记录资源 URL、对象 key、签名、密钥或原始服务端错误正文。

## 5. 部署与回退

1. 部署前轮换已经公开的 CDN 主 Key 和备 Key，并同步服务器使用的新 Key；不要在聊天、日志或版本库中输出密钥。完成域名、证书、私有 Bucket 回源、Host/SNI、CORS、缓存参数与 Type A 配置，确认 CDN 测试资源可访问，再向服务器注入上述环境变量。
2. **先部署 API，确认授权读取、数据表批量续签和失败上报接口就绪，再发布前端。** 本地 `.env.example` 只是模板，不会修改生产环境。重启 API 使配置生效后，再按第 4 节验证历史图片、预览、下载、缩略图、直传和长时间停留场景；避免新前端先上线却遇到旧 API 的 404。
3. 若发生鉴权或回源错误，先在应用服务器保留域名、清空 `OSS_CDN_AUTH_KEY` 并重启 API，使读取回退到 OSS/API 代理；保留域名可继续识别历史 CDN 地址并换成 OSS 签名。已接入控件会在下次续签、重新打开预览或下载时获取回退地址。数据表使用就地续签，不要以强制刷新整个工作簿替代续签而丢失未保存编辑。
4. 回退不要求放开 Bucket 访问权限，也不要先关闭 CDN URL 鉴权。修正 Key/TTL、证书或回源配置并验证后，再恢复服务器 Key、重启 API 和复测。

本轮验证包括本地签名测试、业务权限测试，以及使用受控模拟时钟/响应的前端续签行为测试；尚未完成真实 CDN 边缘的缓存命中、到期后 403、HTTPS 回源与完整浏览器长时间停留验收。本任务未执行生产 Key 轮换、CDN 缓存配置修改或 HTTPS 回源配置修改；以上部署与验收步骤不代表这些线上行为已通过验证。
