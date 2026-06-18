import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import { Public } from '../auth/decorators/public.decorator';
import { CreateExpenseReimbursementDto } from './dto/create-expense-reimbursement.dto';
import { LinkExpenseVoucherDto } from './dto/link-expense-voucher.dto';
import { ListExpenseInvoicesQueryDto } from './dto/list-expense-invoices-query.dto';
import { SaveExpenseIntegrationConfigDto } from './dto/save-expense-integration-config.dto';
import { UpdateExpenseInvoiceDto } from './dto/update-expense-invoice.dto';
import { UploadExpenseOcrFilesDto } from './dto/upload-expense-ocr-files.dto';
import { ExpenseService, type ExpenseScope } from './expense.service';

type AuthedRequest = {
  user?: {
    id?: string;
    name?: string;
    permissions?: string[];
    department?: string | null;
    departmentCode?: string | null;
  };
};

/** 据当前用户构建费用数据作用域；filterDepartment 仅对 view-all 生效。 */
function buildExpenseScope(req: AuthedRequest, filterDepartment?: string): ExpenseScope {
  const perms = req.user?.permissions ?? [];
  const hasViewAll = perms.includes('*') || perms.includes('expense:view-all');
  return {
    departmentCode: req.user?.departmentCode ?? null,
    departmentName: req.user?.department ?? null,
    hasViewAll,
    filterDepartment: hasViewAll ? filterDepartment?.trim() || undefined : undefined,
  };
}

@Controller('expenses')
export class ExpenseController {
  constructor(private readonly expenseService: ExpenseService) {}

  @Get('dashboard')
  getDashboard(@Request() req: AuthedRequest, @Query('department') department?: string) {
    return this.expenseService.getDashboard(buildExpenseScope(req, department));
  }

  @Get('invoices')
  listInvoices(
    @Query() query: ListExpenseInvoicesQueryDto,
    @Request() req: AuthedRequest,
    @Query('department') department?: string,
  ) {
    return this.expenseService.listInvoices(query, buildExpenseScope(req, department));
  }

  @Get('ocr/services')
  getOcrServices() {
    return this.expenseService.getOcrServices();
  }

  @Post('invoices/upload')
  @UseInterceptors(FilesInterceptor('files', 30))
  uploadInvoices(
    @UploadedFiles() files: Array<{ originalname: string; buffer: Buffer; mimetype?: string }>,
    @Body() payload: UploadExpenseOcrFilesDto,
    @Request() req: AuthedRequest,
  ) {
    return this.expenseService.uploadInvoices(files ?? [], payload, buildExpenseScope(req));
  }

  @Post('vouchers/upload')
  @UseInterceptors(FilesInterceptor('files', 30))
  uploadVouchers(
    @UploadedFiles() files: Array<{ originalname: string; buffer: Buffer; mimetype?: string }>,
    @Body() payload: UploadExpenseOcrFilesDto,
    @Request() req: AuthedRequest,
  ) {
    return this.expenseService.uploadVouchers(files ?? [], payload, buildExpenseScope(req));
  }

  @Post('vouchers/auto-match')
  autoMatchVouchers(@Request() req: AuthedRequest) {
    return this.expenseService.autoMatchVouchers(buildExpenseScope(req));
  }

  /** 批量改派部门（仅 view-all）。 */
  @Post('reassign-department')
  reassignDepartment(
    @Body() payload: { type?: 'invoice' | 'voucher' | 'reimbursement'; ids?: string[]; department_code?: string },
    @Request() req: AuthedRequest,
  ) {
    return this.expenseService.reassignDepartment(payload, buildExpenseScope(req));
  }

  @Patch('invoices/:invoiceId')
  updateInvoice(
    @Param('invoiceId') invoiceId: string,
    @Body() payload: UpdateExpenseInvoiceDto,
    @Request() req: AuthedRequest,
  ) {
    return this.expenseService.updateInvoice(invoiceId, payload, buildExpenseScope(req));
  }

  @Post('invoices/:invoiceId/vat-verify')
  verifyVatInvoice(@Param('invoiceId') invoiceId: string, @Request() req: AuthedRequest) {
    return this.expenseService.verifyVatInvoice(invoiceId, buildExpenseScope(req));
  }

  @Get('invoices/:invoiceId/voucher-candidates')
  listVoucherCandidates(@Param('invoiceId') invoiceId: string, @Request() req: AuthedRequest) {
    return this.expenseService.listVoucherCandidates(invoiceId, buildExpenseScope(req));
  }

  @Post('invoices/:invoiceId/voucher-link')
  linkVoucherManually(
    @Param('invoiceId') invoiceId: string,
    @Body() payload: LinkExpenseVoucherDto,
    @Request() req: AuthedRequest,
  ) {
    return this.expenseService.linkVoucherManually(invoiceId, payload.voucher_id, buildExpenseScope(req));
  }

  @Get('reimbursements')
  listReimbursements(@Request() req: AuthedRequest, @Query('department') department?: string) {
    return this.expenseService.listReimbursements(buildExpenseScope(req, department));
  }

  @Post('reimbursements')
  createReimbursement(@Body() payload: CreateExpenseReimbursementDto, @Request() req: AuthedRequest) {
    return this.expenseService.createReimbursement(payload, buildExpenseScope(req));
  }

  @Post('reimbursements/:reimbursementId/submit-wecom')
  submitWeComApproval(@Param('reimbursementId') reimbursementId: string, @Request() req: AuthedRequest) {
    return this.expenseService.submitWeComApproval(reimbursementId, buildExpenseScope(req));
  }

  @Post('reimbursements/:reimbursementId/sync-wecom')
  syncWeComApproval(@Param('reimbursementId') reimbursementId: string, @Request() req: AuthedRequest) {
    return this.expenseService.syncWeComApproval(reimbursementId, buildExpenseScope(req));
  }

  @Get('rules')
  listRules() {
    return this.expenseService.listRules();
  }

  @Get('integrations/requirements')
  getIntegrationRequirements() {
    return this.expenseService.getIntegrationRequirements();
  }

  @Get('integrations/config')
  getMaskedIntegrationConfig() {
    return this.expenseService.getMaskedIntegrationConfig();
  }

  @Post('integrations/config')
  saveIntegrationConfig(@Body() payload: SaveExpenseIntegrationConfigDto) {
    return this.expenseService.saveIntegrationConfig(payload);
  }

  @Get('wecom/callback')
  @Public()
  verifyWeComCallback(@Query() query: Record<string, string | undefined>) {
    return this.expenseService.verifyWeComCallback(query);
  }

  @Post('wecom/callback')
  @Public()
  handleWeComCallback(
    @Query() query: Record<string, string | undefined>,
    @Body() body: unknown,
  ) {
    return this.expenseService.handleWeComCallback(query, body);
  }
}
