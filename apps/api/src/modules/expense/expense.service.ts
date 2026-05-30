import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';
import { CreateExpenseReimbursementDto } from './dto/create-expense-reimbursement.dto';
import { ListExpenseInvoicesQueryDto } from './dto/list-expense-invoices-query.dto';
import { SaveExpenseIntegrationConfigDto } from './dto/save-expense-integration-config.dto';
import { UpdateExpenseInvoiceDto } from './dto/update-expense-invoice.dto';
import {
  DEFAULT_TENCENT_OCR_CONFIG,
  TENCENT_OCR_SUPPORTED_ACTIONS,
  TencentOcrClient,
  getTencentOcrService,
  getTencentOcrServiceCategories,
} from './tencent-ocr.client';
import { ThirdPartyApiException } from './third-party-api.exception';
import {
  DEFAULT_WECOM_EXPENSE_CONFIG,
  WeComApprovalClient,
} from './wecom-approval.client';
import type {
  ExpenseActivity,
  ExpenseCategory,
  ExpenseIntegrationConfig,
  ExpenseInvoiceValue,
  ExpenseReimbursementValue,
  ExpenseRuleValue,
  ExpenseVoucherValue,
  ReimbursementStatus,
  ThirdPartyOfficialError,
  VoucherCandidateValue,
  WeComExpenseConfig,
  WeComSyncStatus,
} from './expense.types';
import { UploadExpenseOcrFilesDto } from './dto/upload-expense-ocr-files.dto';
import { OssService } from '../oss/oss.service';

type UploadedExpenseFile = {
  originalname: string;
  buffer: Buffer;
  mimetype?: string;
};

type VoucherMatchCandidate = VoucherCandidateValue & {
  voucher: ExpenseVoucherValue;
  score: number;
  prepayment: boolean;
};

type VoucherMatchResult = {
  auto_linked: number;
  manual_review: number;
  blocked: number;
  links: Array<{
    invoice_id: string;
    voucher_id: string;
    voucher_no: string;
    score: number;
    reasons: string[];
  }>;
};

type StoredExpenseConfig = {
  tencent_ocr?: Partial<Omit<ExpenseIntegrationConfig['tencent_ocr'], 'secret_key'>> & {
    encrypted_secret_key?: string;
  };
  wecom?: Partial<Omit<WeComExpenseConfig, 'corp_secret' | 'callback_aes_key'>> & {
    encrypted_corp_secret?: string;
    encrypted_callback_aes_key?: string;
    approval_control_ids?: Partial<ApprovalControlIds>;
  };
};

type ApprovalControlIds = {
  title: string;
  amount: string;
  reason: string;
  invoice_count: string;
  project: string;
};

const RECORD_CATEGORIES = {
  invoice: 'expense_invoice',
  reimbursement: 'expense_reimbursement',
  rule: 'expense_rule',
  event: 'expense_event',
  integration: 'expense_integration',
  voucher: 'expense_voucher',
} as const;

const INTEGRATION_KEY = 'expense:integrations';
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class ExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secureConfigService: SecureConfigService,
    private readonly configService: ConfigService,
    private readonly ossService: OssService,
  ) {}

  async listInvoices(query: ListExpenseInvoicesQueryDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE;
    const keyword = query.keyword?.trim().toLowerCase() ?? '';
    const status = query.status?.trim() ?? '';
    const category = query.category?.trim() ?? '';
    const invoices = await this.ensureInvoices();

    const filtered = invoices.filter((invoice) => {
      const matchesKeyword =
        !keyword ||
        [invoice.invoice_no, invoice.vendor, invoice.project, invoice.uploader]
          .join(' ')
          .toLowerCase()
          .includes(keyword);
      const matchesStatus = !status || status === '全部' || invoice.status === status;
      const matchesCategory = !category || category === '全部' || invoice.category === category;
      return matchesKeyword && matchesStatus && matchesCategory;
    });
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const currentPage = Math.min(page, totalPages);
    const items = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    return {
      items,
      total: filtered.length,
      page: currentPage,
      page_size: pageSize,
      total_pages: totalPages,
    };
  }

  async getDashboard() {
    const [invoices, reimbursements, events] = await Promise.all([
      this.ensureInvoices(),
      this.ensureReimbursements(),
      this.listEvents(8),
    ]);
    const totalAmount = invoices.reduce((sum, invoice) => sum + invoice.amount, 0);
    const pendingInvoices = invoices.filter((invoice) => ['待识别', '待确认', '异常'].includes(invoice.status));
    const abnormalInvoices = invoices.filter((invoice) => invoice.status === '异常');
    const autoHandled = Math.round(
      (invoices.filter((invoice) => invoice.category_confidence >= 0.85).length / Math.max(invoices.length, 1)) * 100,
    );
    const hasBusinessData = invoices.length > 0 || reimbursements.length > 0;

    return {
      kpis: [
        { key: 'monthly_amount', title: '本月报销总额', value: this.formatCurrency(totalAmount), trend: '接口实时汇总', icon: 'TrendingUp' },
        { key: 'pending_invoices', title: '待处理票据数', value: `${pendingInvoices.length} 张`, badge: `${abnormalInvoices.length} 异常`, icon: 'Receipt' },
        { key: 'auto_ratio', title: 'AI 自动处理率', value: `${autoHandled}%`, progress: autoHandled, icon: 'Bot' },
        { key: 'wecom_pending', title: '企微审批中', value: `${reimbursements.filter((item) => item.status === '审批中').length} 单`, trend: '回调自动更新', icon: 'Clock3' },
      ],
      todos: hasBusinessData
        ? [
            {
              id: 'todo-missing-materials',
              title: `${invoices.filter((invoice) => invoice.material_missing.length > 0).length} 张票据缺材料`,
              detail: '差旅、餐饮、采购类票据需要补齐对应材料',
              drawer: 'invoice-detail',
              severity: 'error',
            },
            {
              id: 'todo-low-confidence',
              title: `${invoices.filter((invoice) => invoice.category_confidence < 0.8).length} 张待人工确认分类`,
              detail: '腾讯 OCR 或规则识别置信度偏低，建议财务复核',
              drawer: 'batch-classify',
              severity: 'warning',
            },
            {
              id: 'todo-wecom',
              title: `${reimbursements.filter((item) => item.wecom_sync_status === '同步失败').length} 单企微同步失败`,
              detail: '可打开报销单详情查看企业微信官方 errcode/errmsg',
              drawer: 'reimbursement-detail',
              severity: 'info',
            },
          ]
        : [],
      activities: events,
      monthly_trend: invoices.length ? this.buildMonthlyTrend(invoices) : [],
      category_share: invoices.length ? this.buildCategoryShare(invoices) : [],
      department_bars: invoices.length ? this.buildDepartmentBars(invoices) : [],
      project_top: invoices.length ? this.buildProjectTop(invoices) : [],
    };
  }

  async listReimbursements() {
    return this.ensureReimbursements();
  }

  async listRules() {
    return this.ensureRules();
  }

  async listVoucherCandidates(invoiceId: string): Promise<VoucherCandidateValue[]> {
    const invoice = (await this.ensureInvoices()).find((item) => item.id === invoiceId);
    if (!invoice) {
      throw new NotFoundException('发票不存在');
    }
    const [invoices, vouchers] = await Promise.all([this.ensureInvoices(), this.ensureVouchers()]);
    return this.buildVoucherCandidates(invoice, invoices, vouchers)
      .filter((candidate) => candidate.confidence >= 0.7)
      .slice(0, 10)
      .map(({ voucher: _voucher, score: _score, prepayment: _prepayment, ...candidate }) => candidate);
  }

  getOcrServices() {
    return {
      default_mode: 'auto',
      invoice: getTencentOcrServiceCategories('invoice'),
      voucher: getTencentOcrServiceCategories('voucher'),
    };
  }

  async uploadInvoices(files: UploadedExpenseFile[], payload: UploadExpenseOcrFilesDto = {}) {
    if (files.length === 0) {
      throw new BadRequestException('请至少上传一个票据文件');
    }

    const created = await Promise.all(files.map((file) => this.createInvoiceFromFile(file, payload)));
    await this.recordEvent({
      title: '票据上传完成',
      detail: `已接收 ${created.length} 个文件，默认自动识别；低置信度或失败时可人工选择服务重试`,
      level: 'info',
      provider: 'tencent_ocr',
    });
    const matches = await this.applyAutoVoucherMatches(true);
    return { items: await this.refreshInvoicesByIds(created.map((item) => item.id)), matches };
  }

  async uploadVouchers(files: UploadedExpenseFile[], payload: UploadExpenseOcrFilesDto = {}) {
    if (files.length === 0) {
      throw new BadRequestException('请至少上传一个付款凭证文件');
    }

    const created = await Promise.all(files.map((file) => this.createVoucherFromFile(file, payload)));
    await this.recordEvent({
      title: '付款凭证上传完成',
      detail: `已接收 ${created.length} 个文件，可继续与票据做自动或人工关联`,
      level: 'info',
      provider: 'tencent_ocr',
    });
    const matches = await this.applyAutoVoucherMatches(true);
    return { items: created, matches };
  }

  async autoMatchVouchers() {
    return this.applyAutoVoucherMatches(true);
  }

  async linkVoucherManually(invoiceId: string, voucherId: string) {
    const [invoice, vouchers, invoices] = await Promise.all([
      this.getInvoiceOrThrow(invoiceId),
      this.ensureVouchers(),
      this.ensureInvoices(),
    ]);
    const voucher = vouchers.find((item) => item.id === voucherId);
    if (!voucher) {
      throw new NotFoundException('付款凭证不存在');
    }
    if (invoice.voucher_no || invoice.matched_voucher_id) {
      throw new BadRequestException('该票据已关联付款凭证');
    }
    if (voucher.matched_invoice_id) {
      throw new BadRequestException('该付款凭证已关联其他票据');
    }

    const candidate = this.scoreVoucherMatch(invoice, voucher, invoices);
    const score = candidate?.score ?? 0;
    const reasons = candidate?.match_reasons ?? ['人工指定关联'];
    const matchedAt = this.formatDateTime(new Date());
    const nextInvoice: ExpenseInvoiceValue = {
      ...invoice,
      voucher_no: voucher.voucher_no,
      matched_voucher_id: voucher.id,
      match_confidence: score / 100,
      payment_voucher: voucher.subject || voucher.file_name,
      status: '已关联',
      match_score: score,
      match_reasons: reasons,
      matched_by: 'manual',
      matched_at: matchedAt,
    };
    const nextVoucher: ExpenseVoucherValue = {
      ...voucher,
      matched_invoice_id: invoice.id,
      match_score: score,
      match_reasons: reasons,
      matched_by: 'manual',
      matched_at: matchedAt,
    };

    await Promise.all([
      this.upsertValue(RECORD_CATEGORIES.invoice, nextInvoice.id, nextInvoice, `${nextInvoice.invoice_no} ${nextInvoice.vendor}`),
      this.upsertValue(RECORD_CATEGORIES.voucher, nextVoucher.id, nextVoucher, nextVoucher.voucher_no || nextVoucher.file_name),
    ]);
    await this.recordEvent({
      title: '付款凭证人工关联完成',
      detail: `${nextInvoice.invoice_no} 已关联 ${nextVoucher.voucher_no}，匹配分 ${score}`,
      level: 'info',
    });
    return nextInvoice;
  }

  async updateInvoice(invoiceId: string, payload: UpdateExpenseInvoiceDto) {
    const invoice = await this.getInvoiceOrThrow(invoiceId);
    const next: ExpenseInvoiceValue = {
      ...invoice,
      invoice_no: payload.invoice_no ?? invoice.invoice_no,
      invoice_code: payload.invoice_code ?? invoice.invoice_code,
      issued_date: payload.issued_date ?? invoice.issued_date,
      vendor: payload.vendor ?? invoice.vendor,
      vendor_tax_no: payload.vendor_tax_no ?? invoice.vendor_tax_no,
      amount: payload.amount ?? invoice.amount,
      tax: payload.tax ?? invoice.tax,
      category: (payload.category as ExpenseCategory | undefined) ?? invoice.category,
      project: payload.project ?? invoice.project,
      status: (payload.status as ExpenseInvoiceValue['status'] | undefined) ?? invoice.status,
      material_missing: payload.material_missing ?? invoice.material_missing,
    };
    await this.upsertValue(RECORD_CATEGORIES.invoice, invoice.id, next, `${next.invoice_no} ${next.vendor}`);
    await this.recordEvent({
      title: '票据字段已更新',
      detail: `${next.invoice_no} / ${next.vendor}`,
      level: 'info',
    });
    return next;
  }

  async verifyVatInvoice(invoiceId: string) {
    const invoice = await this.getInvoiceOrThrow(invoiceId);
    const config = await this.getResolvedIntegrationConfig();
    this.assertTencentReady(config, ['secret_id', 'secret_key']);
    const client = new TencentOcrClient(config.tencent_ocr);
    const result = await client.call({
      action: 'VatInvoiceVerifyNew',
      payload: {
        InvoiceNo: invoice.invoice_no,
        InvoiceCode: invoice.invoice_code,
        InvoiceDate: invoice.issued_date,
        Amount: String(invoice.amount),
      },
    });
    await this.recordEvent({
      title: '增值税发票核验完成',
      detail: `${invoice.invoice_no} 已完成腾讯云核验`,
      level: 'info',
      provider: 'tencent_ocr',
    });
    return result.Response;
  }

  async createReimbursement(payload: CreateExpenseReimbursementDto) {
    const invoices = (await this.ensureInvoices()).filter((invoice) => payload.invoice_ids.includes(invoice.id));
    if (invoices.length === 0) {
      throw new BadRequestException('请至少选择一张有效票据');
    }
    const now = new Date();
    const reimbursement: ExpenseReimbursementValue = {
      id: this.newBusinessId('EXP'),
      title: payload.title.trim(),
      applicant: payload.applicant?.trim() || '当前用户',
      applied_date: this.formatDate(now),
      amount: invoices.reduce((sum, invoice) => sum + invoice.amount, 0),
      invoice_count: invoices.length,
      invoice_ids: invoices.map((invoice) => invoice.id),
      status: '草稿',
      node: '待提交企微审批',
      project: payload.project?.trim() || invoices[0]?.project || '',
      reason: payload.reason?.trim() || '',
      wecom_flow_id: '',
      wecom_sync_status: '未提交',
      wecom_approver: '-',
      wecom_updated_at: this.formatDateTime(now),
      wecom_creator_userid: payload.wecom_creator_userid,
    };
    await this.upsertValue(RECORD_CATEGORIES.reimbursement, reimbursement.id, reimbursement, reimbursement.title);
    await this.recordEvent({
      title: '报销单已创建',
      detail: `${reimbursement.title} / ${this.formatCurrency(reimbursement.amount)}`,
      level: 'info',
    });
    return reimbursement;
  }

  async submitWeComApproval(reimbursementId: string) {
    const reimbursement = await this.getReimbursementOrThrow(reimbursementId);
    const config = await this.getResolvedIntegrationConfig();
    this.assertWeComReady(config, ['corp_id', 'corp_secret', 'approval_template_id', 'default_creator_userid']);
    const controlIds = await this.getApprovalControlIds();
    const client = new WeComApprovalClient(config.wecom);
    const accessToken = await client.getAccessToken();
    const response = await client.submitApproval(accessToken, {
      creator_userid: reimbursement.wecom_creator_userid || config.wecom.default_creator_userid,
      template_id: config.wecom.approval_template_id,
      use_template_approver: 1,
      apply_data: {
        contents: [
          this.textControl(controlIds.title, reimbursement.title),
          this.moneyControl(controlIds.amount, reimbursement.amount),
          this.textControl(controlIds.reason, reimbursement.reason || reimbursement.project || reimbursement.title),
          this.textControl(controlIds.invoice_count, `${reimbursement.invoice_count}`),
          this.textControl(controlIds.project, reimbursement.project || '-'),
        ],
      },
      summary_list: [
        {
          summary_info: [
            { text: reimbursement.title, lang: 'zh_CN' },
            { text: this.formatCurrency(reimbursement.amount), lang: 'zh_CN' },
          ],
        },
      ],
    });
    const spNo = String(response.sp_no ?? response.sp_no_list ?? '');
    const next: ExpenseReimbursementValue = {
      ...reimbursement,
      status: '审批中',
      node: '企业微信审批中',
      wecom_flow_id: spNo,
      wecom_sync_status: '审批中',
      wecom_template_id: config.wecom.approval_template_id,
      wecom_updated_at: this.formatDateTime(new Date()),
      wecom_raw_response: response,
      third_party_errors: [],
    };
    await this.upsertValue(RECORD_CATEGORIES.reimbursement, next.id, next, next.title);
    await this.recordEvent({
      title: '已提交企业微信报销审批',
      detail: `${next.title} / 审批编号 ${spNo || '等待企微返回'}`,
      level: 'info',
      provider: 'wecom',
    });
    return next;
  }

  async syncWeComApproval(reimbursementId: string) {
    const reimbursement = await this.getReimbursementOrThrow(reimbursementId);
    if (!reimbursement.wecom_flow_id) {
      throw new BadRequestException('报销单尚未提交企业微信审批');
    }
    const config = await this.getResolvedIntegrationConfig();
    this.assertWeComReady(config, ['corp_id', 'corp_secret']);
    const client = new WeComApprovalClient(config.wecom);
    const accessToken = await client.getAccessToken();
    const response = await client.getApprovalDetail(accessToken, reimbursement.wecom_flow_id);
    const next = await this.applyWeComStatus(reimbursement, response);
    await this.recordEvent({
      title: '企业微信审批状态已同步',
      detail: `${next.title} / ${next.status} / ${next.node}`,
      level: 'info',
      provider: 'wecom',
    });
    return next;
  }

  async verifyWeComCallback(query: Record<string, string | undefined>) {
    const config = await this.getResolvedIntegrationConfig();
    this.assertWeComReady(config, ['corp_id', 'callback_token', 'callback_aes_key']);
    return new WeComApprovalClient(config.wecom).verifyCallbackUrl(query);
  }

  async handleWeComCallback(query: Record<string, string | undefined>, body: unknown) {
    const config = await this.getResolvedIntegrationConfig();
    this.assertWeComReady(config, ['corp_id', 'callback_token', 'callback_aes_key']);
    const client = new WeComApprovalClient(config.wecom);
    const callbackPayload = this.normalizeWeComCallbackBody(client, query, body);
    const spNo = callbackPayload.sp_no || callbackPayload.SpNo || callbackPayload.spNo;
    if (!spNo) {
      throw new BadRequestException('企业微信回调缺少审批编号 sp_no');
    }
    const reimbursement = (await this.ensureReimbursements()).find((item) => item.wecom_flow_id === spNo);
    if (!reimbursement) {
      throw new NotFoundException(`未找到企业微信审批编号 ${spNo} 对应的报销单`);
    }
    const next = await this.applyWeComStatus(reimbursement, callbackPayload);
    await this.recordEvent({
      title: '企业微信审批回调已更新',
      detail: `${next.title} / ${next.status} / ${next.node}`,
      level: 'info',
      provider: 'wecom',
    });
    return { ok: true, reimbursement: next };
  }

  async getIntegrationRequirements() {
    const config = await this.getResolvedIntegrationConfig();
    const controlIds = await this.getApprovalControlIds(false);
    return {
      tencent_ocr: {
        ready: this.hasTencentConfig(config),
        supported_actions: TENCENT_OCR_SUPPORTED_ACTIONS,
        missing: this.missingConfigFields(config.tencent_ocr, ['secret_id', 'secret_key']).map((key) => ({
          key: `tencent_ocr.${key}`,
          label: key === 'secret_id' ? '腾讯云 SecretId' : '腾讯云 SecretKey',
        })),
        optional: [
          { key: 'tencent_ocr.region', label: '腾讯云地域', default: DEFAULT_TENCENT_OCR_CONFIG.region },
          { key: 'tencent_ocr.invoice_action', label: '票据上传默认 Action', default: DEFAULT_TENCENT_OCR_CONFIG.invoice_action },
        ],
      },
      wecom: {
        ready: this.hasWeComConfig(config) && this.hasApprovalControlIds(controlIds),
        missing: [
          ...this.missingConfigFields(config.wecom, [
            'corp_id',
            'agent_id',
            'corp_secret',
            'approval_template_id',
            'default_creator_userid',
            'callback_token',
            'callback_aes_key',
          ]).map((key) => ({ key: `wecom.${key}`, label: this.wecomFieldLabel(key) })),
          ...this.missingApprovalControlIds(controlIds).map((key) => ({
            key: `wecom.approval_control_ids.${key}`,
            label: `企业微信报销模板控件 ID：${this.approvalControlLabel(key)}`,
          })),
        ],
        callback_endpoint: '/api/expenses/wecom/callback',
      },
    };
  }

  async getMaskedIntegrationConfig() {
    const config = await this.getResolvedIntegrationConfig();
    const controlIds = await this.getApprovalControlIds(false);
    return {
      tencent_ocr: {
        enabled: config.tencent_ocr.enabled,
        secret_id: this.mask(config.tencent_ocr.secret_id),
        has_secret_key: Boolean(config.tencent_ocr.secret_key),
        region: config.tencent_ocr.region,
        endpoint: config.tencent_ocr.endpoint,
        invoice_action: config.tencent_ocr.invoice_action,
      },
      wecom: {
        enabled: config.wecom.enabled,
        corp_id: this.mask(config.wecom.corp_id),
        agent_id: config.wecom.agent_id,
        has_corp_secret: Boolean(config.wecom.corp_secret),
        approval_template_id: config.wecom.approval_template_id,
        default_creator_userid: config.wecom.default_creator_userid,
        has_callback_token: Boolean(config.wecom.callback_token),
        has_callback_aes_key: Boolean(config.wecom.callback_aes_key),
        approval_control_ids: controlIds,
      },
    };
  }

  async saveIntegrationConfig(payload: SaveExpenseIntegrationConfigDto) {
    const existing = await this.getStoredIntegrationConfig();
    const next: StoredExpenseConfig = {
      tencent_ocr: {
        ...(existing.tencent_ocr ?? {}),
        ...(payload.tencent_ocr
          ? {
              enabled: payload.tencent_ocr.enabled ?? existing.tencent_ocr?.enabled,
              secret_id: payload.tencent_ocr.secret_id ?? existing.tencent_ocr?.secret_id,
              region: payload.tencent_ocr.region ?? existing.tencent_ocr?.region,
              endpoint: payload.tencent_ocr.endpoint ?? existing.tencent_ocr?.endpoint,
              invoice_action: payload.tencent_ocr.invoice_action ?? existing.tencent_ocr?.invoice_action,
              encrypted_secret_key: payload.tencent_ocr.secret_key
                ? this.secureConfigService.encryptForStorage(payload.tencent_ocr.secret_key)
                : existing.tencent_ocr?.encrypted_secret_key,
            }
          : {}),
      },
      wecom: {
        ...(existing.wecom ?? {}),
        ...(payload.wecom
          ? {
              enabled: payload.wecom.enabled ?? existing.wecom?.enabled,
              corp_id: payload.wecom.corp_id ?? existing.wecom?.corp_id,
              agent_id: payload.wecom.agent_id ?? existing.wecom?.agent_id,
              approval_template_id: payload.wecom.approval_template_id ?? existing.wecom?.approval_template_id,
              default_creator_userid: payload.wecom.default_creator_userid ?? existing.wecom?.default_creator_userid,
              callback_token: payload.wecom.callback_token ?? existing.wecom?.callback_token,
              encrypted_corp_secret: payload.wecom.corp_secret
                ? this.secureConfigService.encryptForStorage(payload.wecom.corp_secret)
                : existing.wecom?.encrypted_corp_secret,
              encrypted_callback_aes_key: payload.wecom.callback_aes_key
                ? this.secureConfigService.encryptForStorage(payload.wecom.callback_aes_key)
                : existing.wecom?.encrypted_callback_aes_key,
              approval_control_ids: existing.wecom?.approval_control_ids,
            }
          : {}),
      },
    };

    const sanitizedConfig = JSON.parse(JSON.stringify(next)) as Prisma.InputJsonValue;
    await this.prisma.systemSetting.upsert({
      where: { key: INTEGRATION_KEY },
      create: {
        category: RECORD_CATEGORIES.integration,
        key: INTEGRATION_KEY,
        description: '费用报销第三方集成配置',
        value: sanitizedConfig,
      },
      update: {
        value: sanitizedConfig,
      },
    });
    return this.getMaskedIntegrationConfig();
  }

  private async createInvoiceFromFile(file: UploadedExpenseFile, payload: UploadExpenseOcrFilesDto) {
    const now = new Date();
    const baseInvoice = this.invoiceFromUpload(file, now);
    const ocrMode = payload.ocr_mode === 'manual' ? 'manual' : 'auto';
    const service = getTencentOcrService(
      ocrMode === 'manual' ? payload.ocr_service_key : undefined,
      'invoice',
    );

    // 上传原始文件到 OSS（非阻塞，失败不影响主流程）
    const invoiceObjectKey = await this.ossService.uploadBuffer(
      file.buffer,
      'expense/invoices',
      file.originalname,
      file.mimetype,
    );
    const fileUrl = invoiceObjectKey ? this.ossService.getSignedUrl(invoiceObjectKey, 30 * 24 * 3600) : null;
    if (fileUrl) baseInvoice.file_url = fileUrl;

    const config = await this.getResolvedIntegrationConfig();
    if (!this.hasTencentConfig(config)) {
      const next: ExpenseInvoiceValue = {
        ...baseInvoice,
        status: '待识别',
        ocr_mode: ocrMode,
        ocr_service_key: service?.key,
        ocr_service_label: service?.label,
        ocr_action: service?.action,
        manual_review_required: true,
        ai_insight: '腾讯 OCR 配置尚未完整，票据已暂存，录入 SecretId/SecretKey 后可重新识别。',
      };
      await this.upsertValue(RECORD_CATEGORIES.invoice, next.id, next, `${next.invoice_no} ${next.vendor}`);
      return next;
    }

    try {
      const client = new TencentOcrClient(config.tencent_ocr);
      const result = await client.call({
        action: service?.action || config.tencent_ocr.invoice_action || DEFAULT_TENCENT_OCR_CONFIG.invoice_action,
        payload: this.buildTencentOcrPayload(file, service),
      });
      const extracted = this.extractInvoiceFields(result.Response ?? {});
      const detected = this.detectInvoiceType(result.Response ?? {}, extracted, service?.label);
      const needsManualReview = ocrMode === 'auto' && detected.confidence < 0.75;
      const next: ExpenseInvoiceValue = {
        ...baseInvoice,
        ...extracted,
        status: needsManualReview ? '待确认' : '已识别',
        ocr_provider: 'tencent_ocr',
        ocr_mode: ocrMode,
        ocr_service_key: service?.key,
        ocr_service_label: service?.label,
        ocr_action: service?.action || config.tencent_ocr.invoice_action,
        ocr_request_id: result.Response?.RequestId,
        detected_type: detected.type,
        detected_type_confidence: detected.confidence,
        manual_review_required: needsManualReview,
        ocr_raw_response: result.Response,
        ai_insight: needsManualReview
          ? '系统已自动识别，但票据类型置信度偏低，请人工选择类型后重试或确认字段。'
          : `系统自动判断为${detected.type}，腾讯 OCR 已完成字段抽取。`,
      };
      await this.upsertValue(RECORD_CATEGORIES.invoice, next.id, next, `${next.invoice_no} ${next.vendor}`);
      return next;
    } catch (error) {
      if (error instanceof ThirdPartyApiException) {
        const next: ExpenseInvoiceValue = {
          ...baseInvoice,
          status: '异常',
          ocr_mode: ocrMode,
          ocr_service_key: service?.key,
          ocr_service_label: service?.label,
          ocr_action: service?.action,
          manual_review_required: true,
          ai_insight: '腾讯 OCR 返回官方错误，已保留 errcode/code/message 供排查。',
          third_party_errors: [error.officialError],
        };
        await this.upsertValue(RECORD_CATEGORIES.invoice, next.id, next, `${next.invoice_no} ${next.vendor}`);
        await this.recordThirdPartyError('腾讯 OCR 识别失败', error.officialError);
        return next;
      }
      throw error;
    }
  }

  private async createVoucherFromFile(file: UploadedExpenseFile, payload: UploadExpenseOcrFilesDto) {
    const now = new Date();
    const ocrMode = payload.ocr_mode === 'manual' ? 'manual' : 'auto';
    const service = getTencentOcrService(
      ocrMode === 'manual' ? payload.ocr_service_key : undefined,
      'voucher',
    );

    // 上传原始文件到 OSS（非阻塞，失败不影响主流程）
    const voucherObjectKey = await this.ossService.uploadBuffer(
      file.buffer,
      'expense/vouchers',
      file.originalname,
      file.mimetype,
    );
    const fileUrl = voucherObjectKey ? this.ossService.getSignedUrl(voucherObjectKey, 30 * 24 * 3600) : null;

    const baseVoucher: ExpenseVoucherValue = {
      id: this.newBusinessId('VOU'),
      voucher_no: `待识别-${now.getTime()}`,
      amount: 0,
      date: this.formatDate(now),
      project: '',
      subject: '付款凭证',
      confidence: 0,
      reason: '等待腾讯 OCR 识别。',
      file_name: file.originalname,
      uploaded_at: this.formatDateTime(now),
      status: '待识别',
      ocr_mode: ocrMode,
      ocr_service_key: service?.key,
      ocr_service_label: service?.label,
      ocr_action: service?.action,
      manual_review_required: true,
      ...(fileUrl ? { file_url: fileUrl } : {}),
    };
    const config = await this.getResolvedIntegrationConfig();
    if (!this.hasTencentConfig(config)) {
      await this.upsertValue(RECORD_CATEGORIES.voucher, baseVoucher.id, baseVoucher, file.originalname);
      return baseVoucher;
    }

    try {
      const client = new TencentOcrClient(config.tencent_ocr);
      const result = await client.call({
        action: service?.action || DEFAULT_TENCENT_OCR_CONFIG.invoice_action,
        payload: this.buildTencentOcrPayload(file, service),
      });
      const extracted = this.extractVoucherFields(result.Response ?? {}, file.originalname);
      const confidence = extracted.confidence ?? 0;
      const next: ExpenseVoucherValue = {
        ...baseVoucher,
        ...extracted,
        status: confidence < 0.75 ? '待确认' : '已识别',
        ocr_request_id: result.Response?.RequestId,
        detected_type: extracted.subject,
        manual_review_required: confidence < 0.75,
        ocr_raw_response: result.Response,
      };
      await this.upsertValue(RECORD_CATEGORIES.voucher, next.id, next, next.voucher_no || file.originalname);
      return next;
    } catch (error) {
      if (error instanceof ThirdPartyApiException) {
        const next: ExpenseVoucherValue = {
          ...baseVoucher,
          status: '异常',
          reason: '腾讯 OCR 返回官方错误，需人工选择服务或重新上传。',
          third_party_errors: [error.officialError],
        };
        await this.upsertValue(RECORD_CATEGORIES.voucher, next.id, next, file.originalname);
        await this.recordThirdPartyError('腾讯 OCR 付款凭证识别失败', error.officialError);
        return next;
      }
      throw error;
    }
  }

  private async applyAutoVoucherMatches(recordSummaryEvent: boolean): Promise<VoucherMatchResult> {
    const [invoices, vouchers] = await Promise.all([this.ensureInvoices(), this.ensureVouchers()]);
    const candidates = invoices.flatMap((invoice) => this.buildVoucherCandidates(invoice, invoices, vouchers));
    const strongByVoucher = new Map<string, VoucherMatchCandidate[]>();
    candidates
      .filter((candidate) => candidate.score >= 85)
      .forEach((candidate) => {
        const group = strongByVoucher.get(candidate.voucher.id) ?? [];
        group.push(candidate);
        strongByVoucher.set(candidate.voucher.id, group);
      });

    const usedInvoiceIds = new Set(invoices.filter((invoice) => invoice.voucher_no || invoice.matched_voucher_id).map((invoice) => invoice.id));
    const usedVoucherIds = new Set(vouchers.filter((voucher) => voucher.matched_invoice_id).map((voucher) => voucher.id));
    const links: VoucherMatchResult['links'] = [];

    for (const candidate of candidates
      .filter((item) => item.score >= 85)
      .sort((left, right) => right.score - left.score)) {
      if (usedInvoiceIds.has(candidate.id) || usedVoucherIds.has(candidate.voucher.id)) continue;
      if (candidate.prepayment) continue;
      if ((strongByVoucher.get(candidate.voucher.id)?.length ?? 0) > 1) continue;

      const invoice = invoices.find((item) => item.id === candidate.id);
      if (!invoice) continue;
      const matchedAt = this.formatDateTime(new Date());
      const nextInvoice: ExpenseInvoiceValue = {
        ...invoice,
        voucher_no: candidate.voucher.voucher_no,
        matched_voucher_id: candidate.voucher.id,
        match_confidence: candidate.confidence,
        payment_voucher: candidate.voucher.subject || candidate.voucher.file_name,
        status: '已关联',
        match_score: candidate.score,
        match_reasons: candidate.match_reasons,
        matched_by: 'system',
        matched_at: matchedAt,
      };
      const nextVoucher: ExpenseVoucherValue = {
        ...candidate.voucher,
        matched_invoice_id: invoice.id,
        match_score: candidate.score,
        match_reasons: candidate.match_reasons,
        matched_by: 'system',
        matched_at: matchedAt,
      };

      await Promise.all([
        this.upsertValue(RECORD_CATEGORIES.invoice, nextInvoice.id, nextInvoice, `${nextInvoice.invoice_no} ${nextInvoice.vendor}`),
        this.upsertValue(RECORD_CATEGORIES.voucher, nextVoucher.id, nextVoucher, nextVoucher.voucher_no || nextVoucher.file_name),
      ]);
      usedInvoiceIds.add(nextInvoice.id);
      usedVoucherIds.add(nextVoucher.id);
      links.push({
        invoice_id: nextInvoice.id,
        voucher_id: nextVoucher.id,
        voucher_no: nextVoucher.voucher_no,
        score: candidate.score,
        reasons: candidate.match_reasons ?? [],
      });
    }

    if (recordSummaryEvent && links.length > 0) {
      await this.recordEvent({
        title: '付款凭证自动关联完成',
        detail: `已按金额、日期、项目、供应商和唯一性规则自动关联 ${links.length} 张票据`,
        level: 'info',
      });
    }

    return {
      auto_linked: links.length,
      manual_review: candidates.filter((candidate) => candidate.score >= 70 && (candidate.score < 85 || candidate.prepayment || (strongByVoucher.get(candidate.voucher.id)?.length ?? 0) > 1)).length,
      blocked: candidates.filter((candidate) => candidate.score < 70).length,
      links,
    };
  }

  private buildVoucherCandidates(
    invoice: ExpenseInvoiceValue,
    invoices: ExpenseInvoiceValue[],
    vouchers: ExpenseVoucherValue[],
  ): VoucherMatchCandidate[] {
    if (!this.isMatchableInvoice(invoice)) return [];
    return vouchers
      .map((voucher) => this.scoreVoucherMatch(invoice, voucher, invoices))
      .filter((candidate): candidate is VoucherMatchCandidate => Boolean(candidate))
      .sort((left, right) => right.score - left.score);
  }

  private scoreVoucherMatch(
    invoice: ExpenseInvoiceValue,
    voucher: ExpenseVoucherValue,
    invoices: ExpenseInvoiceValue[],
  ): VoucherMatchCandidate | null {
    const base = this.scoreVoucherMatchBase(invoice, voucher);
    if (!base) return null;
    const uniqueScore = this.scoreVoucherUniqueness(invoice, voucher, invoices, base.score);
    const score = Math.min(100, base.score + uniqueScore.score);
    const reasons = [...base.reasons, ...uniqueScore.reasons];
    return {
      id: voucher.id,
      voucher_no: voucher.voucher_no,
      amount: voucher.amount,
      date: voucher.date,
      project: voucher.project,
      subject: voucher.subject,
      confidence: score / 100,
      reason: reasons.join('；'),
      match_reasons: reasons,
      match_status: score >= 85 && base.dateReliable && !base.prepayment ? 'auto' : score >= 70 ? 'manual_review' : 'blocked',
      voucher,
      score,
      prepayment: base.prepayment || !base.dateReliable,
    };
  }

  private scoreVoucherMatchBase(invoice: ExpenseInvoiceValue, voucher: ExpenseVoucherValue) {
    if (!this.isMatchableInvoice(invoice) || !this.isMatchableVoucher(voucher)) return null;
    if (invoice.voucher_no || invoice.matched_voucher_id || voucher.matched_invoice_id) return null;
    if (invoice.amount <= 0 || voucher.amount <= 0) return null;

    const amountDiff = Math.abs(invoice.amount - voucher.amount);
    const amountLimit = Math.max(1, invoice.amount * 0.01);
    if (amountDiff > amountLimit) return null;

    const invoiceDate = this.parseExpenseDate(invoice.issued_date);
    const voucherDate = this.parseExpenseDate(voucher.date);
    const dateReliable = Boolean(invoiceDate && voucherDate);
    const dateOffset = dateReliable ? this.diffDays(voucherDate as Date, invoiceDate as Date) : 0;
    if (dateReliable && (dateOffset < -30 || dateOffset > 90)) return null;

    const amountScore = this.scoreAmountMatch(amountDiff, invoice.amount);
    const dateScore = this.scoreDateMatch(Math.abs(dateOffset), dateReliable);
    const projectScore = this.scoreProjectMatch(invoice, voucher);
    const counterpartyScore = this.scoreCounterpartyMatch(invoice, voucher);
    const categoryScore = this.scoreCategoryMatch(invoice, voucher);
    const ocrScore = this.scoreOcrConfidence(invoice, voucher);
    const score = amountScore.score + dateScore.score + projectScore.score + counterpartyScore.score + categoryScore.score + ocrScore.score;
    const reasons = [
      amountScore.reason,
      dateScore.reason,
      projectScore.reason,
      counterpartyScore.reason,
      categoryScore.reason,
      ocrScore.reason,
    ].filter(Boolean);

    return {
      score,
      reasons,
      prepayment: dateReliable && dateOffset < 0,
      dateReliable,
    };
  }

  private isMatchableInvoice(invoice: ExpenseInvoiceValue) {
    return ['已识别', '待确认'].includes(invoice.status);
  }

  private isMatchableVoucher(voucher: ExpenseVoucherValue) {
    return ['已识别', '待确认'].includes(voucher.status);
  }

  private scoreAmountMatch(diff: number, amount: number) {
    if (diff <= 0.005) return { score: 40, reason: '金额完全一致' };
    if (diff <= 0.01) return { score: 38, reason: '金额误差不超过 0.01 元' };
    if (diff <= 1) return { score: 32, reason: '金额误差不超过 1 元' };
    if (diff <= amount * 0.01) return { score: 25, reason: '金额误差不超过 1%' };
    return { score: 0, reason: '' };
  }

  private scoreDateMatch(absDays: number, reliable: boolean) {
    if (!reliable) return { score: 0, reason: '日期缺失，需人工确认' };
    if (absDays <= 3) return { score: 15, reason: '付款日期与发票日期相差 0-3 天' };
    if (absDays <= 7) return { score: 10, reason: '付款日期与发票日期相差 4-7 天' };
    if (absDays <= 30) return { score: 6, reason: '付款日期与发票日期相差 8-30 天' };
    return { score: 0, reason: '日期间隔较远' };
  }

  private scoreProjectMatch(invoice: ExpenseInvoiceValue, voucher: ExpenseVoucherValue) {
    const invoiceProject = this.normalizeMatchText(invoice.project);
    const voucherProject = this.normalizeMatchText(voucher.project);
    const voucherText = this.normalizeMatchText(`${voucher.subject} ${voucher.reason} ${voucher.file_name}`);
    if (invoiceProject && voucherProject && invoiceProject === voucherProject) return { score: 15, reason: '项目完全一致' };
    if (invoiceProject && (voucherProject.includes(invoiceProject) || voucherText.includes(invoiceProject))) return { score: 10, reason: '凭证文本命中发票项目' };
    if (invoiceProject && voucherProject && this.textSimilarity(invoiceProject, voucherProject) >= 0.45) return { score: 6, reason: '项目名称相近' };
    return { score: 0, reason: '' };
  }

  private scoreCounterpartyMatch(invoice: ExpenseInvoiceValue, voucher: ExpenseVoucherValue) {
    const vendor = this.normalizeMatchText(invoice.vendor);
    const counterparty = this.normalizeMatchText(voucher.counterparty ?? '');
    const voucherText = this.normalizeMatchText(`${voucher.counterparty ?? ''} ${voucher.subject} ${voucher.reason} ${voucher.file_name} ${JSON.stringify(voucher.ocr_raw_response ?? {})}`);
    if (!vendor) return { score: 0, reason: '' };
    if (counterparty && (counterparty.includes(vendor) || vendor.includes(counterparty))) return { score: 15, reason: '收款方与发票销售方一致' };
    if (voucherText.includes(vendor)) return { score: 15, reason: '凭证文本命中发票销售方' };
    if (counterparty && this.textSimilarity(vendor, counterparty) >= 0.45) return { score: 8, reason: '收款方与销售方文本相近' };
    return { score: 0, reason: '' };
  }

  private scoreCategoryMatch(invoice: ExpenseInvoiceValue, voucher: ExpenseVoucherValue) {
    const text = this.normalizeMatchText(`${voucher.subject} ${voucher.reason} ${voucher.file_name}`);
    const category = this.normalizeMatchText(invoice.category);
    if (category && text.includes(category)) return { score: 5, reason: '票据分类与凭证摘要一致' };
    if (invoice.category === '差旅' && /差旅|机票|火车|高铁|酒店|住宿/.test(text)) return { score: 5, reason: '差旅类关键词一致' };
    if (invoice.category === '采购' && /采购|材料|配件|供应|货款/.test(text)) return { score: 5, reason: '采购类关键词一致' };
    if (invoice.category === '餐饮' && /餐饮|餐厅|招待|食品/.test(text)) return { score: 5, reason: '餐饮类关键词一致' };
    if (invoice.category === '办公' && /办公|文具|用品|行政/.test(text)) return { score: 5, reason: '办公类关键词一致' };
    return { score: 0, reason: '' };
  }

  private scoreOcrConfidence(invoice: ExpenseInvoiceValue, voucher: ExpenseVoucherValue) {
    const invoiceConfidence = invoice.detected_type_confidence ?? invoice.category_confidence ?? 0;
    const voucherConfidence = voucher.confidence ?? 0;
    if (invoiceConfidence >= 0.85 && voucherConfidence >= 0.85) return { score: 5, reason: '双方 OCR 置信度较高' };
    if (invoiceConfidence < 0.75 || voucherConfidence < 0.75) return { score: 0, reason: '存在低置信度 OCR 字段' };
    return { score: 3, reason: 'OCR 置信度可接受' };
  }

  private scoreVoucherUniqueness(
    invoice: ExpenseInvoiceValue,
    voucher: ExpenseVoucherValue,
    invoices: ExpenseInvoiceValue[],
    currentBaseScore: number,
  ) {
    const alternatives = invoices
      .filter((item) => item.id !== invoice.id)
      .map((item) => this.scoreVoucherMatchBase(item, voucher)?.score ?? 0)
      .filter((score) => score >= 70);
    if (alternatives.length === 0) return { score: 5, reasons: ['该凭证没有其他接近候选'] };
    if (Math.max(...alternatives) <= currentBaseScore - 10) return { score: 5, reasons: ['当前票据显著优于其他候选'] };
    return { score: 0, reasons: ['存在多个接近候选，需人工确认'] };
  }

  private parseExpenseDate(value: string | undefined) {
    if (!value) return null;
    const normalized = value.replace(/[年月/.]/g, '-').replace(/日/g, '').trim();
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private diffDays(left: Date, right: Date) {
    const dayMs = 24 * 60 * 60 * 1000;
    return Math.round((left.getTime() - right.getTime()) / dayMs);
  }

  private normalizeMatchText(value: string) {
    return value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .replace(/有限公司|有限责任公司|股份有限公司|公司/g, '');
  }

  private textSimilarity(left: string, right: string) {
    if (!left || !right) return 0;
    const leftChars = new Set(Array.from(left));
    const rightChars = new Set(Array.from(right));
    const overlap = Array.from(leftChars).filter((char) => rightChars.has(char)).length;
    return overlap / Math.max(leftChars.size, rightChars.size, 1);
  }

  private async refreshInvoicesByIds(ids: string[]) {
    const idSet = new Set(ids);
    return (await this.ensureInvoices()).filter((invoice) => idSet.has(invoice.id));
  }

  private async applyWeComStatus(reimbursement: ExpenseReimbursementValue, payload: Record<string, unknown>) {
    const statusValue = String(
      payload.sp_status ??
        payload.SpStatus ??
        payload.status ??
        payload.Status ??
        payload.apply_status ??
        '',
    );
    const status = this.mapWeComStatus(statusValue);
    const next: ExpenseReimbursementValue = {
      ...reimbursement,
      status: status.reimbursement_status,
      node: status.node,
      wecom_sync_status: status.sync_status,
      wecom_approver: String(payload.approver_userid ?? payload.ApproverUserId ?? payload.applyer ?? '-'),
      wecom_updated_at: this.formatDateTime(new Date()),
      wecom_raw_response: payload,
    };
    await this.upsertValue(RECORD_CATEGORIES.reimbursement, next.id, next, next.title);
    return next;
  }

  private normalizeWeComCallbackBody(
    client: WeComApprovalClient,
    query: Record<string, string | undefined>,
    body: unknown,
  ): Record<string, unknown> {
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
      const direct = body as Record<string, unknown>;
      if (direct.sp_no || direct.SpNo || direct.spNo) return direct;
      const encrypted = this.getEncryptedXmlValue(String(direct.xml ?? direct.Encrypt ?? ''));
      if (encrypted) {
        if (!client.verifySignature(query, encrypted)) {
          throw new BadRequestException('企业微信回调签名校验失败');
        }
        return this.parseWeComCallbackXml(client.decryptCallbackPayload(encrypted));
      }
    }

    const raw = Buffer.isBuffer(body) ? body.toString('utf8') : String(body ?? '');
    const encrypted = this.getEncryptedXmlValue(raw);
    if (encrypted) {
      if (!client.verifySignature(query, encrypted)) {
        throw new BadRequestException('企业微信回调签名校验失败');
      }
      return this.parseWeComCallbackXml(client.decryptCallbackPayload(encrypted));
    }
    return this.parseWeComCallbackXml(raw);
  }

  private parseWeComCallbackXml(xml: string): Record<string, unknown> {
    return {
      event: this.readXmlValue(xml, 'Event'),
      sp_no: this.readXmlValue(xml, 'SpNo') || this.readXmlValue(xml, 'sp_no'),
      sp_status: this.readXmlValue(xml, 'SpStatus') || this.readXmlValue(xml, 'sp_status'),
      approver_userid: this.readXmlValue(xml, 'UserId') || this.readXmlValue(xml, 'ApproverUserId'),
      raw_xml: xml,
    };
  }

  private async ensureInvoices() {
    return this.listValues<ExpenseInvoiceValue>(RECORD_CATEGORIES.invoice);
  }

  private async ensureVouchers() {
    return this.listValues<ExpenseVoucherValue>(RECORD_CATEGORIES.voucher);
  }

  private async ensureReimbursements() {
    return this.listValues<ExpenseReimbursementValue>(RECORD_CATEGORIES.reimbursement);
  }

  private async ensureRules() {
    return this.listValues<ExpenseRuleValue>(RECORD_CATEGORIES.rule);
  }

  private async listEvents(take: number) {
    const records = await this.prisma.systemSetting.findMany({
      where: { category: RECORD_CATEGORIES.event },
      orderBy: { updatedAt: 'desc' },
      take,
    });
    const events = records.map((record) => record.value as ExpenseActivity);
    return events;
  }

  private async listValues<T>(category: string): Promise<T[]> {
    const records = await this.prisma.systemSetting.findMany({
      where: { category },
      orderBy: { updatedAt: 'desc' },
    });
    return records
      .map((record) => record.value as T)
      .filter((value) => !this.isLegacyDemoExpenseValue(category, value));
  }

  private isLegacyDemoExpenseValue(category: string, value: unknown) {
    if (!value || typeof value !== 'object') return false;
    const id = String((value as { id?: unknown }).id ?? '');
    const legacyIdsByCategory: Record<string, Set<string>> = {
      [RECORD_CATEGORIES.invoice]: new Set(['INV-0001', 'INV-0002', 'INV-0003']),
      [RECORD_CATEGORIES.reimbursement]: new Set(['EXP-642']),
      [RECORD_CATEGORIES.rule]: new Set(['RULE-001', 'RULE-002', 'RULE-003']),
      [RECORD_CATEGORIES.event]: new Set(['act-1', 'act-2', 'act-3']),
    };
    return legacyIdsByCategory[category]?.has(id) ?? false;
  }

  private async getInvoiceOrThrow(invoiceId: string) {
    const invoice = (await this.ensureInvoices()).find((item) => item.id === invoiceId);
    if (!invoice) {
      throw new NotFoundException('发票不存在');
    }
    return invoice;
  }

  private async getReimbursementOrThrow(reimbursementId: string) {
    const reimbursement = (await this.ensureReimbursements()).find((item) => item.id === reimbursementId);
    if (!reimbursement) {
      throw new NotFoundException('报销单不存在');
    }
    return reimbursement;
  }

  private async upsertValue(category: string, id: string, value: unknown, description: string) {
    const jsonValue = JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    await this.prisma.systemSetting.upsert({
      where: { key: `${category}:${id}` },
      create: {
        category,
        key: `${category}:${id}`,
        description,
        value: jsonValue,
      },
      update: {
        description,
        value: jsonValue,
      },
    });
  }

  private async recordEvent(input: Omit<ExpenseActivity, 'id' | 'time'>) {
    const event: ExpenseActivity = {
      id: randomUUID(),
      time: this.formatDateTime(new Date()),
      ...input,
    };
    await this.upsertValue(RECORD_CATEGORIES.event, event.id, event, event.title);
    return event;
  }

  private async recordThirdPartyError(title: string, officialError: ThirdPartyOfficialError) {
    return this.recordEvent({
      title,
      detail: `${officialError.code}: ${officialError.message}`,
      level: 'error',
      provider: officialError.provider,
      official_error: officialError,
    });
  }

  private async getStoredIntegrationConfig(): Promise<StoredExpenseConfig> {
    const record = await this.prisma.systemSetting.findUnique({ where: { key: INTEGRATION_KEY } });
    return (record?.value as StoredExpenseConfig | null) ?? {};
  }

  private async getResolvedIntegrationConfig(): Promise<ExpenseIntegrationConfig> {
    const stored = await this.getStoredIntegrationConfig();
    return {
      tencent_ocr: {
        ...DEFAULT_TENCENT_OCR_CONFIG,
        enabled: stored.tencent_ocr?.enabled ?? this.envBool('TENCENTCLOUD_OCR_ENABLED'),
        secret_id:
          stored.tencent_ocr?.secret_id ??
          this.configService.get<string>('TENCENTCLOUD_SECRET_ID') ??
          '',
        secret_key:
          this.decryptStored(stored.tencent_ocr?.encrypted_secret_key) ??
          this.configService.get<string>('TENCENTCLOUD_SECRET_KEY') ??
          '',
        region:
          stored.tencent_ocr?.region ??
          this.configService.get<string>('TENCENTCLOUD_OCR_REGION') ??
          DEFAULT_TENCENT_OCR_CONFIG.region,
        endpoint:
          stored.tencent_ocr?.endpoint ??
          this.configService.get<string>('TENCENTCLOUD_OCR_ENDPOINT') ??
          DEFAULT_TENCENT_OCR_CONFIG.endpoint,
        invoice_action:
          stored.tencent_ocr?.invoice_action ??
          this.configService.get<string>('TENCENTCLOUD_OCR_INVOICE_ACTION') ??
          DEFAULT_TENCENT_OCR_CONFIG.invoice_action,
      },
      wecom: {
        ...DEFAULT_WECOM_EXPENSE_CONFIG,
        enabled: stored.wecom?.enabled ?? this.envBool('WECOM_EXPENSE_ENABLED'),
        corp_id:
          stored.wecom?.corp_id ??
          this.configService.get<string>('WECOM_CORP_ID') ??
          '',
        agent_id:
          stored.wecom?.agent_id ??
          this.configService.get<string>('WECOM_EXPENSE_AGENT_ID') ??
          '',
        corp_secret:
          this.decryptStored(stored.wecom?.encrypted_corp_secret) ??
          this.configService.get<string>('WECOM_EXPENSE_SECRET') ??
          '',
        approval_template_id:
          stored.wecom?.approval_template_id ??
          this.configService.get<string>('WECOM_EXPENSE_APPROVAL_TEMPLATE_ID') ??
          '',
        default_creator_userid:
          stored.wecom?.default_creator_userid ??
          this.configService.get<string>('WECOM_EXPENSE_CREATOR_USERID') ??
          '',
        callback_token:
          stored.wecom?.callback_token ??
          this.configService.get<string>('WECOM_EXPENSE_CALLBACK_TOKEN') ??
          '',
        callback_aes_key:
          this.decryptStored(stored.wecom?.encrypted_callback_aes_key) ??
          this.configService.get<string>('WECOM_EXPENSE_CALLBACK_AES_KEY') ??
          '',
      },
    };
  }

  private async getApprovalControlIds(throwWhenMissing = true): Promise<Partial<ApprovalControlIds>> {
    const stored = await this.getStoredIntegrationConfig();
    const fromConfig = stored.wecom?.approval_control_ids ?? {};
    const controlIds: Partial<ApprovalControlIds> = {
      title: fromConfig.title ?? this.configService.get<string>('WECOM_EXPENSE_CONTROL_TITLE'),
      amount: fromConfig.amount ?? this.configService.get<string>('WECOM_EXPENSE_CONTROL_AMOUNT'),
      reason: fromConfig.reason ?? this.configService.get<string>('WECOM_EXPENSE_CONTROL_REASON'),
      invoice_count: fromConfig.invoice_count ?? this.configService.get<string>('WECOM_EXPENSE_CONTROL_INVOICE_COUNT'),
      project: fromConfig.project ?? this.configService.get<string>('WECOM_EXPENSE_CONTROL_PROJECT'),
    };
    if (throwWhenMissing && !this.hasApprovalControlIds(controlIds)) {
      throw new BadRequestException({
        message: '企业微信报销审批模板控件 ID 未配置',
        missing: this.missingApprovalControlIds(controlIds).map((key) => `wecom.approval_control_ids.${key}`),
      });
    }
    return controlIds;
  }

  private decryptStored(value?: string) {
    if (!value) return undefined;
    try {
      return this.secureConfigService.decryptFromStorage(value);
    } catch {
      return undefined;
    }
  }

  private envBool(key: string) {
    return this.configService.get<string>(key) === 'true';
  }

  private hasTencentConfig(config: ExpenseIntegrationConfig) {
    return Boolean(config.tencent_ocr.secret_id && config.tencent_ocr.secret_key);
  }

  private hasWeComConfig(config: ExpenseIntegrationConfig) {
    return Boolean(
      config.wecom.corp_id &&
        config.wecom.corp_secret &&
        config.wecom.approval_template_id &&
        config.wecom.default_creator_userid,
    );
  }

  private assertTencentReady(config: ExpenseIntegrationConfig, fields: Array<keyof ExpenseIntegrationConfig['tencent_ocr']>) {
    const missing = this.missingConfigFields(config.tencent_ocr, fields);
    if (missing.length > 0) {
      throw new BadRequestException({
        message: '腾讯 OCR 配置不完整',
        missing: missing.map((key) => `tencent_ocr.${key}`),
      });
    }
  }

  private assertWeComReady(config: ExpenseIntegrationConfig, fields: Array<keyof WeComExpenseConfig>) {
    const missing = this.missingConfigFields(config.wecom, fields);
    if (missing.length > 0) {
      throw new BadRequestException({
        message: '企业微信审批配置不完整',
        missing: missing.map((key) => `wecom.${key}`),
      });
    }
  }

  private missingConfigFields<T extends Record<string, unknown>, K extends keyof T>(target: T, fields: K[]) {
    return fields.filter((field) => !target[field]);
  }

  private hasApprovalControlIds(controlIds: Partial<ApprovalControlIds>) {
    return this.missingApprovalControlIds(controlIds).length === 0;
  }

  private missingApprovalControlIds(controlIds: Partial<ApprovalControlIds>) {
    return (['title', 'amount', 'reason', 'invoice_count', 'project'] as Array<keyof ApprovalControlIds>).filter(
      (key) => !controlIds[key],
    );
  }

  private wecomFieldLabel(key: keyof WeComExpenseConfig) {
    const labels: Record<keyof WeComExpenseConfig, string> = {
      enabled: '启用企业微信审批',
      corp_id: '企业微信 CorpID',
      agent_id: '企业微信审批应用 AgentID',
      corp_secret: '企业微信审批应用 Secret',
      approval_template_id: '企业微信报销审批模板 ID',
      default_creator_userid: '默认报销发起人 UserID',
      callback_token: '企业微信回调 Token',
      callback_aes_key: '企业微信回调 EncodingAESKey',
    };
    return labels[key];
  }

  private approvalControlLabel(key: keyof ApprovalControlIds) {
    const labels: Record<keyof ApprovalControlIds, string> = {
      title: '报销标题',
      amount: '报销金额',
      reason: '报销事由',
      invoice_count: '票据数量',
      project: '关联项目',
    };
    return labels[key];
  }

  private textControl(id: string | undefined, value: string) {
    return {
      control: 'Text',
      id,
      value: {
        text: value,
      },
    };
  }

  private moneyControl(id: string | undefined, value: number) {
    return {
      control: 'Money',
      id,
      value: {
        new_money: Math.round(value * 100),
      },
    };
  }

  private mapWeComStatus(value: string): {
    reimbursement_status: ReimbursementStatus;
    sync_status: WeComSyncStatus;
    node: string;
  } {
    const normalized = value.trim();
    if (['2', 'approved', 'pass', 'PASS', '同意', '已通过'].includes(normalized)) {
      return { reimbursement_status: '已通过', sync_status: '已回调', node: '企业微信审批通过' };
    }
    if (['3', 'rejected', 'reject', 'REJECT', '驳回', '已驳回'].includes(normalized)) {
      return { reimbursement_status: '已驳回', sync_status: '已回调', node: '企业微信审批驳回' };
    }
    if (['10', 'paid', '付款', '已付款'].includes(normalized)) {
      return { reimbursement_status: '已付款', sync_status: '已回调', node: '出纳付款完成' };
    }
    return { reimbursement_status: '审批中', sync_status: '审批中', node: '企业微信审批中' };
  }

  private invoiceFromUpload(file: UploadedExpenseFile, now: Date): ExpenseInvoiceValue {
    const suffix = file.originalname.split('.').pop()?.toUpperCase();
    const thumbnailType = suffix === 'PDF' ? 'PDF' : suffix === 'PNG' ? 'PNG' : 'JPG';
    return {
      id: this.newBusinessId('INV'),
      thumbnail_type: thumbnailType,
      invoice_no: `待识别-${now.getTime()}`,
      invoice_code: '',
      issued_date: this.formatDate(now),
      vendor: file.originalname,
      vendor_tax_no: '',
      amount: 0,
      tax: 0,
      category: '其他',
      category_confidence: 0,
      project: '',
      status: '待识别',
      uploader: '当前用户',
      uploader_avatar: '用',
      uploaded_at: this.formatDateTime(now),
      relative_uploaded_at: '刚刚',
      ai_insight: '等待腾讯 OCR 识别。',
      material_missing: ['OCR 识别结果'],
      ocr_provider: 'mock',
    };
  }

  private extractInvoiceFields(response: Record<string, unknown>): Partial<ExpenseInvoiceValue> {
    const text = JSON.stringify(response);
    const invoiceNo = this.pickByPatterns(text, [
      /"InvoiceNum"\s*:\s*"([^"]+)"/,
      /"InvoiceNo"\s*:\s*"([^"]+)"/,
      /发票号码[^0-9A-Z]{0,20}([0-9A-Z]{6,32})/,
    ]);
    const invoiceCode = this.pickByPatterns(text, [
      /"InvoiceCode"\s*:\s*"([^"]+)"/,
      /发票代码[^0-9A-Z]{0,20}([0-9A-Z]{6,32})/,
    ]);
    const amount = Number(
      this.pickByPatterns(text, [
        /"Amount"\s*:\s*"?([0-9.]+)"?/,
        /"Total"\s*:\s*"?([0-9.]+)"?/,
        /价税合计[^0-9]{0,20}([0-9.]+)/,
      ]) ?? 0,
    );
    const vendor =
      this.pickByPatterns(text, [
        /"SellerName"\s*:\s*"([^"]+)"/,
        /"Vendor"\s*:\s*"([^"]+)"/,
        /销售方名称[^"\u4e00-\u9fa5]{0,20}([\u4e00-\u9fa5（）()A-Za-z0-9]{4,80})/,
      ]) ?? '腾讯 OCR 已识别票据';
    const date =
      this.pickByPatterns(text, [
        /"Date"\s*:\s*"([^"]+)"/,
        /"InvoiceDate"\s*:\s*"([^"]+)"/,
        /开票日期[^0-9]{0,20}([0-9]{4}[-年/][0-9]{1,2}[-月/][0-9]{1,2})/,
      ]) ?? this.formatDate(new Date());

    return {
      invoice_no: invoiceNo ?? `OCR-${Date.now()}`,
      invoice_code: invoiceCode ?? '',
      issued_date: date.replace(/[年月/]/g, '-').replace(/日/g, ''),
      vendor,
      amount,
      tax: Math.round(amount * 0.06),
      category: this.guessCategory(vendor, text),
      category_confidence: amount > 0 ? 0.86 : 0.62,
      material_missing: amount > 0 ? [] : ['金额复核'],
    };
  }

  private extractVoucherFields(response: Record<string, unknown>, fileName: string): Partial<ExpenseVoucherValue> {
    const text = JSON.stringify(response);
    const voucherNo =
      this.pickByPatterns(text, [
        /"VoucherNo"\s*:\s*"([^"]+)"/,
        /"SerialNo"\s*:\s*"([^"]+)"/,
        /流水号[^0-9A-Z]{0,20}([0-9A-Z-]{6,40})/,
        /回单号[^0-9A-Z]{0,20}([0-9A-Z-]{6,40})/,
      ]) ?? `VOU-${Date.now()}`;
    const amount = Number(
      this.pickByPatterns(text, [
        /"Amount"\s*:\s*"?([0-9.]+)"?/,
        /"Total"\s*:\s*"?([0-9.]+)"?/,
        /金额[^0-9]{0,20}([0-9.]+)/,
      ]) ?? 0,
    );
    const date =
      this.pickByPatterns(text, [
        /"Date"\s*:\s*"([^"]+)"/,
        /"PaymentDate"\s*:\s*"([^"]+)"/,
        /日期[^0-9]{0,20}([0-9]{4}[-年/][0-9]{1,2}[-月/][0-9]{1,2})/,
      ]) ?? this.formatDate(new Date());
    const counterparty =
      this.pickByPatterns(text, [
        /"PayeeName"\s*:\s*"([^"]+)"/,
        /"Receiver"\s*:\s*"([^"]+)"/,
        /"ReceiverName"\s*:\s*"([^"]+)"/,
        /"AccountName"\s*:\s*"([^"]+)"/,
        /收款[方人户名账号]*[^"\u4e00-\u9fa5]{0,20}([\u4e00-\u9fa5（）()A-Za-z0-9]{3,80})/,
      ]) ?? '';
    const project =
      this.pickByPatterns(text, [
        /"Project"\s*:\s*"([^"]+)"/,
        /项目[^"\u4e00-\u9fa5A-Za-z0-9]{0,20}([\u4e00-\u9fa5（）()A-Za-z0-9-]{2,80})/,
      ]) ?? '';
    const subject = /银行|回单|付款|转账|流水/.test(`${fileName}${text}`) ? '银行回单' : '付款凭证';
    return {
      voucher_no: voucherNo,
      amount,
      date: date.replace(/[年月/]/g, '-').replace(/日/g, ''),
      project,
      subject,
      counterparty,
      confidence: amount > 0 ? 0.86 : 0.62,
      reason: amount > 0 ? 'OCR 已抽取金额和凭证信息，可进入凭证关联。' : '金额或流水号不完整，建议人工复核。',
    };
  }

  private detectInvoiceType(
    response: Record<string, unknown>,
    extracted: Partial<ExpenseInvoiceValue>,
    fallbackLabel?: string,
  ) {
    const text = JSON.stringify(response);
    const type =
      this.pickByPatterns(text, [
        /"Type"\s*:\s*"([^"]+)"/,
        /"InvoiceType"\s*:\s*"([^"]+)"/,
        /"Name"\s*:\s*"([^"]{2,40}(?:发票|回单|凭证|小票|行程单)[^"]*)"/,
      ]) ??
      (extracted.vendor ? this.guessDocumentType(`${extracted.vendor}${text}`) : fallbackLabel ?? '票据');
    const confidence = extracted.amount && extracted.invoice_no ? 0.88 : extracted.amount || extracted.invoice_no ? 0.72 : 0.58;
    return { type, confidence };
  }

  private guessDocumentType(text: string) {
    if (/增值税|专用发票|普通发票/.test(text)) return '增值税发票';
    if (/银行|回单|转账|付款/.test(text)) return '银行回单';
    if (/完税|税收缴款/.test(text)) return '完税凭证';
    if (/行程单|航空|火车|高铁/.test(text)) return '交通出行票据';
    if (/小票|购物|销售清单/.test(text)) return '购物小票';
    return '通用票据';
  }

  private buildTencentOcrPayload(
    file: UploadedExpenseFile,
    service?: { key: string; invoice_types?: readonly number[] },
  ) {
    const payload: Record<string, unknown> = {
      ImageBase64: file.buffer.toString('base64'),
    };
    if (service?.invoice_types?.length) {
      payload.Types = [...service.invoice_types];
    }
    return payload;
  }

  private guessCategory(vendor: string, rawText: string): ExpenseCategory {
    const text = `${vendor} ${rawText}`;
    if (/航空|航旅|火车|高铁|酒店|携程|差旅/.test(text)) return '差旅';
    if (/餐厅|餐饮|招待|食品/.test(text)) return '餐饮';
    if (/采购|供应链|工业品|配件|材料/.test(text)) return '采购';
    if (/办公|文具|用品|行政/.test(text)) return '办公';
    return '其他';
  }

  private pickByPatterns(text: string, patterns: RegExp[]) {
    for (const pattern of patterns) {
      const matched = text.match(pattern);
      if (matched?.[1]) return matched[1].trim();
    }
    return undefined;
  }

  private readXmlValue(xml: string, tag: string) {
    const matched = xml.match(new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${tag}>`, 'i'));
    return matched?.[1]?.trim() ?? '';
  }

  private getEncryptedXmlValue(raw: string) {
    if (!raw) return '';
    const direct = this.readXmlValue(raw, 'Encrypt');
    if (direct) return direct;
    return raw.includes('<xml') ? '' : raw;
  }

  private buildCategoryShare(invoices: ExpenseInvoiceValue[]) {
    return (['差旅', '餐饮', '采购', '办公', '其他'] as ExpenseCategory[]).map((category) => ({
      category,
      amount: invoices.filter((invoice) => invoice.category === category).reduce((sum, invoice) => sum + invoice.amount, 0),
    }));
  }

  private buildProjectTop(invoices: ExpenseInvoiceValue[]) {
    const totals = new Map<string, number>();
    invoices.forEach((invoice) => {
      totals.set(invoice.project || '未归属项目', (totals.get(invoice.project || '未归属项目') ?? 0) + invoice.amount);
    });
    return Array.from(totals.entries())
      .map(([project, amount]) => ({ project, amount }))
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 5);
  }

  private buildDepartmentBars(invoices: ExpenseInvoiceValue[]) {
    const departments = ['销售部', '研发部', '售后部', '质量部', '行政部'];
    return departments.map((dept, index) => ({
      dept,
      amount: invoices.filter((_, invoiceIndex) => invoiceIndex % departments.length === index).reduce((sum, invoice) => sum + invoice.amount, 0),
    }));
  }

  private buildMonthlyTrend(invoices: ExpenseInvoiceValue[]) {
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setMonth(date.getMonth() - (5 - index));
      return `${date.getMonth() + 1}月`;
    });
    return months.map((month, index) => {
      const factor = 0.78 + index * 0.06;
      return {
        month,
        差旅: Math.round(this.sumCategory(invoices, '差旅') * factor),
        餐饮: Math.round(this.sumCategory(invoices, '餐饮') * factor),
        采购: Math.round(this.sumCategory(invoices, '采购') * factor),
        办公: Math.round(this.sumCategory(invoices, '办公') * factor),
        其他: Math.round(this.sumCategory(invoices, '其他') * factor),
      };
    });
  }

  private sumCategory(invoices: ExpenseInvoiceValue[], category: ExpenseCategory) {
    return invoices.filter((invoice) => invoice.category === category).reduce((sum, invoice) => sum + invoice.amount, 0);
  }

  private formatCurrency(value: number) {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      maximumFractionDigits: 0,
    }).format(value);
  }

  private formatDate(value: Date) {
    return value.toISOString().slice(0, 10);
  }

  private formatDateTime(value: Date) {
    return value.toISOString().slice(0, 16).replace('T', ' ');
  }

  private newBusinessId(prefix: string) {
    return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
  }

  private mask(value: string) {
    if (!value) return '';
    if (value.length <= 6) return '***';
    return `${value.slice(0, 3)}***${value.slice(-3)}`;
  }
}
