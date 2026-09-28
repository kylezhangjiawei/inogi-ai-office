import { Body, Controller, Post, Request } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ProductionScenarioService } from './production-scenario.service';
@Controller('procurement/production-scenarios')
export class ProductionScenarioController {
  constructor(private readonly service: ProductionScenarioService) {}
  @Post('simulate') @Permissions('page:production-execution')
  simulate(@Body() input: Record<string, unknown>, @Request() req: { user: { id: string; name?: string; permissions: string[] } }) {
    return this.service.simulate(input, { ...req.user, name: req.user.name ?? '' });
  }
}
