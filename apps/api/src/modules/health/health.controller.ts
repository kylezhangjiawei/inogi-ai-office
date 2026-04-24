import { Controller, Get } from '@nestjs/common';

import { Public } from '../auth/decorators/public.decorator';

const STARTED_AT = new Date().toISOString();

@Controller('health')
export class HealthController {
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
        process.env.GIT_COMMIT_SHA ??
        process.env.COMMIT_SHA ??
        process.env.VERCEL_GIT_COMMIT_SHA ??
        'unknown',
      started_at: STARTED_AT,
    };
  }
}
