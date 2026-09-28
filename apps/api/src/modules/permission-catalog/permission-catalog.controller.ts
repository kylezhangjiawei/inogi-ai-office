import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { ReorderPermissionCatalogItemsDto } from './dto/reorder-permission-catalog-items.dto';
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
   * 导航与路由元数据：{ code, routePath, navHidden, sortOrder }[]。
   * 侧边栏据此过滤导航项，路由层据此决定每个页面挂在哪个路径。
   * 只要求最低权限（page:dashboard 是任何用户都有的）—— 普通用户同样需要拿到自定义路径，
   * 否则管理员在页面路由管理里改的路径对他们不生效。
   *
   * 取代原 GET nav-hidden（只返回 code 数组）；前端已同步改用本接口。
   */
  @Get('nav-meta')
  @Permissions('page:dashboard')
  getNavMeta() {
    return this.permissionCatalogService.getNavMeta();
  }

  @Post('items')
  @Permissions('page:route-management')
  save(@Body() payload: SavePermissionCatalogItemDto) {
    return this.permissionCatalogService.save(payload);
  }

  @Post('items/reorder')
  @Permissions('page:route-management')
  reorder(@Body() payload: ReorderPermissionCatalogItemsDto) {
    return this.permissionCatalogService.reorder(payload);
  }

  @Delete('items/:id')
  @Permissions('page:route-management')
  remove(@Param('id') id: string) {
    return this.permissionCatalogService.remove(id);
  }
}
