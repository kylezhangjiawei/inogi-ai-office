import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { OssService } from '../oss/oss.service';
import {
  OSS_ALLOWED_MIME_TYPES,
  OSS_MAX_FILE_SIZE,
  OssBusinessType,
  SIGNED_URL_TTL_SECONDS,
} from '../oss/oss.constants';

type UploadedFile = {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
};

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ossService: OssService,
  ) {}

  async uploadFile(
    userId: string,
    file: UploadedFile,
    businessType: OssBusinessType,
    businessId?: string,
  ) {
    if (!this.ossService.isEnabled) {
      throw new BadRequestException('OSS 未配置，无法上传文件');
    }

    this.validateFile(file, businessType);

    const bucket = process.env.OSS_BUCKET ?? '';
    const objectKey = await this.ossService.uploadBuffer(
      file.buffer,
      businessType,
      file.originalname,
      file.mimetype,
    );

    if (!objectKey) {
      throw new BadRequestException('文件上传失败，请稍后重试');
    }

    const fileHash = createHash('md5').update(file.buffer).digest('hex');

    const asset = await this.prisma.fileAsset.create({
      data: {
        bucket,
        objectKey,
        fileName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileHash,
        businessType,
        businessId: businessId ?? null,
        uploadedBy: userId,
        status: 'active',
      },
    });

    const signedUrl = this.ossService.getSignedUrl(objectKey, SIGNED_URL_TTL_SECONDS.DEFAULT);

    return {
      fileId: asset.id,
      objectKey: asset.objectKey,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
      signedUrl,
      expiresIn: SIGNED_URL_TTL_SECONDS.DEFAULT,
    };
  }

  async getSignedUrl(userId: string, fileId: string) {
    const asset = await this.findActiveAsset(fileId);
    this.checkOwnership(asset.uploadedBy, userId);

    const signedUrl = this.ossService.getSignedUrl(asset.objectKey, SIGNED_URL_TTL_SECONDS.DEFAULT);
    if (!signedUrl) {
      throw new BadRequestException('OSS 未配置，无法生成访问链接');
    }

    return {
      fileId: asset.id,
      signedUrl,
      expiresIn: SIGNED_URL_TTL_SECONDS.DEFAULT,
    };
  }

  async deleteFile(userId: string, fileId: string) {
    const asset = await this.findActiveAsset(fileId);
    this.checkOwnership(asset.uploadedBy, userId);

    await this.ossService.deleteObject(asset.objectKey);

    await this.prisma.fileAsset.update({
      where: { id: fileId },
      data: { status: 'deleted', deletedAt: new Date() },
    });

    return { success: true };
  }

  private async findActiveAsset(fileId: string) {
    const asset = await this.prisma.fileAsset.findFirst({
      where: { id: fileId, status: 'active' },
    });
    if (!asset) {
      throw new NotFoundException('文件不存在或已删除');
    }
    return asset;
  }

  private checkOwnership(uploadedBy: string | null, requestingUserId: string) {
    if (uploadedBy && uploadedBy !== requestingUserId) {
      throw new ForbiddenException('无权访问该文件');
    }
  }

  private validateFile(file: UploadedFile, businessType: OssBusinessType) {
    const maxSize = OSS_MAX_FILE_SIZE[businessType];
    if (file.size > maxSize) {
      throw new BadRequestException(
        `文件大小超出限制，最大允许 ${Math.round(maxSize / 1024 / 1024)} MB`,
      );
    }

    const allowed = OSS_ALLOWED_MIME_TYPES[businessType];
    if (!allowed.includes('*/*') && !allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        `不支持的文件类型 ${file.mimetype}，允许: ${allowed.join(', ')}`,
      );
    }
  }
}
