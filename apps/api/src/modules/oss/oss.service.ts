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
  getSignedUrl(objectKey: string, expiresSeconds = 600): string | null {
    if (!this.publicClient) return null;
    try {
      return this.publicClient.signatureUrl(objectKey, { expires: expiresSeconds });
    } catch {
      return null;
    }
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
    const exp = Math.floor(Date.now() / 1000) + expiresSeconds;
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
