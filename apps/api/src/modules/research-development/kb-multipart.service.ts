import { BadRequestException, Injectable } from '@nestjs/common';

import {
  OSS_DEFAULT_PART_BYTES,
  OSS_MAX_MULTIPART_PARTS,
  OSS_MAX_PART_BYTES,
} from '../oss/oss.constants';
import { OssService } from '../oss/oss.service';

/**
 * 知识库大文件分片上传。研发库与部门库共用这一套，两边只是对象前缀和鉴权不同：
 * 前缀由调用方（各自的 controller）传入，鉴权由各自的装饰器把守。
 *
 * 为什么要分片：预签名单次 PUT 走的是 OSS「简单上传」，单个对象上限 5GB，超过会被
 * OSS 直接拒绝。分片后单对象上限 48.8TB。小文件仍走原来的 presign-upload，不受影响。
 *
 * 流程：init（拿 uploadId 和后端定的 partSize）→ 前端按 partSize 切片，逐片向 sign
 * 签出的 URL 直传 → complete（服务端 listParts 取 ETag 后合并）。
 * 中断后可用 status 查已传分片，跳过它们继续传（断点续传）。
 */
@Injectable()
export class KbMultipartService {
  constructor(private readonly ossService: OssService) {}

  /**
   * 选定分片大小。默认 32MB；只有当文件大到会超出 10000 片上限时才翻倍，
   * 让文件落进 OSS 的片数约束内。
   *
   * 翻倍不能无限进行：单片本身上限 5GB，所以 32MB 最多翻到 4GB，
   * 乘以 10000 片 = 40TB —— 这就是本实现真正的文件大小上限（见 MAX_UPLOAD_BYTES）。
   */
  private pickPartSize(fileSize: number): number {
    let partSize = OSS_DEFAULT_PART_BYTES;
    while (Math.ceil(fileSize / partSize) > OSS_MAX_MULTIPART_PARTS) {
      const next = partSize * 2;
      if (next > OSS_MAX_PART_BYTES) {
        throw new BadRequestException('文件过大，超出分片上传能力上限');
      }
      partSize = next;
    }
    return partSize;
  }

  /**
   * 前端回传的 objectKey 必须落在本业务前缀下，否则就能借我们的签名往桶里任意路径写。
   * sign / complete / abort / status 全部先过这一关。
   */
  private assertKeyAllowed(objectKey: string, businessType: string): void {
    if (!objectKey || !this.ossService.isKeyUnderBusinessType(objectKey, businessType)) {
      throw new BadRequestException('对象路径不合法');
    }
  }

  /** 第 1 步：初始化分片上传，返回 uploadId 与前端必须遵循的 partSize。 */
  async init(businessType: string, filename: string, contentType: string, fileSize: number) {
    if (!this.ossService.isEnabled) {
      return { enabled: false as const };
    }
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      throw new BadRequestException('文件大小无效');
    }

    const ct = contentType || 'application/octet-stream';
    // 先算分片大小：pickPartSize 对超限文件会抛错，必须赶在创建 OSS uploadId 之前，
    // 否则超大文件会先在 OSS 上留下一个永不 complete 的孤儿 uploadId 再抛错。
    const partSize = this.pickPartSize(fileSize);
    const objectKey = this.ossService.buildObjectKey(businessType, filename);
    const uploadId = await this.ossService.initMultipartUpload(objectKey, ct);
    if (!uploadId) {
      throw new BadRequestException('初始化分片上传失败');
    }

    return {
      enabled: true as const,
      objectKey,
      uploadId,
      partSize,
      partCount: Math.ceil(fileSize / partSize),
      contentType: ct,
    };
  }

  /**
   * 第 2 步：为指定分片批量签 PUT URL。
   * 前端按需分批来签（而不是一次签几百个），避免长传过程中签名先过期。
   */
  sign(businessType: string, objectKey: string, uploadId: string, partNumbers: number[]) {
    this.assertKeyAllowed(objectKey, businessType);
    if (!uploadId) throw new BadRequestException('缺少 uploadId');

    const wanted = (partNumbers ?? []).filter(
      (n) => Number.isInteger(n) && n >= 1 && n <= OSS_MAX_MULTIPART_PARTS,
    );
    if (wanted.length === 0) {
      throw new BadRequestException('分片编号无效');
    }

    const urls = wanted.map((partNumber) => ({
      partNumber,
      url: this.ossService.generatePartSignedUrl(objectKey, uploadId, partNumber),
    }));
    return { urls };
  }

  /** 查询已成功上传的分片，用于断点续传时跳过它们。 */
  async status(businessType: string, objectKey: string, uploadId: string) {
    this.assertKeyAllowed(objectKey, businessType);
    if (!uploadId) throw new BadRequestException('缺少 uploadId');

    const parts = await this.ossService.listUploadedParts(objectKey, uploadId);
    return { parts: parts.map((p) => ({ partNumber: p.number, size: p.size })) };
  }

  /** 第 3 步：合并分片。ETag 由服务端取回，前端不需要提供（bucket 未开放 ETag 跨域读取）。 */
  async complete(businessType: string, objectKey: string, uploadId: string, partCount?: number) {
    this.assertKeyAllowed(objectKey, businessType);
    if (!uploadId) throw new BadRequestException('缺少 uploadId');

    const result = await this.ossService.completeMultipartUpload(objectKey, uploadId, partCount);
    if (!result.ok) {
      throw new BadRequestException(result.reason);
    }
    return { ok: true as const, objectKey };
  }

  /** 放弃上传并清理已传分片，否则残留分片会持续占用存储、产生费用。 */
  async abort(businessType: string, objectKey: string, uploadId: string) {
    this.assertKeyAllowed(objectKey, businessType);
    if (!uploadId) throw new BadRequestException('缺少 uploadId');

    await this.ossService.abortMultipartUpload(objectKey, uploadId);
    return { ok: true as const };
  }
}
