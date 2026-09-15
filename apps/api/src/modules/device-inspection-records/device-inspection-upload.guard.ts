import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';

@Injectable()
export class DeviceInspectionUploadGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const configured = this.config.get<string>('FACTORY_QC_UPLOAD_TOKEN');
    if (!configured || !configured.trim()) throw new ServiceUnavailableException('检测记录上传尚未配置');
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string } }>();
    const header = request.headers.authorization;
    const candidate = typeof header === 'string' && /^Bearer [^\s]+$/i.test(header) ? header.slice(7) : '';
    const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
    if (!candidate || !timingSafeEqual(digest(candidate), digest(configured))) throw new UnauthorizedException('检测记录上传凭据无效');
    return true;
  }
}
