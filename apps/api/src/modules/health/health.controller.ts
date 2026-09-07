import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

const STARTED_AT = new Date().toISOString();

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('ready')
  async getReadiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ ok: false, message: '数据库暂不可用', database: 'unavailable' });
    }
    return { ...this.getHealth(), database: 'ready' };
  }

  @Public()
  @Get()
  getHealth() {
    return {
      ok: true,
      service: 'inogi-api',
      timestamp: new Date().toISOString(),
      release: process.env.APP_VERSION ?? process.env.npm_package_version ?? 'dev',
      git_sha:
        process.env.APP_GIT_SHA ??
        process.env.GIT_COMMIT ??
        process.env.GIT_COMMIT_SHA ??
        process.env.COMMIT_SHA ??
        process.env.SOURCE_VERSION ??
        process.env.RENDER_GIT_COMMIT ??
        process.env.VERCEL_GIT_COMMIT_SHA ??
        'unknown',
      started_at: STARTED_AT,
    };
  }
}
