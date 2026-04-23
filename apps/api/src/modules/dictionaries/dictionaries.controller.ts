import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';

import { ListDictionaryItemsQueryDto } from './dto/list-dictionary-items-query.dto';
import { SaveDictionaryItemDto } from './dto/save-dictionary-item.dto';
import { SaveDictionaryTypeDto } from './dto/save-dictionary-type.dto';
import { DictionariesService } from './dictionaries.service';

type AuthenticatedRequest = Request & {
  user?: {
    id: string;
  };
};

@Controller('dictionaries')
export class DictionariesController {
  constructor(private readonly dictionariesService: DictionariesService) {}

  @Get('types')
  listTypes() {
    return this.dictionariesService.listTypes();
  }

  @Post('types')
  saveType(@Body() payload: SaveDictionaryTypeDto, @Req() req: AuthenticatedRequest) {
    return this.dictionariesService.saveType(payload, req.user?.id);
  }

  @Delete('types/:typeId')
  deleteType(@Param('typeId') typeId: string) {
    return this.dictionariesService.deleteType(typeId);
  }

  @Get('types/:typeId/items')
  listItems(@Param('typeId') typeId: string, @Query() query: ListDictionaryItemsQueryDto) {
    return this.dictionariesService.listItems(typeId, query);
  }

  @Post('types/:typeId/items')
  saveItem(
    @Param('typeId') typeId: string,
    @Body() payload: SaveDictionaryItemDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dictionariesService.saveItem(typeId, payload, req.user?.id);
  }

  @Delete('items/:itemId')
  deleteItem(@Param('itemId') itemId: string) {
    return this.dictionariesService.deleteItem(itemId);
  }
}
