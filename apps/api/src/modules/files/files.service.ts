import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { OssService } from '../oss/oss.service';
import {
  OSS_ALLOWED_MIME_TYPES,
  OSS_MAX_FILE_SIZE,
  OssBusinessType,
  SIGNED_URL_TTL_SECONDS,
} from '../oss/oss.constants';
import { AbortFileUploadDto, PresignFileUploadDto, RegisterFileUploadDto } from './dto/direct-file-upload.dto';

type UploadedFile = {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
};

type FileDescriptor = {
  mimeType: string;
  fileSize: number;
};

type FileAssetResult = {
  id: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
};

@Injectable()
export class FilesService {
  private static readonly DIRECT_UPLOAD_CACHE_CONTROL = 'private, max-age=31536000, immutable';

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

    this.validateFile({ mimeType: file.mimetype, fileSize: file.size }, businessType);

    const objectKey = await this.ossService.uploadBuffer(
      file.buffer,
      businessType,
      file.originalname,
      file.mimetype,
    );
    if (!objectKey) {
      throw new BadRequestException('文件上传失败，请稍后重试');
    }

    try {
      const asset = await this.prisma.fileAsset.create({
        data: {
          bucket: process.env.OSS_BUCKET ?? '',
          objectKey,
          fileName: file.originalname,
          mimeType: file.mimetype,
          fileSize: file.size,
          fileHash: createHash('md5').update(file.buffer).digest('hex'),
          businessType,
          businessId: businessId ?? null,
          uploadedBy: userId,
          status: 'active',
        },
      });
      return this.buildUploadResult(asset);
    } catch (error) {
      await this.ossService.deleteObject(objectKey);
      throw error;
    }
  }

  presignUpload(userId: string, dto: PresignFileUploadDto) {
    if (!this.ossService.isEnabled) {
      throw new BadRequestException('OSS 未配置，无法上传文件');
    }
    this.validateFile(dto, dto.businessType);

    const objectKey = this.ossService.buildObjectKey(
      `${dto.businessType}/${this.userScope(userId)}`,
      dto.fileName,
    );
    const putUrl = this.ossService.generatePutSignedUrl(objectKey, dto.mimeType);
    if (!putUrl) throw new BadRequestException('无法生成 OSS 上传地址');

    return {
      objectKey,
      putUrl,
      contentType: dto.mimeType,
      cacheControl: FilesService.DIRECT_UPLOAD_CACHE_CONTROL,
      expiresIn: 3600,
    };
  }

  async registerUpload(userId: string, dto: RegisterFileUploadDto) {
    this.validateOwnedDirectKey(userId, dto.businessType, dto.objectKey);
    this.validateFile(dto, dto.businessType);

    const existing = await this.prisma.fileAsset.findUnique({ where: { objectKey: dto.objectKey } });
    if (existing) {
      this.checkOwnership(existing.uploadedBy, userId);
      return this.buildUploadResult(existing);
    }

    const object = await this.ossService.headObject(dto.objectKey);
    if (!object) throw new BadRequestException('OSS 文件不存在或上传未完成');
    if (object.size !== dto.fileSize) {
      await this.ossService.deleteObject(dto.objectKey);
      throw new BadRequestException('OSS 文件大小校验失败，请重新上传');
    }

    const actualMime = this.normalizeMime(object.contentType);
    const expectedMime = this.normalizeMime(dto.mimeType);
    if (actualMime && expectedMime && actualMime !== expectedMime) {
      await this.ossService.deleteObject(dto.objectKey);
      throw new BadRequestException('OSS 文件类型校验失败，请重新上传');
    }

    try {
      const asset = await this.prisma.fileAsset.create({
        data: {
          bucket: process.env.OSS_BUCKET ?? '',
          objectKey: dto.objectKey,
          fileName: dto.fileName,
          mimeType: dto.mimeType,
          fileSize: object.size,
          businessType: dto.businessType,
          businessId: dto.businessId ?? null,
          uploadedBy: userId,
          status: 'active',
        },
      });
      return this.buildUploadResult(asset);
    } catch (error) {
      // Registration is idempotent: a retry racing with the first request returns that asset.
      if ((error as { code?: string }).code === 'P2002') {
        const raced = await this.prisma.fileAsset.findUnique({ where: { objectKey: dto.objectKey } });
        if (raced) {
          this.checkOwnership(raced.uploadedBy, userId);
          return this.buildUploadResult(raced);
        }
      }
      await this.ossService.deleteObject(dto.objectKey);
      throw error;
    }
  }

  async abortUpload(userId: string, dto: AbortFileUploadDto) {
    this.validateOwnedDirectKey(userId, dto.businessType, dto.objectKey);
    const registered = await this.prisma.fileAsset.findUnique({ where: { objectKey: dto.objectKey } });
    if (registered) {
      this.checkOwnership(registered.uploadedBy, userId);
      throw new BadRequestException('文件已登记，请使用删除文件接口');
    }
    await this.ossService.deleteObject(dto.objectKey);
    return { success: true };
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

  private buildUploadResult(asset: FileAssetResult) {
    return {
      fileId: asset.id,
      objectKey: asset.objectKey,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
      signedUrl: this.ossService.getSignedUrl(asset.objectKey, SIGNED_URL_TTL_SECONDS.DEFAULT),
      expiresIn: SIGNED_URL_TTL_SECONDS.DEFAULT,
    };
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

  private validateFile(file: FileDescriptor, businessType: OssBusinessType) {
    const maxSize = OSS_MAX_FILE_SIZE[businessType];
    if (file.fileSize > maxSize) {
      throw new BadRequestException(
        `文件大小超出限制，最大允许 ${Math.round(maxSize / 1024 / 1024)} MB`,
      );
    }

    const allowed = OSS_ALLOWED_MIME_TYPES[businessType];
    if (!allowed.includes('*/*') && !allowed.includes(file.mimeType)) {
      throw new BadRequestException(
        `不支持的文件类型 ${file.mimeType}，允许：${allowed.join(', ')}`,
      );
    }
  }

  private userScope(userId: string): string {
    return userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  }

  private validateOwnedDirectKey(userId: string, businessType: OssBusinessType, objectKey: string) {
    const expectedPrefix = this.ossService.resolveKeyPrefix(`${businessType}/${this.userScope(userId)}/`);
    if (!objectKey.startsWith(expectedPrefix)) {
      throw new ForbiddenException('无权操作该 OSS 文件');
    }
  }

  private normalizeMime(mimeType: string): string {
    return mimeType.split(';')[0].trim().toLocaleLowerCase('en-US');
  }
}
