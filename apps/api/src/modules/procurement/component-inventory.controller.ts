import { Body, Controller, Get, Param, Put, Query, Request } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ComponentInventoryService, type ComponentInventoryInput } from './component-inventory.service';
@Controller('procurement/component-inventory')
export class ComponentInventoryController {
  constructor(private readonly inventory: ComponentInventoryService) {}
  @Get()
  @Permissions('page:proc-cockpit')
  read(@Query('materialIds') ids: string = '') { return this.inventory.read(typeof ids === 'string' ? ids.split(',').filter(Boolean) : ['']); }
  @Put(':id')
  @Permissions('proc-task:create')
  save(@Param('id') id: string, @Body() input: ComponentInventoryInput, @Request() req: any) {
    return this.inventory.save(id, input, { id: req.user.id, name: req.user.name || req.user.username, permissions: req.user.permissions || [] });
  }
}
