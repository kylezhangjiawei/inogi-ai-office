import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
import { ExpenseService } from './expense.service';

@Controller('expenses')
export class ExpenseController {
  constructor(private readonly expenseService: ExpenseService) {}

  @Get('dashboard')
  getDashboard() {
    return this.expenseService.getDashboard();
  }

  @Get('invoices')
  listInvoices(@Query() query: ListExpenseInvoicesQueryDto) {
    return this.expenseService.listInvoices(query);
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
  ) {
    return this.expenseService.uploadInvoices(files ?? [], payload);
  }

  @Post('vouchers/upload')
  @UseInterceptors(FilesInterceptor('files', 30))
  uploadVouchers(
    @UploadedFiles() files: Array<{ originalname: string; buffer: Buffer; mimetype?: string }>,
    @Body() payload: UploadExpenseOcrFilesDto,
  ) {
    return this.expenseService.uploadVouchers(files ?? [], payload);
  }

  @Post('vouchers/auto-match')
  autoMatchVouchers() {
    return this.expenseService.autoMatchVouchers();
  }

  @Patch('invoices/:invoiceId')
  updateInvoice(@Param('invoiceId') invoiceId: string, @Body() payload: UpdateExpenseInvoiceDto) {
    return this.expenseService.updateInvoice(invoiceId, payload);
  }

  @Post('invoices/:invoiceId/vat-verify')
  verifyVatInvoice(@Param('invoiceId') invoiceId: string) {
    return this.expenseService.verifyVatInvoice(invoiceId);
  }

  @Get('invoices/:invoiceId/voucher-candidates')
  listVoucherCandidates(@Param('invoiceId') invoiceId: string) {
    return this.expenseService.listVoucherCandidates(invoiceId);
  }

  @Post('invoices/:invoiceId/voucher-link')
  linkVoucherManually(
    @Param('invoiceId') invoiceId: string,
    @Body() payload: LinkExpenseVoucherDto,
  ) {
    return this.expenseService.linkVoucherManually(invoiceId, payload.voucher_id);
  }

  @Get('reimbursements')
  listReimbursements() {
    return this.expenseService.listReimbursements();
  }

  @Post('reimbursements')
  createReimbursement(@Body() payload: CreateExpenseReimbursementDto) {
    return this.expenseService.createReimbursement(payload);
  }

  @Post('reimbursements/:reimbursementId/submit-wecom')
  submitWeComApproval(@Param('reimbursementId') reimbursementId: string) {
    return this.expenseService.submitWeComApproval(reimbursementId);
  }

  @Post('reimbursements/:reimbursementId/sync-wecom')
  syncWeComApproval(@Param('reimbursementId') reimbursementId: string) {
    return this.expenseService.syncWeComApproval(reimbursementId);
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
