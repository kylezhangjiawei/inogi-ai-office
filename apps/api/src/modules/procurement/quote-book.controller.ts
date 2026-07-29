import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Request,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { AiParseQuotesDto, ImportSupplierQuotesDto, UpsertSupplierQuoteDto } from './dto/procurement.dto';
import { QuoteBookService } from './quote-book.service';
import type { ProcActor } from './procurement.types';

type AuthedRequest = {
  user: { id: string; name?: string; username?: string; permissions: string[] };
};

/**
 * 供应商报价库：同一商品跨厂家的比价基准维护（树形：商品 → 厂家 → 阶梯价）。
 * 读操作仅需登录（页面入口由 page:proc-quote-book 路由守卫控制）；
 * 写操作用独立操作码 quote-book:manage，过渡期兼容 proc-task:inquiry（RolesGuard 为任一命中）。
 */
@Controller('procurement/quote-book')
export class QuoteBookController {
  constructor(private readonly service: QuoteBookService) {}

  private actor(req: AuthedRequest): ProcActor {
    return {
      id: req.user.id,
      name: req.user.name ?? req.user.username ?? '',
      permissions: req.user.permissions ?? [],
    };
  }

  @Get()
  list() {
    return this.service.listQuoteBook();
  }

  @Get('suppliers')
  listSuppliers() {
    return this.service.listSuppliers();
  }

  @Post('quotes')
  @Permissions('quote-book:manage', 'proc-task:inquiry')
  createQuote(@Body() dto: UpsertSupplierQuoteDto, @Request() req: AuthedRequest) {
    return this.service.createQuote(dto, this.actor(req));
  }

  @Put('quotes/:id')
  @Permissions('quote-book:manage', 'proc-task:inquiry')
  updateQuote(@Param('id') id: string, @Body() dto: UpsertSupplierQuoteDto) {
    return this.service.updateQuote(id, dto);
  }

  @Delete('quotes/:id')
  @Permissions('quote-book:manage', 'proc-task:inquiry')
  deleteQuote(@Param('id') id: string) {
    return this.service.deleteQuote(id);
  }

  @Post('import')
  @Permissions('quote-book:manage', 'proc-task:inquiry')
  importQuotes(@Body() dto: ImportSupplierQuotesDto, @Request() req: AuthedRequest) {
    return this.service.importQuotes(dto, this.actor(req));
  }

  /** AI 识别报价表兜底：入参为表格 CSV 文本，产出结构化 items（不落库，前端确认后走 import）。 */
  @Post('ai-parse')
  @Permissions('quote-book:manage', 'proc-task:inquiry')
  aiParseQuotes(@Body() dto: AiParseQuotesDto) {
    return this.service.aiParseQuotes(dto);
  }

  /** 图片表格导入：OCR 提取文本后走 AI 抽取（不落库）。 */
  @Post('ocr-parse')
  @Permissions('quote-book:manage', 'proc-task:inquiry')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024, files: 1 } }))
  ocrParseQuotes(
    @UploadedFile() file?: { originalname: string; buffer: Buffer; mimetype: string },
  ) {
    if (!file) throw new BadRequestException('缺少图片文件');
    if (!/^image\//.test(file.mimetype)) throw new BadRequestException('仅支持图片文件（png/jpg 等）');
    return this.service.ocrParseQuotes({
      originalname: file.originalname,
      buffer: file.buffer,
      mimetype: file.mimetype,
    });
  }

  @Delete('materials/:materialId/quotes')
  @Permissions('quote-book:manage', 'proc-task:inquiry')
  clearMaterialQuotes(@Param('materialId') materialId: string) {
    return this.service.clearMaterialQuotes(materialId);
  }
}
