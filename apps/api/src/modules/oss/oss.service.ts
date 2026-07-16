import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as OSS from 'ali-oss';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { extname } from 'path';

@Injectable()
export class OssService implements OnModuleInit {
  private readonly logger = new Logger(OssService.name);
  /** Internal endpoint client — used for upload / delete / head (saves egress cost). */
  private internalClient: OSS | null = null;
  /** Public endpoint client — used only for generating signed URLs accessible from the internet. */
  private publicClient: OSS | null = null;
  private bucket: string = '';
  private basePrefix: string = 'prod';

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const region = this.config.get<string>('OSS_REGION');
    const accessKeyId = this.config.get<string>('OSS_ACCESS_KEY_ID');
    const accessKeySecret = this.config.get<string>('OSS_ACCESS_KEY_SECRET');
    const internalEndpoint = this.config.get<string>('OSS_ENDPOINT');
    const publicEndpoint = this.config.get<string>('OSS_PUBLIC_ENDPOINT');
    this.bucket = this.config.get<string>('OSS_BUCKET') ?? '';
    this.basePrefix = this.config.get<string>('OSS_BASE_PREFIX') ?? 'prod';

    const isConfigured =
      region && accessKeyId && accessKeySecret &&
      !accessKeyId.includes('你的') && !accessKeySecret.includes('你的');

    if (!isConfigured) {
      this.logger.warn('OSS 未配置或使用占位符，文件将不会上传到 OSS');
      return;
    }

    const shared = { region, accessKeyId, accessKeySecret, bucket: this.bucket, secure: true };

    this.internalClient = new OSS({
      ...shared,
      ...(internalEndpoint ? { endpoint: internalEndpoint } : {}),
    });

    this.publicClient = new OSS({
      ...shared,
      ...(publicEndpoint ? { endpoint: publicEndpoint } : {}),
    });

    this.logger.log(`OSS 已初始化: bucket=${this.bucket}, region=${region}`);
  }

  get isEnabled(): boolean {
    return this.internalClient !== null;
  }

  /**
   * Build a deterministic object key for a given business type and file name.
   * Format: {prefix}/{businessType}/{yyyy}/{mm}/{dd}/{uuid}-{safeFileName}
   */
  buildObjectKey(businessType: string, fileName: string): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const uuid = randomUUID().replace(/-/g, '');
    const safeName = fileName.replace(/[^\w.\-一-龥]/g, '_').slice(0, 80);
    return `${this.basePrefix}/${businessType}/${yyyy}/${mm}/${dd}/${uuid}-${safeName}`;
  }

  /**
   * 校验 objectKey 确实落在指定业务前缀之下。
   *
   * 分片上传的 sign/complete/abort 都要由前端回传 objectKey（init 时才生成得出来），
   * 如果不校验，调用方就能把 key 改成任意路径，借我们的签名往桶里别的地方写。
   * 凡是接受前端传入 objectKey 的端点，签名前必须先过这一关。
   */
  isKeyUnderBusinessType(objectKey: string, businessType: string): boolean {
    return objectKey.startsWith(`${this.basePrefix}/${businessType}/`);
  }

  /**
   * Upload a Buffer to OSS. Returns the objectKey on success, null if OSS is disabled or upload fails.
   * The caller is responsible for generating a signed URL when they need to serve the file to clients.
   */
  async uploadBuffer(
    buffer: Buffer,
    businessType: string,
    originalname: string,
    mimetype?: string,
  ): Promise<string | null> {
    const primaryClient = this.internalClient;
    const fallbackClient = this.publicClient;
    if (!primaryClient && !fallbackClient) {
      this.logger.warn('OSS uploadBuffer 被调用但 OSS 未配置（缺少 OSS_ACCESS_KEY_ID / OSS_BUCKET 等环境变量）');
      return null;
    }

    const ext = extname(originalname) || '';
    const objectKey = this.buildObjectKey(businessType, originalname);
    const putOptions = {
      mime: mimetype ?? this.guessMime(ext),
      headers: { 'Cache-Control': 'max-age=31536000' },
    };

    // 收集所有尝试的错误，便于一次性暴露给调用方
    const attemptErrors: string[] = [];

    // Try internal endpoint first (saves egress cost on ECS).
    // Fall back to public endpoint for local dev or cross-region scenarios.
    if (primaryClient) {
      try {
        await primaryClient.put(objectKey, buffer, putOptions);
        return objectKey;
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        attemptErrors.push(`内网: ${msg}`);
        this.logger.warn(`OSS 内网上传失败，尝试公网回退: ${objectKey} — ${msg}`);
      }
    }

    if (fallbackClient && fallbackClient !== primaryClient) {
      try {
        await fallbackClient.put(objectKey, buffer, putOptions);
        this.logger.log(`OSS 公网上传成功(fallback): ${objectKey}`);
        return objectKey;
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        attemptErrors.push(`公网: ${msg}`);
        this.logger.error(`OSS 上传失败(内网+公网均失败): ${objectKey} — ${msg}`, err);
      }
    }

    // 把所有尝试的错误信息塞到日志，方便排查 (CORS / endpoint 不通 / 凭据失效 等)
    if (attemptErrors.length > 0) {
      this.logger.error(`OSS uploadBuffer 全部失败: [${attemptErrors.join(' | ')}]`);
    }
    return null;
  }

  /**
   * Generate a signed URL for private-bucket access.
   * Uses the public endpoint client so the URL is accessible from the internet.
   * @param objectKey - The OSS object key returned by uploadBuffer
   * @param expiresSeconds - URL validity window (default 600 = 10 minutes)
   */
  getSignedUrl(objectKey: string, expiresSeconds = 600, process?: string): string | null {
    if (!this.publicClient) return null;
    try {
      // process：OSS 图片处理参数（如 image/resize,w_256/format,webp/quality,q_80），
      // 读取时实时缩放/压缩/转格式，原图只存一份。签名会覆盖该参数，不可被篡改。
      return this.publicClient.signatureUrl(objectKey, {
        expires: expiresSeconds,
        ...(process ? { process } : {}),
      });
    } catch {
      return null;
    }
  }

  /** 业务相对前缀 → 完整 OSS 前缀（带 basePrefix）。用于列目录 / 前缀白名单校验。 */
  resolveKeyPrefix(relativePrefix: string): string {
    return `${this.basePrefix}/${relativePrefix}`.replace(/\/{2,}/g, '/');
  }

  /**
   * 列出某前缀下的全部对象 key（跳过以 / 结尾的“目录”占位对象），自动翻页到取完或达上限。
   * 与 getObjectStream 同策略：内网 client 优先（VPC 内免流量），但给短超时，
   * 这样在 VPC 外（如本地 dev，内网域名不可达）会在 ~2s 内回退到公网 client，
   * 而不是卡在 TLS 握手上一直超时返回空。生产内网 <100ms，正常命中第一次尝试。
   */
  async listObjects(fullPrefix: string, maxKeys = 2000): Promise<string[]> {
    const attempts: Array<{ client: OSS; timeout?: number }> = [];
    if (this.internalClient) attempts.push({ client: this.internalClient, timeout: 2000 });
    // 公网兜底也给超时上限：listObjects 喂给登录 / /me 等鉴权路径，避免网络异常时长时间挂起。
    if (this.publicClient && this.publicClient !== this.internalClient) attempts.push({ client: this.publicClient, timeout: 5000 });
    if (attempts.length === 0) return [];

    let lastErr: unknown = null;
    for (const { client, timeout } of attempts) {
      try {
        const keys: string[] = [];
        let marker: string | undefined;
        do {
          const res = await client.list(
            { prefix: fullPrefix, 'max-keys': 1000, marker },
            timeout ? { timeout } : {},
          );
          for (const o of res.objects ?? []) {
            if (o.name && !o.name.endsWith('/')) keys.push(o.name);
          }
          marker = res.nextMarker;
        } while (marker && keys.length < maxKeys);
        return keys;
      } catch (err) {
        lastErr = err; // 内网不可达（本地）→ 落到下一次尝试（公网）
      }
    }
    this.logger.warn(`OSS listObjects 失败 (prefix=${fullPrefix}): ${(lastErr as Error)?.message}`);
    return [];
  }

  /**
   * Generate a pre-signed PUT URL so the browser can upload directly to OSS,
   * bypassing our API server entirely (browser → OSS in one hop).
   *
   * The caller MUST send the exact same Content-Type header when issuing the PUT
   * request, because it is included in the signature.
   *
   * OSS bucket CORS prerequisite (set once in console):
   *   AllowedOrigin: *   AllowedMethod: PUT   AllowedHeader: *
   *
   * @param objectKey   - Key path (use buildObjectKey to generate it first)
   * @param contentType - MIME type of the file (e.g. "application/pdf")
   * @param expiresSeconds - Validity window (default 3600 = 1 hour)
   */
  generatePutSignedUrl(objectKey: string, contentType: string, expiresSeconds = 3600): string | null {
    if (!this.publicClient) return null;
    try {
      return this.publicClient.signatureUrl(objectKey, {
        method: 'PUT',
        expires: expiresSeconds,
        'Content-Type': contentType,
      });
    } catch {
      return null;
    }
  }

  // ── 分片上传（Multipart Upload）─────────────────────────────────────────
  //
  // 为什么要有这一套：generatePutSignedUrl 走的是 OSS「简单上传」，单个对象上限 5GB，
  // 超过会被 OSS 直接拒掉（EntityTooLarge），跟网速快慢、超时设置都无关。分片上传把
  // 对象拆成多个 part 分别 PUT，单对象上限提升到 48.8TB。
  //
  // ETag 为什么由服务端取：completeMultipartUpload 必须带上每片的 ETag。浏览器想读到
  // PUT 响应里的 ETag 头，得在 bucket CORS 配 ExposeHeader: ETag —— 那是控制台配置，
  // 本 bucket 没配（见 generatePutSignedUrl 上方的 CORS 说明）。所以这里在 complete
  // 时由服务端 listParts 自行取回 ETag，前端只管把字节 PUT 上去、完全不碰 ETag。
  // 这样整套分片不依赖任何云端配置改动。

  /**
   * 在内网 client 上执行，失败再回退到公网 client。
   *
   * 分片的 init/complete/abort/listParts 都是服务端调用，优先走内网省流量；但 VPC 外
   * （本地开发）内网 endpoint 不可达，且是 TCP 层卡住而不是立刻报错，所以内网这次必须
   * 带短超时，否则每次调用都要干等到默认超时 —— listParts 翻页时每页都卡一次。
   * 生产环境内网响应远快于 100ms。同 getObjectStream 的处理方式。
   *
   * 注意：若内网调用其实已生效、只是响应超时报错，回退重试会重跑一次。init 重跑只是多
   * 出一个孤儿 uploadId（OSS 可用生命周期规则清理）；complete 重跑则会拿到 NoSuchUpload
   * 而误报失败 —— 所以 complete 传的是长超时，不能用默认的 2s。
   *
   * @param internalTimeoutMs 内网尝试的超时。轻量操作 2s 足够；complete 这种服务端要
   *   真正合并数据的操作必须给足时间，宁可本地开发多等一会儿也不能误判。
   */
  private async withOssFallback<T>(
    label: string,
    fn: (client: OSS, timeout: number | undefined) => Promise<T>,
    internalTimeoutMs = 2000,
  ): Promise<T | null> {
    const attempts: Array<{ client: OSS; timeout?: number }> = [];
    if (this.internalClient) attempts.push({ client: this.internalClient, timeout: internalTimeoutMs });
    if (this.publicClient && this.publicClient !== this.internalClient) attempts.push({ client: this.publicClient });

    if (attempts.length === 0) {
      this.logger.warn(`OSS ${label} 被调用但 OSS 未配置`);
      return null;
    }

    const attemptErrors: string[] = [];
    for (const { client, timeout } of attempts) {
      try {
        return await fn(client, timeout);
      } catch (err) {
        attemptErrors.push((err as Error)?.message ?? String(err));
      }
    }

    this.logger.error(`OSS ${label} 失败: [${attemptErrors.join(' | ')}]`);
    return null;
  }

  /** 初始化分片上传，返回 uploadId。OSS 未配置或失败时返回 null。 */
  async initMultipartUpload(objectKey: string, contentType: string): Promise<string | null> {
    const res = await this.withOssFallback('initMultipartUpload', (client, timeout) =>
      client.initMultipartUpload(objectKey, { mime: contentType, ...(timeout ? { timeout } : {}) }),
    );
    return res?.uploadId ?? null;
  }

  /**
   * 为单个分片签一个 PUT URL，供浏览器直传该片。
   *
   * 与 generatePutSignedUrl 的两点不同：
   *  1. 不把 Content-Type 计入签名 —— 分片 PUT 不校验它，省得前端必须逐字节匹配；
   *  2. 默认有效期 6 小时而不是 1 小时 —— 大文件从开签到传完这一片可能隔很久。
   */
  generatePartSignedUrl(
    objectKey: string,
    uploadId: string,
    partNumber: number,
    expiresSeconds = 6 * 3600,
  ): string | null {
    if (!this.publicClient) return null;
    try {
      return this.publicClient.signatureUrl(objectKey, {
        method: 'PUT',
        expires: expiresSeconds,
        subResource: { uploadId, partNumber: String(partNumber) },
      });
    } catch {
      return null;
    }
  }

  /**
   * 列出该 uploadId 下已成功上传的分片。
   * 两处要用：断点续传时判断哪些片可以跳过；complete 时取每片的 ETag。
   */
  async listUploadedParts(
    objectKey: string,
    uploadId: string,
  ): Promise<Array<{ number: number; etag: string; size: number }>> {
    const collected: Array<{ number: number; etag: string; size: number }> = [];
    let marker = 0;

    // listParts 单次最多返回 1000 片，必须翻页翻到底 —— 漏页会导致 complete 少片，
    // 合并出一个内容残缺的对象。
    //
    // 翻页的坑：@types/ali-oss 把 isTruncated 标成 boolean、nextPartNumberMarker 标成
    // number，但运行时拿到的是字符串 "false" 和 ""。直接 if (!page.isTruncated) 判断，
    // !"false" 恒为 false，marker 又恒为 Number("")=0，会反复请求第一页转不出去。
    // 所以这里显式按字符串比较，并额外要求 marker 必须前进，双保险。
    for (;;) {
      const page = await this.withOssFallback('listParts', (client, timeout) =>
        client.listParts(
          objectKey,
          uploadId,
          {
            'max-parts': 1000,
            'part-number-marker': marker,
            'encoding-type': 'url',
          },
          timeout ? { timeout } : {},
        ),
      );
      if (!page) break;

      // 两个 XML 解析坑叠在一起：
      //  1. 只有 1 片时，page.parts 是单个对象而非数组（XML 单元素退化），直接 for...of
      //     会抛 "is not a function" —— 这正是单片文件 complete 报 500 的原因。先归一成数组。
      //  2. 字段名是 XML 原样的 PartNumber / ETag / Size，@types 里的小写属性名对不上运行时；
      //     Size 尤其要用大写，小写 part.size 恒为 undefined→0。
      const rawParts = Array.isArray(page.parts) ? page.parts : page.parts ? [page.parts] : [];
      for (const part of rawParts) {
        const raw = part as unknown as { PartNumber?: unknown; ETag?: unknown; Size?: unknown };
        collected.push({
          number: Number(raw.PartNumber),
          etag: String(raw.ETag),
          size: Number(raw.Size ?? 0),
        });
      }

      if (String(page.isTruncated) !== 'true') break;
      const nextMarker = Number(page.nextPartNumberMarker);
      if (!Number.isFinite(nextMarker) || nextMarker <= marker) break;
      marker = nextMarker;
    }

    collected.sort((a, b) => a.number - b.number);
    return collected;
  }

  /**
   * 合并分片、完成上传。ETag 由服务端自行取回，调用方不需要提供。
   * @param expectedParts 前端认为应有的片数；用于在合并前拦住漏片的情况。
   */
  async completeMultipartUpload(
    objectKey: string,
    uploadId: string,
    expectedParts?: number,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const parts = await this.listUploadedParts(objectKey, uploadId);
    if (parts.length === 0) {
      return { ok: false, reason: '没有任何分片上传成功' };
    }
    if (typeof expectedParts === 'number' && parts.length !== expectedParts) {
      return { ok: false, reason: `分片不完整：期望 ${expectedParts} 片，OSS 上只有 ${parts.length} 片` };
    }

    const res = await this.withOssFallback(
      'completeMultipartUpload',
      (client, timeout) =>
        client.completeMultipartUpload(
          objectKey,
          uploadId,
          parts.map((p) => ({ number: p.number, etag: p.etag })),
          timeout ? { timeout } : {},
        ),
      // 合并是 OSS 服务端真正拼数据的一步，几百片可能要数秒。给内网 60s：超时回退会重跑
      // complete，而第一次若其实已成功，重跑只会拿到 NoSuchUpload 并误报失败。
      60_000,
    );
    return res ? { ok: true } : { ok: false, reason: 'OSS 合并分片失败' };
  }

  /** 中止分片上传并清理已传分片。用户取消/放弃时调用，否则残留分片会一直计费。 */
  async abortMultipartUpload(objectKey: string, uploadId: string): Promise<void> {
    await this.withOssFallback('abortMultipartUpload', (client, timeout) =>
      client.abortMultipartUpload(objectKey, uploadId, timeout ? { timeout } : {}),
    );
  }

  /** Delete an object from OSS. Silently ignores errors (e.g. object already gone). */
  async deleteObject(objectKey: string): Promise<void> {
    if (!this.internalClient) return;
    try {
      await this.internalClient.delete(objectKey);
    } catch (err) {
      this.logger.warn(`OSS 删除失败 (忽略): ${objectKey}`, err);
    }
  }

  /** Check if an object exists and return its size and content-type. Returns null if not found. */
  async headObject(objectKey: string): Promise<{ size: number; contentType: string } | null> {
    if (!this.internalClient) return null;
    try {
      const result = await this.internalClient.head(objectKey);
      return {
        size: Number(result.res.headers['content-length'] ?? 0),
        contentType: String(result.res.headers['content-type'] ?? ''),
      };
    } catch {
      return null;
    }
  }

  /**
   * Open a readable stream for an object, used by the same-origin preview proxy so the
   * browser can render PDFs/images inline (the bucket forces Content-Disposition: attachment
   * on direct signed URLs, which makes iframes download instead of preview).
   * Tries the internal endpoint first, then the public endpoint.
   */
  async getObjectStream(
    objectKey: string,
  ): Promise<{ stream: NodeJS.ReadableStream; contentType: string; size: number } | null> {
    // Internal endpoint first (free OSS→ECS transfer inside the VPC), then public. The internal
    // attempt gets a short timeout so that outside the VPC (e.g. local dev, where the internal
    // endpoint is unreachable) we fail over to public in ~2s instead of hanging on the TLS
    // handshake. In production the internal endpoint answers in well under 100ms.
    const attempts: Array<{ client: OSS; timeout?: number }> = [];
    if (this.internalClient) attempts.push({ client: this.internalClient, timeout: 2000 });
    if (this.publicClient && this.publicClient !== this.internalClient) attempts.push({ client: this.publicClient });

    for (const { client, timeout } of attempts) {
      try {
        const result = await client.getStream(objectKey, timeout ? { timeout } : {});
        const headers = (result.res?.headers ?? {}) as Record<string, string>;
        return {
          stream: result.stream as NodeJS.ReadableStream,
          contentType: String(headers['content-type'] ?? '') || 'application/octet-stream',
          size: Number(headers['content-length'] ?? 0),
        };
      } catch (err) {
        this.logger.warn(`OSS getStream 失败(${objectKey}): ${(err as Error)?.message ?? err}`);
      }
    }
    return null;
  }

  /** HMAC secret for self-authenticating preview tokens (iframes can't send Authorization headers). */
  private previewSecret(): string {
    return (
      this.config.get<string>('OSS_PREVIEW_SECRET') ||
      this.config.get<string>('JWT_SECRET') ||
      'change-me-jwt-secret'
    );
  }

  /** Sign a time-limited HMAC token authorizing inline preview of an object via the proxy. */
  signPreviewToken(objectKey: string, expiresSeconds = 24 * 3600): { exp: number; sig: string } {
    // exp 对齐到 UTC 天界（向上取整）：同一天内对同一对象产出完全相同的 exp/sig，
    // 使 preview URL 稳定 → 浏览器缓存可命中（否则每次拉取都换 query，图片/PDF 反复重下）。
    // 实际有效期 ≥ expiresSeconds 且 < expiresSeconds + 24h。
    const DAY = 24 * 3600;
    const exp = Math.ceil((Math.floor(Date.now() / 1000) + expiresSeconds) / DAY) * DAY;
    const sig = createHmac('sha256', this.previewSecret()).update(`${objectKey}|${exp}`).digest('hex');
    return { exp, sig };
  }

  /** Constant-time verify of a preview token. */
  verifyPreviewToken(objectKey: string, exp: number, sig: string): boolean {
    if (!objectKey || !sig || !Number.isFinite(exp)) return false;
    if (exp < Math.floor(Date.now() / 1000)) return false;
    const expected = createHmac('sha256', this.previewSecret()).update(`${objectKey}|${exp}`).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  private guessMime(ext: string): string {
    const map: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.zip': 'application/zip',
      '.txt': 'text/plain',
    };
    return map[ext.toLowerCase()] ?? 'application/octet-stream';
  }
}
