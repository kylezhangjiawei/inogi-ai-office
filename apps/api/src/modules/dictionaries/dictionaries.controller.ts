import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { ListDictionaryItemsQueryDto } from './dto/list-dictionary-items-query.dto';
import { SaveDictionaryItemDto } from './dto/save-dictionary-item.dto';
import { SaveDictionaryTypeDto } from './dto/save-dictionary-type.dto';
import { DictionariesService } from './dictionaries.service';

type AuthenticatedRequest = Request & {
  user?: {
    id: string;
  };
};

/**
 * 字典主数据。此前全端点无 @Permissions —— RolesGuard 的规则是「无声明即放行」，
 * 于是任何登录用户都能增删字典类型与条目（AI 模型供应商等靠字典驱动）。
 *
 * 读写分权，避免收紧后打死既有页面：
 * - 读（listTypes / listItems）：字典页与 **AI 模型管理页**（AiModelManagementPage
 *   用它取供应商列表）都要用 → 两个页面码都放行；
 * - 写（增删类型/条目）：只归字典页。
 */
@Controller('dictionaries')
export class DictionariesController {
  constructor(private readonly dictionariesService: DictionariesService) {}

  @Get('types')
  @Permissions('page:settings', 'page:ai-model-management')
  listTypes() {
    return this.dictionariesService.listTypes();
  }

  @Post('types')
  @Permissions('page:settings')
  saveType(@Body() payload: SaveDictionaryTypeDto, @Req() req: AuthenticatedRequest) {
    return this.dictionariesService.saveType(payload, req.user?.id);
  }

  @Delete('types/:typeId')
  @Permissions('page:settings')
  deleteType(@Param('typeId') typeId: string) {
    return this.dictionariesService.deleteType(typeId);
  }

  @Get('types/:typeId/items')
  @Permissions('page:settings', 'page:ai-model-management')
  listItems(@Param('typeId') typeId: string, @Query() query: ListDictionaryItemsQueryDto) {
    return this.dictionariesService.listItems(typeId, query);
  }

  @Post('types/:typeId/items')
  @Permissions('page:settings')
  saveItem(
    @Param('typeId') typeId: string,
    @Body() payload: SaveDictionaryItemDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dictionariesService.saveItem(typeId, payload, req.user?.id);
  }

  @Delete('items/:itemId')
  @Permissions('page:settings')
  deleteItem(@Param('itemId') itemId: string) {
    return this.dictionariesService.deleteItem(itemId);
  }
}
