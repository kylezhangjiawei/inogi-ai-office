import { Controller, Get } from '@nestjs/common';

import { Public } from '../auth/decorators/public.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  getHealth() {
    return {
      ok: true,
      service: 'inogi-api',
      timestamp: new Date().toISOString(),
    };
  }
}
