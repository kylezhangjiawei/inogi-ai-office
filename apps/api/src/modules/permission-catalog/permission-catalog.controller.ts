import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { SavePermissionCatalogItemDto } from './dto/save-permission-catalog-item.dto';
import { PermissionCatalogService } from './permission-catalog.service';

@Controller('permission-catalog')
export class PermissionCatalogController {
  constructor(private readonly permissionCatalogService: PermissionCatalogService) {}

  @Get('groups')
  @Permissions('page:roles', 'page:route-management')
  listGroups(@Query('enabled_only') enabledOnly?: string) {
    return this.permissionCatalogService.listGroups({ enabledOnly: enabledOnly !== 'false' });
  }

  @Get('items')
  @Permissions('page:route-management')
  listItems() {
    return this.permissionCatalogService.listItems();
  }

  /**
   * Returns an array of permission codes that are marked as nav-hidden.
   * Used by the sidebar to filter which nav items to show.
   * Requires only basic login (page:dashboard is the minimum permission any user has).
   */
  @Get('nav-hidden')
  @Permissions('page:dashboard')
  getNavHiddenCodes() {
    return this.permissionCatalogService.getNavHiddenCodes();
  }

  @Post('items')
  @Permissions('page:route-management')
  save(@Body() payload: SavePermissionCatalogItemDto) {
    return this.permissionCatalogService.save(payload);
  }

  @Delete('items/:id')
  @Permissions('page:route-management')
  remove(@Param('id') id: string) {
    return this.permissionCatalogService.remove(id);
  }
}
