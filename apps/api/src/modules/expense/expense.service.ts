import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTransport } from 'nodemailer';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';
import { CreateExpenseReimbursementDto } from './dto/create-expense-reimbursement.dto';
import { ListExpenseInvoicesQueryDto } from './dto/list-expense-invoices-query.dto';
import { SaveExpenseArchiveConfigDto } from './dto/save-expense-archive-config.dto';
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
  InvoiceStatus,
  ReimbursementStatus,
  ThirdPartyOfficialError,
  VoucherCandidateValue,
  WeComExpenseConfig,
  WeComSyncStatus,
} from './expense.types';
import { UploadExpenseOcrFilesDto } from './dto/upload-expense-ocr-files.dto';
import { OcrService } from '../ocr/ocr.service';
import { OssService } from '../oss/oss.service';
import { SIGNED_URL_TTL_SECONDS } from '../oss/oss.constants';

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

type ExpenseActor = {
  id: string;
  name: string;
  canSubmitOnBehalf: boolean;
};

type ExpenseSmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
};

export type ExpenseArchiveNode = {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  vendorFilter?: string[];
  children?: ExpenseArchiveNode[];
};

export type ExpenseArchiveConfig = {
  tree: ExpenseArchiveNode[];
  manual_category: Record<string, string>;
  excluded_ids: string[];
};

const RECORD_CATEGORIES = {
  invoice: 'expense_invoice',
  reimbursement: 'expense_reimbursement',
  rule: 'expense_rule',
  event: 'expense_event',
  integration: 'expense_integration',
  voucher: 'expense_voucher',
  reimbursementInvoice: 'expense_reimbursement_invoice',
  reimbursementOperation: 'expense_reimbursement_operation',
  archive: 'expense_archive',
} as const;

const INTEGRATION_KEY = 'expense:integrations';
const ARCHIVE_CONFIG_KEY = 'expense:archive-config';
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_UPLOAD_FILES = 20;
const MAX_EXPENSE_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXPENSE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
const ALLOWED_EXPENSE_FILE_EXTENSIONS = /\.(pdf|png|jpe?g|webp)$/i;

/** 「未分配」部门的筛选标识（用于 view-all 用户查看无部门标签的存量数据）。 */
export const UNASSIGNED_DEPT = 'unassigned';

/** 费用数据的访问作用域（由 controller 据 req.user 构建）。 */
export type ExpenseScope = {
  /** 当前用户自身部门 code（无则 null）。普通用户的数据作用域。 */
  departmentCode: string | null;
  /** 当前用户自身部门名（写库时作为展示快照）。 */
  departmentName: string | null;
  /** 是否持跨部门查看权（`*` 或 `expense:view-all`）。 */
  hasViewAll: boolean;
  /** 仅对 view-all 生效的部门筛选：具体 code、'unassigned'、或 undefined=全部。 */
  filterDepartment?: string | null;
};

@Injectable()
export class ExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secureConfigService: SecureConfigService,
    private readonly configService: ConfigService,
    private readonly ossService: OssService,
    private readonly ocrService: OcrService,
  ) {}

  async listInvoices(query: ListExpenseInvoicesQueryDto, scope: ExpenseScope) {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE;
    const keyword = query.keyword?.trim().toLowerCase() ?? '';
    const status = query.status?.trim() ?? '';
    const category = query.category?.trim() ?? '';
    const invoices = await this.ensureInvoices(scope);

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

  async getDashboard(scope: ExpenseScope) {
    const [invoices, reimbursements, events] = await Promise.all([
      this.ensureInvoices(scope),
      this.ensureReimbursements(scope),
      this.listEvents(8, scope),
    ]);
    const totalAmount = invoices.reduce((sum, invoice) => sum + invoice.amount, 0);
    const currentMonthKey = this.formatDate(new Date()).slice(0, 7);
    const monthInvoices = invoices.filter((invoice) => this.monthKeyOf(invoice.issued_date) === currentMonthKey);
    const monthAmount = monthInvoices.reduce((sum, invoice) => sum + invoice.amount, 0);
    const pendingInvoices = invoices.filter((invoice) => ['待识别', '待确认', '异常'].includes(invoice.status));
    const abnormalInvoices = invoices.filter((invoice) => invoice.status === '异常');
    const autoHandled = Math.round(
      (invoices.filter((invoice) => invoice.category_confidence >= 0.85).length / Math.max(invoices.length, 1)) * 100,
    );
    const hasBusinessData = invoices.length > 0 || reimbursements.length > 0;

    return {
      month_amount: monthAmount,
      total_amount: totalAmount,
      kpis: [
        { key: 'monthly_amount', title: '本月报销总额', value: this.formatCurrency(monthAmount), trend: `${monthInvoices.length} 张 · 累计 ${this.formatCurrency(totalAmount)}`, icon: 'TrendingUp' },
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
      status_breakdown: invoices.length ? this.buildStatusBreakdown(invoices) : [],
      project_top: invoices.length ? this.buildProjectTop(invoices) : [],
    };
  }

  async listReimbursements(scope: ExpenseScope) {
    return this.ensureReimbursements(scope);
  }

  async listVouchers(scope: ExpenseScope) {
    return this.ensureVouchers(scope);
  }

  async listRules() {
    return this.ensureRules();
  }

  async listVoucherCandidates(invoiceId: string, scope: ExpenseScope): Promise<VoucherCandidateValue[]> {
    const invoice = await this.getInvoiceOrThrow(invoiceId, scope);
    // 候选凭证池限定在同作用域内，杜绝跨部门撮合。
    const [invoices, vouchers] = await Promise.all([this.ensureInvoices(scope), this.ensureVouchers(scope)]);
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

  async uploadInvoices(files: UploadedExpenseFile[], payload: UploadExpenseOcrFilesDto = {}, scope: ExpenseScope) {
    this.validateUploadFiles(files, '票据');
    this.assertCanWrite(scope);
    if (!this.ossService.isEnabled) {
      throw new ServiceUnavailableException('OSS 文件存储尚未配置，不能上传财务原始凭证');
    }
    const tag = this.ownDeptTag(scope);

    const objectKeys = await Promise.all(
      files.map((file) =>
        this.ossService.uploadBuffer(file.buffer, 'expense/invoices', file.originalname, file.mimetype),
      ),
    );
    if (objectKeys.some((key) => !key)) {
      throw new ServiceUnavailableException('部分原始发票未能保存到对象存储，本批次未生成票据记录，请检查 OSS 后重试');
    }
    const created = await Promise.all(
      files.map((file, index) =>
        this.createInvoiceFromFile(file, objectKeys[index] as string, payload, tag),
      ),
    );
    await this.recordEvent({
      title: '票据上传完成',
      detail: `已接收 ${created.length} 个文件，默认自动识别；低置信度或失败时可人工选择服务重试`,
      level: 'info',
      provider: 'tencent_ocr',
      ...tag,
    });
    const matches = await this.applyAutoVoucherMatches(true, scope);
    return { items: await this.refreshInvoicesByIds(created.map((item) => item.id)), matches };
  }

  async uploadVouchers(files: UploadedExpenseFile[], payload: UploadExpenseOcrFilesDto = {}, scope: ExpenseScope) {
    this.validateUploadFiles(files, '付款凭证');
    this.assertCanWrite(scope);
    if (!this.ossService.isEnabled) {
      throw new ServiceUnavailableException('OSS 文件存储尚未配置，不能上传财务原始凭证');
    }
    const tag = this.ownDeptTag(scope);

    const objectKeys = await Promise.all(
      files.map((file) =>
        this.ossService.uploadBuffer(file.buffer, 'expense/vouchers', file.originalname, file.mimetype),
      ),
    );
    if (objectKeys.some((key) => !key)) {
      throw new ServiceUnavailableException('部分原始付款凭证未能保存到对象存储，本批次未生成凭证记录，请检查 OSS 后重试');
    }
    const created = await Promise.all(
      files.map((file, index) =>
        this.createVoucherFromFile(file, objectKeys[index] as string, payload, tag),
      ),
    );
    await this.recordEvent({
      title: '付款凭证上传完成',
      detail: `已接收 ${created.length} 个文件，可继续与票据做自动或人工关联`,
      level: 'info',
      provider: 'tencent_ocr',
      ...tag,
    });
    const matches = await this.applyAutoVoucherMatches(true, scope);
    return { items: created, matches };
  }

  async autoMatchVouchers(scope: ExpenseScope) {
    return this.applyAutoVoucherMatches(true, scope);
  }

  /** 批量改派部门（仅 view-all）：把发票/凭证/报销单归到目标部门 code，或 'unassigned' 清空。 */
  async reassignDepartment(
    payload: { type?: 'invoice' | 'voucher' | 'reimbursement'; ids?: string[]; department_code?: string },
    scope: ExpenseScope,
  ) {
    if (!scope.hasViewAll) {
      throw new ForbiddenException('无跨部门改派权限');
    }
    const ids = Array.from(new Set((payload.ids ?? []).filter(Boolean)));
    if (ids.length === 0) {
      throw new BadRequestException('请选择要改派的记录');
    }
    const targetCode =
      payload.department_code === UNASSIGNED_DEPT ? null : (payload.department_code ?? '').trim() || null;
    const targetName = targetCode ? await this.resolveDeptNameByCode(targetCode) : null;
    if (targetCode && !targetName) {
      throw new BadRequestException('目标部门不存在');
    }

    const typeMeta = {
      invoice: { category: RECORD_CATEGORIES.invoice, label: '发票' },
      voucher: { category: RECORD_CATEGORIES.voucher, label: '付款凭证' },
      reimbursement: { category: RECORD_CATEGORIES.reimbursement, label: '报销单' },
    } as const;
    const meta = typeMeta[payload.type ?? 'invoice'];
    if (!meta) {
      throw new BadRequestException('改派类型不合法');
    }

    const all = await this.listValues<{ id: string } & Record<string, unknown>>(meta.category);
    const targets = all.filter((r) => ids.includes(r.id));
    for (const rec of targets) {
      const next = { ...rec, department_code: targetCode, department_name: targetName };
      await this.upsertValue(meta.category, rec.id, next, `${rec.id} → ${targetName ?? '未分配'}`);
    }
    await this.recordEvent({
      title: '费用数据已改派部门',
      detail: `${targets.length} 条${meta.label}已改派至「${targetName ?? '未分配'}」`,
      level: 'info',
      department_code: targetCode,
      department_name: targetName,
    });
    return { updated: targets.length, department_code: targetCode, department_name: targetName };
  }

  /**
   * 人工关联票据与付款凭证。区别于 AI 自动关联（只在双方都未关联时建链），
   * 人工关联允许「改绑」：目标票据或目标凭证若已关联到别的对端，会先释放旧对端再建新链。
   * 仅对「已报销」的票据加保护，避免破坏已提交的报销单。
   */
  async linkVoucherManually(invoiceId: string, voucherId: string, scope: ExpenseScope) {
    const [invoice, vouchers, invoices] = await Promise.all([
      this.getInvoiceOrThrow(invoiceId, scope),
      this.ensureVouchers(scope),
      this.ensureInvoices(scope),
    ]);
    const voucher = vouchers.find((item) => item.id === voucherId);
    if (!voucher) {
      // 不在作用域内（含跨部门）按「不存在」处理，避免跨部门关联与存在性泄露。
      throw new NotFoundException('付款凭证不存在');
    }

    // 已经互相关联：幂等返回，避免无意义写库
    if (invoice.matched_voucher_id === voucher.id && voucher.matched_invoice_id === invoice.id) {
      return invoice;
    }
    // 已报销的票据不允许改动关联
    if (invoice.status === '已报销') {
      throw new BadRequestException('该票据已报销，无法重新关联');
    }

    const writes: Array<Promise<unknown>> = [];

    // 1) 目标票据原先关联了别的凭证 → 释放该旧凭证
    if (invoice.matched_voucher_id && invoice.matched_voucher_id !== voucher.id) {
      const oldVoucher = vouchers.find((item) => item.id === invoice.matched_voucher_id);
      if (oldVoucher) {
        const released = this.releaseVoucherLink(oldVoucher);
        writes.push(
          this.upsertValue(RECORD_CATEGORIES.voucher, released.id, released, released.voucher_no || released.file_name),
        );
      }
    }

    // 2) 目标凭证原先关联了别的票据 → 释放该旧票据
    if (voucher.matched_invoice_id && voucher.matched_invoice_id !== invoice.id) {
      const oldInvoice = invoices.find((item) => item.id === voucher.matched_invoice_id);
      if (oldInvoice) {
        if (oldInvoice.status === '已报销') {
          throw new BadRequestException('该付款凭证已关联到已报销票据，无法改绑');
        }
        const released = this.releaseInvoiceLink(oldInvoice);
        writes.push(
          this.upsertValue(RECORD_CATEGORIES.invoice, released.id, released, `${released.invoice_no} ${released.vendor}`),
        );
      }
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
    writes.push(
      this.upsertValue(RECORD_CATEGORIES.invoice, nextInvoice.id, nextInvoice, `${nextInvoice.invoice_no} ${nextInvoice.vendor}`),
      this.upsertValue(RECORD_CATEGORIES.voucher, nextVoucher.id, nextVoucher, nextVoucher.voucher_no || nextVoucher.file_name),
    );

    await Promise.all(writes);
    await this.recordEvent({
      title: '付款凭证人工关联完成',
      detail: `${nextInvoice.invoice_no} 已关联 ${nextVoucher.voucher_no}，匹配分 ${score}`,
      level: 'info',
    });
    return nextInvoice;
  }

  /** 解除付款凭证侧的关联字段（改绑或解绑时复用），状态回到「已识别」（异常态保持不变）。 */
  private releaseVoucherLink(voucher: ExpenseVoucherValue): ExpenseVoucherValue {
    return {
      ...voucher,
      matched_invoice_id: undefined,
      match_score: undefined,
      match_reasons: undefined,
      matched_by: undefined,
      matched_at: undefined,
      status: voucher.status === '异常' ? voucher.status : '已识别',
    };
  }

  /** 解除票据侧的关联字段（改绑或解绑时复用），状态回到「已识别」。 */
  private releaseInvoiceLink(invoice: ExpenseInvoiceValue): ExpenseInvoiceValue {
    return {
      ...invoice,
      voucher_no: undefined,
      matched_voucher_id: undefined,
      match_confidence: undefined,
      payment_voucher: undefined,
      match_score: undefined,
      match_reasons: undefined,
      matched_by: undefined,
      matched_at: undefined,
      status: '已识别',
    };
  }

  async updateInvoice(invoiceId: string, payload: UpdateExpenseInvoiceDto, scope: ExpenseScope) {
    const invoice = await this.getInvoiceOrThrow(invoiceId, scope);
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

  async verifyVatInvoice(invoiceId: string, scope: ExpenseScope) {
    const invoice = await this.getInvoiceOrThrow(invoiceId, scope);
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

  async createReimbursement(payload: CreateExpenseReimbursementDto, scope: ExpenseScope, actor: ExpenseActor) {
    this.assertCanWrite(scope);
    const requestedInvoiceIds = Array.from(new Set(payload.invoice_ids));
    if (requestedInvoiceIds.length !== payload.invoice_ids.length) {
      throw new BadRequestException('报销单中存在重复票据');
    }
    // 仅能在作用域内的票据上组单，跨部门票据天然被过滤掉。
    const invoices = (await this.ensureInvoices(scope)).filter((invoice) => requestedInvoiceIds.includes(invoice.id));
    if (invoices.length === 0) {
      throw new BadRequestException('请至少选择一张有效票据');
    }
    if (invoices.length !== requestedInvoiceIds.length) {
      throw new BadRequestException('部分票据不在你的部门范围内，无法组单');
    }
    const alreadyReimbursed = invoices.filter((invoice) => invoice.status === '已报销');
    if (alreadyReimbursed.length > 0) {
      throw new BadRequestException(`以下票据已报销，不能重复组单：${alreadyReimbursed.map((item) => item.invoice_no).join('、')}`);
    }
    const unlinked = invoices.filter((invoice) => invoice.status !== '已关联' || !invoice.matched_voucher_id);
    if (unlinked.length > 0) {
      throw new BadRequestException(`以下票据尚未关联有效付款凭证：${unlinked.map((item) => item.invoice_no).join('、')}`);
    }
    const activeReimbursements = (await this.ensureReimbursements(scope)).filter(
      (item) => item.status !== '已驳回',
    );
    const occupiedInvoiceIds = new Set(activeReimbursements.flatMap((item) => item.invoice_ids ?? []));
    const occupied = invoices.filter((invoice) => occupiedInvoiceIds.has(invoice.id));
    if (occupied.length > 0) {
      throw new BadRequestException(`以下票据已进入其他报销单：${occupied.map((item) => item.invoice_no).join('、')}`);
    }
    const tag = this.ownDeptTag(scope);
    const voucherIds = Array.from(
      new Set(invoices.map((invoice) => invoice.matched_voucher_id).filter(Boolean) as string[]),
    );
    const now = new Date();
    const reimbursement: ExpenseReimbursementValue = {
      ...tag,
      id: this.newBusinessId('EXP'),
      title: payload.title.trim(),
      applicant:
        actor.canSubmitOnBehalf && payload.applicant?.trim()
          ? payload.applicant.trim()
          : actor.name,
      applicant_user_id: actor.id,
      applied_date: this.formatDate(now),
      amount: invoices.reduce((sum, invoice) => sum + invoice.amount, 0),
      invoice_count: invoices.length,
      invoice_ids: invoices.map((invoice) => invoice.id),
      voucher_ids: voucherIds,
      status: '草稿',
      node: '待提交企微审批',
      project: payload.project?.trim() || invoices[0]?.project || '',
      reason: payload.reason?.trim() || '',
      wecom_flow_id: '',
      wecom_sync_status: '未提交',
      wecom_approver: '-',
      wecom_updated_at: this.formatDateTime(now),
      wecom_creator_userid:
        actor.canSubmitOnBehalf ? payload.wecom_creator_userid?.trim() || undefined : undefined,
      notify_emails: this.normalizeEmails(payload.notify_emails),
      cc_emails: this.normalizeEmails(payload.cc_emails),
    };
    const reimbursementJson = JSON.parse(JSON.stringify(reimbursement)) as Prisma.InputJsonValue;
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const invoice of invoices) {
          await tx.systemSetting.create({
            data: {
              category: RECORD_CATEGORIES.reimbursementInvoice,
              key: `${RECORD_CATEGORIES.reimbursementInvoice}:${invoice.id}`,
              description: reimbursement.id,
              value: {
                invoice_id: invoice.id,
                reimbursement_id: reimbursement.id,
              },
            },
          });
        }
        await tx.systemSetting.create({
          data: {
            category: RECORD_CATEGORIES.reimbursement,
            key: `${RECORD_CATEGORIES.reimbursement}:${reimbursement.id}`,
            description: reimbursement.title,
            value: reimbursementJson,
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('所选票据已被其他报销单占用，请刷新后重试');
      }
      throw error;
    }
    void this.recordEvent({
      title: '报销单已创建',
      detail: `${reimbursement.title} / ${this.formatCurrency(reimbursement.amount)}`,
      level: 'info',
      ...tag,
    }).catch(() => undefined);
    return reimbursement;
  }

  async submitWeComApproval(reimbursementId: string, scope: ExpenseScope) {
    await this.acquireReimbursementOperation(reimbursementId, 'submit');
    let submitted = false;
    try {
      const reimbursement = await this.getReimbursementOrThrow(reimbursementId, scope);
      if (reimbursement.status !== '草稿' || reimbursement.wecom_flow_id) {
        throw new BadRequestException('该报销单已经提交审批，不能重复提交');
      }
      const config = await this.getResolvedIntegrationConfig();
      this.assertWeComReady(config, ['corp_id', 'corp_secret', 'approval_template_id', 'default_creator_userid']);
      const controlIds = await this.getApprovalControlIds();
      const client = new WeComApprovalClient(config.wecom);
      const accessToken = await client.getAccessToken();
      const materialSummary = `${reimbursement.invoice_count} 张发票 / ${reimbursement.voucher_ids?.length ?? 0} 份凭证`;
      const response = await client.submitApproval(accessToken, {
        creator_userid: reimbursement.wecom_creator_userid || config.wecom.default_creator_userid,
        template_id: config.wecom.approval_template_id,
        use_template_approver: 1,
        apply_data: {
          contents: [
            this.textControl(controlIds.title, reimbursement.title),
            this.moneyControl(controlIds.amount, reimbursement.amount),
            this.textControl(controlIds.reason, reimbursement.reason || reimbursement.project || reimbursement.title),
            this.textControl(controlIds.invoice_count, materialSummary),
            this.textControl(controlIds.project, reimbursement.project || '-'),
          ],
        },
        summary_list: [
          {
            summary_info: [
              { text: reimbursement.title, lang: 'zh_CN' },
              { text: this.formatCurrency(reimbursement.amount), lang: 'zh_CN' },
              { text: materialSummary, lang: 'zh_CN' },
            ],
          },
        ],
      });
      const spNo = String(response.sp_no ?? response.sp_no_list ?? '');
      if (!spNo) {
        throw new BadRequestException('企业微信未返回审批编号，报销单仍保留为草稿，请检查模板后重试');
      }
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
      submitted = true;
      await this.recordEvent({
        title: '已提交企业微信报销审批',
        detail: `${next.title} / 审批编号 ${spNo || '等待企微返回'}`,
        level: 'info',
        provider: 'wecom',
      });
      // 邮件通知与审批提交解耦：失败不影响主流程（fire-and-forget）。
      void this.queueReimbursementEmails(next, '已提交企业微信审批');
      return next;
    } finally {
      if (!submitted) {
        await this.releaseReimbursementOperation(reimbursementId).catch(() => undefined);
      }
    }
  }

  async deleteDraftReimbursement(reimbursementId: string, scope: ExpenseScope) {
    await this.acquireReimbursementOperation(reimbursementId, 'delete-draft');
    try {
      const reimbursement = await this.getReimbursementOrThrow(reimbursementId, scope);
      if (reimbursement.status !== '草稿' || reimbursement.wecom_flow_id) {
        throw new BadRequestException('仅未提交企业微信的草稿报销单可以删除');
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.systemSetting.deleteMany({
          where: { key: `${RECORD_CATEGORIES.reimbursement}:${reimbursement.id}` },
        });
        await tx.systemSetting.deleteMany({
          where: {
            description: reimbursement.id,
            key: {
              in: reimbursement.invoice_ids.map(
                (invoiceId) => `${RECORD_CATEGORIES.reimbursementInvoice}:${invoiceId}`,
              ),
            },
          },
        });
      });
      void this.recordEvent({
        title: '报销草稿已删除',
        detail: `${reimbursement.title} / 已释放 ${reimbursement.invoice_ids.length} 张票据`,
        level: 'info',
        department_code: reimbursement.department_code,
        department_name: reimbursement.department_name,
      }).catch(() => undefined);
      return { ok: true };
    } finally {
      await this.releaseReimbursementOperation(reimbursementId).catch(() => undefined);
    }
  }

  /**
   * 报销单邮件通知（与「邮箱管理」打通的业务流程闭环）。
   * 邮件发送与审批主流程解耦；SMTP 未配置或发送失败时记录可见事件，但不回滚审批。
   */
  private async queueReimbursementEmails(reimbursement: ExpenseReimbursementValue, trigger: string) {
    const to = this.normalizeEmails(reimbursement.notify_emails);
    const cc = this.normalizeEmails(reimbursement.cc_emails);
    if (to.length === 0 && cc.length === 0) return;
    try {
      const smtp = this.getSmtpConfig();
      const audience = [
        to.length ? `收件人 ${to.join('、')}` : '',
        cc.length ? `抄送 ${cc.join('、')}` : '',
      ]
        .filter(Boolean)
        .join('；');
      if (!smtp) {
        await this.recordEvent({
          title: '报销审批邮件通知未发送',
          detail: `${trigger}：${reimbursement.title} → ${audience}（SMTP 配置不完整）`,
          level: 'warning',
        });
        return;
      }
      const transporter = createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        ...(smtp.user && smtp.password
          ? { auth: { user: smtp.user, pass: smtp.password } }
          : {}),
      });
      const subjectTitle = reimbursement.title.replace(/[\r\n]+/g, ' ').slice(0, 120);
      const recipients = to.length ? to : cc;
      await transporter.sendMail({
        from: smtp.from,
        to: recipients,
        ...(to.length && cc.length ? { cc } : {}),
        subject: `[费用报销] ${trigger} - ${subjectTitle}`,
        text: [
          `报销单：${reimbursement.title}`,
          `当前状态：${trigger}`,
          `申请人：${reimbursement.applicant}`,
          `金额：${this.formatCurrency(reimbursement.amount)}`,
          `报销单号：${reimbursement.id}`,
          reimbursement.wecom_flow_id ? `企业微信审批编号：${reimbursement.wecom_flow_id}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      });
      await this.recordEvent({
        title: '报销审批邮件通知已发送',
        detail: `${trigger}：${reimbursement.title} → ${audience}`,
        level: 'info',
      });
    } catch (error) {
      await this.recordEvent({
        title: '报销审批邮件通知发送失败',
        detail: `${trigger}：${reimbursement.title}（${this.toSafeErrorMessage(error)}）`,
        level: 'warning',
      }).catch(() => undefined);
    }
  }

  private getSmtpConfig(): ExpenseSmtpConfig | null {
    const host = this.configService.get<string>('SMTP_HOST')?.trim() ?? '';
    const user = this.configService.get<string>('SMTP_USER')?.trim() ?? '';
    const password = this.configService.get<string>('SMTP_PASSWORD') ?? '';
    const from = this.configService.get<string>('SMTP_FROM')?.trim() || user;
    const rawPort = Number(this.configService.get<string>('SMTP_PORT') ?? 465);
    const port = Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : 465;
    const secureValue = this.configService.get<string>('SMTP_SECURE')?.trim().toLowerCase();
    const secure = secureValue ? ['1', 'true', 'yes', 'on'].includes(secureValue) : port === 465;
    if (!host || !from || Boolean(user) !== Boolean(password)) return null;
    return { host, port, secure, user, password, from };
  }

  private hasSmtpConfig() {
    return this.getSmtpConfig() !== null;
  }

  /** 去重、去空、规范化邮箱列表。 */
  private normalizeEmails(emails?: string[]) {
    if (!Array.isArray(emails)) return [];
    return Array.from(
      new Set(
        emails
          .map((email) => (typeof email === 'string' ? email.trim().toLowerCase() : ''))
          .filter((email) => email.length > 0),
      ),
    );
  }

  private toSafeErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    return message.replace(/[\r\n]+/g, ' ').slice(0, 240);
  }

  async syncWeComApproval(reimbursementId: string, scope: ExpenseScope) {
    const reimbursement = await this.getReimbursementOrThrow(reimbursementId, scope);
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
    const smtpReady = this.hasSmtpConfig();
    return {
      storage: {
        ready: this.ossService.isEnabled,
        missing: this.ossService.isEnabled
          ? []
          : [{ key: 'oss', label: '阿里云 OSS 文件存储配置' }],
      },
      tencent_ocr: {
        ready: this.hasTencentConfig(config),
        supported_actions: TENCENT_OCR_SUPPORTED_ACTIONS,
        missing: [
          ...(config.tencent_ocr.enabled
            ? []
            : [{ key: 'tencent_ocr.enabled', label: '启用腾讯 OCR' }]),
          ...this.missingConfigFields(config.tencent_ocr, ['secret_id', 'secret_key']).map((key) => ({
            key: `tencent_ocr.${key}`,
            label: key === 'secret_id' ? '腾讯云 SecretId' : '腾讯云 SecretKey',
          })),
        ],
        optional: [
          { key: 'tencent_ocr.region', label: '腾讯云地域', default: DEFAULT_TENCENT_OCR_CONFIG.region },
          { key: 'tencent_ocr.invoice_action', label: '票据上传默认 Action', default: DEFAULT_TENCENT_OCR_CONFIG.invoice_action },
        ],
      },
      wecom: {
        ready: this.hasWeComConfig(config) && this.hasApprovalControlIds(controlIds),
        missing: [
          ...(config.wecom.enabled
            ? []
            : [{ key: 'wecom.enabled', label: '启用企业微信审批' }]),
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
      email: {
        ready: smtpReady,
        missing: smtpReady
          ? []
          : [
              { key: 'smtp.host', label: 'SMTP_HOST' },
              { key: 'smtp.from', label: 'SMTP_FROM（或 SMTP_USER）' },
              { key: 'smtp.credentials', label: 'SMTP_USER / SMTP_PASSWORD（需要认证时）' },
            ],
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

    // 腾讯 OCR 已统一到 IntegrationConfig(kind=tencent_ocr)，由「系统管理 → 腾讯OCR配置」维护。
    // 兼容旧入参：若仍携带 tencent_ocr，则转写到统一存储，不再落 systemSetting。
    if (payload.tencent_ocr) {
      const current = await this.ocrService.getMaskedTencentConfig();
      await this.ocrService.saveTencentConfig({
        enabled: payload.tencent_ocr.enabled ?? current.enabled,
        secret_id: payload.tencent_ocr.secret_id ?? current.secret_id,
        secret_key: payload.tencent_ocr.secret_key || undefined,
        region: payload.tencent_ocr.region ?? current.region,
        endpoint: payload.tencent_ocr.endpoint ?? current.endpoint,
        invoice_action: payload.tencent_ocr.invoice_action ?? current.invoice_action,
      });
    }

    const next: StoredExpenseConfig = {
      // 保留历史 tencent_ocr 旧值（已不再被读取），避免破坏既有数据
      tencent_ocr: existing.tencent_ocr,
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
              approval_control_ids: payload.wecom.approval_control_ids
                ? {
                    ...(existing.wecom?.approval_control_ids ?? {}),
                    ...this.normalizeApprovalControlIds(payload.wecom.approval_control_ids),
                  }
                : existing.wecom?.approval_control_ids,
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

  async getArchiveConfig(): Promise<ExpenseArchiveConfig> {
    const record = await this.prisma.systemSetting.findUnique({
      where: { key: ARCHIVE_CONFIG_KEY },
      select: { value: true },
    });
    if (!record?.value || typeof record.value !== 'object' || Array.isArray(record.value)) {
      return { tree: [], manual_category: {}, excluded_ids: [] };
    }
    const value = record.value as Record<string, unknown>;
    return {
      tree: this.sanitizeArchiveTree(Array.isArray(value.tree) ? value.tree : []),
      manual_category: this.sanitizeStringMap(value.manual_category),
      excluded_ids: this.sanitizeStringList(value.excluded_ids),
    };
  }

  async saveArchiveConfig(payload: SaveExpenseArchiveConfigDto): Promise<ExpenseArchiveConfig> {
    const tree = this.sanitizeArchiveTree(payload.tree);
    const validNodeIds = new Set<string>();
    const collectNodeIds = (nodes: ExpenseArchiveNode[]) => {
      for (const node of nodes) {
        validNodeIds.add(node.id);
        if (node.children) collectNodeIds(node.children);
      }
    };
    collectNodeIds(tree);
    const manualCategory = Object.fromEntries(
      Object.entries(this.sanitizeStringMap(payload.manual_category))
        .filter(([, nodeId]) => validNodeIds.has(nodeId)),
    );
    const config: ExpenseArchiveConfig = {
      tree,
      manual_category: manualCategory,
      excluded_ids: this.sanitizeStringList(payload.excluded_ids),
    };
    const jsonValue = JSON.parse(JSON.stringify(config)) as Prisma.InputJsonValue;
    await this.prisma.systemSetting.upsert({
      where: { key: ARCHIVE_CONFIG_KEY },
      create: {
        category: RECORD_CATEGORIES.archive,
        key: ARCHIVE_CONFIG_KEY,
        description: '费用归档分类与人工归档设置',
        value: jsonValue,
      },
      update: {
        value: jsonValue,
      },
    });
    return config;
  }

  private sanitizeArchiveTree(
    input: unknown[],
    depth = 0,
    state: { value: number; ids: Set<string> } = { value: 0, ids: new Set<string>() },
  ): ExpenseArchiveNode[] {
    if (depth > 4) {
      throw new BadRequestException('归档分类最多支持 5 层');
    }
    const result: ExpenseArchiveNode[] = [];
    for (const raw of input) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      state.value += 1;
      if (state.value > 100) {
        throw new BadRequestException('归档分类最多支持 100 个节点');
      }
      const value = raw as Record<string, unknown>;
      const id = typeof value.id === 'string' ? value.id.trim().slice(0, 80) : '';
      const name = typeof value.name === 'string' ? value.name.trim().slice(0, 80) : '';
      if (!id || !name) continue;
      if (state.ids.has(id)) {
        throw new BadRequestException(`归档分类 ID 重复：${id}`);
      }
      state.ids.add(id);
      const node: ExpenseArchiveNode = {
        id,
        name,
        ...(typeof value.icon === 'string' ? { icon: value.icon.slice(0, 16) } : {}),
        ...(typeof value.color === 'string' ? { color: value.color.slice(0, 32) } : {}),
        vendorFilter: this.sanitizeStringList(value.vendorFilter).slice(0, 20),
      };
      if (Array.isArray(value.children)) {
        node.children = this.sanitizeArchiveTree(value.children, depth + 1, state);
      }
      result.push(node);
    }
    return result;
  }

  private sanitizeStringMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 1000)
        .filter(([key, item]) => key.trim() && typeof item === 'string' && item.trim())
        .map(([key, item]) => [key.trim().slice(0, 120), String(item).trim().slice(0, 120)]),
    );
  }

  private sanitizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(
      new Set(
        value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim().slice(0, 160))
          .filter(Boolean),
      ),
    ).slice(0, 1000);
  }

  private async createInvoiceFromFile(
    file: UploadedExpenseFile,
    invoiceObjectKey: string,
    payload: UploadExpenseOcrFilesDto,
    dept: { department_code: string | null; department_name: string | null } = { department_code: null, department_name: null },
  ) {
    const now = new Date();
    const baseInvoice = this.invoiceFromUpload(file, now);
    // 打部门标签：所有分支均以 {...baseInvoice} 展开，故在此统一注入。
    Object.assign(baseInvoice, dept);
    const ocrMode = payload.ocr_mode === 'manual' ? 'manual' : 'auto';
    const service = getTencentOcrService(
      ocrMode === 'manual' ? payload.ocr_service_key : undefined,
      'invoice',
    );

    const fileUrl = this.ossService.getSignedUrl(invoiceObjectKey, SIGNED_URL_TTL_SECONDS.DOCUMENT);
    baseInvoice.file_object_key = invoiceObjectKey;
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

  private async createVoucherFromFile(
    file: UploadedExpenseFile,
    voucherObjectKey: string,
    payload: UploadExpenseOcrFilesDto,
    dept: { department_code: string | null; department_name: string | null } = { department_code: null, department_name: null },
  ) {
    const now = new Date();
    const ocrMode = payload.ocr_mode === 'manual' ? 'manual' : 'auto';
    const service = getTencentOcrService(
      ocrMode === 'manual' ? payload.ocr_service_key : undefined,
      'voucher',
    );

    const fileUrl = this.ossService.getSignedUrl(voucherObjectKey, SIGNED_URL_TTL_SECONDS.DOCUMENT);

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
      ...dept,
      file_object_key: voucherObjectKey,
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

  private async applyAutoVoucherMatches(recordSummaryEvent: boolean, scope?: ExpenseScope): Promise<VoucherMatchResult> {
    // 撮合池限定在作用域内（同部门），自动关联不会跨部门。
    const [invoices, vouchers] = await Promise.all([this.ensureInvoices(scope), this.ensureVouchers(scope)]);
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
        ...(scope ? this.ownDeptTag(scope) : {}),
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
    if (next.status === '已驳回') {
      await this.prisma.systemSetting.deleteMany({
        where: {
          key: {
            in: next.invoice_ids.map(
              (invoiceId) => `${RECORD_CATEGORIES.reimbursementInvoice}:${invoiceId}`,
            ),
          },
        },
      });
    }
    if (next.status === '已通过' || next.status === '已付款') {
      const invoices = await this.refreshInvoicesByIds(next.invoice_ids);
      await Promise.all(invoices.map((invoice) => {
        const nextInvoice: ExpenseInvoiceValue = { ...invoice, status: '已报销' };
        return this.upsertValue(RECORD_CATEGORIES.invoice, nextInvoice.id, nextInvoice, `${nextInvoice.invoice_no} ${nextInvoice.vendor}`);
      }));
    }
    if (
      next.status !== reimbursement.status &&
      (next.status === '已通过' || next.status === '已付款' || next.status === '已驳回')
    ) {
      void this.queueReimbursementEmails(next, `企业微信审批${next.status}`);
    }
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

  private async ensureInvoices(scope?: ExpenseScope) {
    const list = (await this.listValues<ExpenseInvoiceValue>(RECORD_CATEGORIES.invoice)).map(
      (item) => this.refreshExpenseFileUrl(item),
    );
    return scope ? this.filterByScope(list, scope) : list;
  }

  private async ensureVouchers(scope?: ExpenseScope) {
    const list = (await this.listValues<ExpenseVoucherValue>(RECORD_CATEGORIES.voucher)).map(
      (item) => this.refreshExpenseFileUrl(item),
    );
    return scope ? this.filterByScope(list, scope) : list;
  }

  private async ensureReimbursements(scope?: ExpenseScope) {
    const list = await this.listValues<ExpenseReimbursementValue>(RECORD_CATEGORIES.reimbursement);
    return scope ? this.filterByScope(list, scope) : list;
  }

  private async ensureRules() {
    return this.listValues<ExpenseRuleValue>(RECORD_CATEGORIES.rule);
  }

  private refreshExpenseFileUrl<T extends { file_object_key?: string; file_url?: string }>(item: T): T {
    if (!item.file_object_key) return item;
    const freshUrl = this.ossService.getSignedUrl(
      item.file_object_key,
      SIGNED_URL_TTL_SECONDS.DOCUMENT,
    );
    return freshUrl ? { ...item, file_url: freshUrl } : item;
  }

  private async listEvents(take: number, scope?: ExpenseScope) {
    // 作用域存在时多取一些再过滤（活动按部门标签隔离；未打标签的旧事件仅 view-all 可见）。
    const records = await this.prisma.systemSetting.findMany({
      where: { category: RECORD_CATEGORIES.event },
      orderBy: { updatedAt: 'desc' },
      take: scope ? Math.max(take * 5, 50) : take,
    });
    let events = records.map((record) => record.value as ExpenseActivity);
    if (scope) events = events.filter((e) => this.recordInScope(e, scope));
    return events.slice(0, take);
  }

  // ── 部门作用域 ────────────────────────────────────────────────────────────
  /** 记录是否落在作用域内（普通用户=本部门；view-all=全部或按 filterDepartment）。 */
  private recordInScope(rec: { department_code?: string | null }, scope: ExpenseScope): boolean {
    const code = rec.department_code ?? null;
    if (scope.hasViewAll) {
      const f = scope.filterDepartment;
      if (!f) return true;
      if (f === UNASSIGNED_DEPT) return !code;
      return code === f;
    }
    if (!scope.departmentCode) return false; // 无部门普通用户：看不到任何数据
    return code === scope.departmentCode;
  }

  private filterByScope<T extends { department_code?: string | null }>(list: T[], scope: ExpenseScope): T[] {
    return list.filter((rec) => this.recordInScope(rec, scope));
  }

  private validateUploadFiles(files: UploadedExpenseFile[], label: string) {
    if (files.length === 0) {
      throw new BadRequestException(`请至少上传一个${label}文件`);
    }
    if (files.length > MAX_UPLOAD_FILES) {
      throw new BadRequestException(`一次最多上传 ${MAX_UPLOAD_FILES} 个文件`);
    }
    for (const file of files) {
      if (!file.buffer || file.buffer.length === 0) {
        throw new BadRequestException(`${file.originalname || label} 内容为空`);
      }
      if (file.buffer.length > MAX_EXPENSE_FILE_SIZE) {
        throw new BadRequestException(`${file.originalname} 超过 10MB 上限`);
      }
      const mimeAccepted =
        !file.mimetype ||
        file.mimetype === 'application/octet-stream' ||
        ALLOWED_EXPENSE_MIME_TYPES.has(file.mimetype.toLowerCase());
      const extensionAccepted = ALLOWED_EXPENSE_FILE_EXTENSIONS.test(file.originalname);
      const contentType = this.detectExpenseFileType(file.buffer);
      const extensionMatchesContent =
        (contentType === 'pdf' && /\.pdf$/i.test(file.originalname)) ||
        (contentType === 'png' && /\.png$/i.test(file.originalname)) ||
        (contentType === 'jpeg' && /\.jpe?g$/i.test(file.originalname)) ||
        (contentType === 'webp' && /\.webp$/i.test(file.originalname));
      if (!mimeAccepted || !extensionAccepted || !contentType || !extensionMatchesContent) {
        throw new BadRequestException(`${file.originalname} 类型不支持，仅允许 PDF、PNG、JPG、JPEG、WebP`);
      }
    }
  }

  private detectExpenseFileType(buffer: Buffer): 'pdf' | 'png' | 'jpeg' | 'webp' | null {
    if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer.subarray(1, 4).toString('ascii') === 'PNG'
    ) return 'png';
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'jpeg';
    }
    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) return 'webp';
    return null;
  }

  /** 写入前置校验：无部门的普通用户禁止录入（避免数据落进自己看不到的桶）。 */
  private assertCanWrite(scope: ExpenseScope) {
    if (!scope.hasViewAll && !scope.departmentCode) {
      throw new ForbiddenException('未设置部门，无法录入费用数据，请联系管理员分配部门');
    }
  }

  /** 新建记录的部门标签（按提交人自身部门归属）。 */
  private ownDeptTag(scope: ExpenseScope): { department_code: string | null; department_name: string | null } {
    return { department_code: scope.departmentCode ?? null, department_name: scope.departmentName ?? null };
  }

  /** 对指定记录做越权拦截：不在作用域内按「不存在」处理，避免泄露其它部门数据的存在性。 */
  private assertRecordInScope(rec: { department_code?: string | null }, scope: ExpenseScope, label = '记录') {
    if (!this.recordInScope(rec, scope)) {
      throw new NotFoundException(`${label}不存在`);
    }
  }

  /** code → 部门名（改派时用，带 5 分钟缓存）。 */
  private deptNameCache: { map: Map<string, string>; at: number } | null = null;
  private async resolveDeptNameByCode(code: string | null): Promise<string | null> {
    if (!code || code === UNASSIGNED_DEPT) return null;
    const now = Date.now();
    if (!this.deptNameCache || now - this.deptNameCache.at > 5 * 60 * 1000) {
      const rows = await this.prisma.department.findMany({ select: { name: true, code: true } });
      this.deptNameCache = { map: new Map(rows.map((r) => [r.code, r.name])), at: now };
    }
    return this.deptNameCache.map.get(code) ?? null;
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

  private async getInvoiceOrThrow(invoiceId: string, scope?: ExpenseScope) {
    const invoice = (await this.ensureInvoices()).find((item) => item.id === invoiceId);
    if (!invoice) {
      throw new NotFoundException('发票不存在');
    }
    if (scope) this.assertRecordInScope(invoice, scope, '发票');
    return invoice;
  }

  private async getReimbursementOrThrow(reimbursementId: string, scope?: ExpenseScope) {
    const reimbursement = (await this.ensureReimbursements()).find((item) => item.id === reimbursementId);
    if (!reimbursement) {
      throw new NotFoundException('报销单不存在');
    }
    if (scope) this.assertRecordInScope(reimbursement, scope, '报销单');
    return reimbursement;
  }

  private reimbursementOperationKey(reimbursementId: string) {
    return `${RECORD_CATEGORIES.reimbursementOperation}:${reimbursementId}`;
  }

  private async acquireReimbursementOperation(reimbursementId: string, operation: string) {
    try {
      await this.prisma.systemSetting.create({
        data: {
          category: RECORD_CATEGORIES.reimbursementOperation,
          key: this.reimbursementOperationKey(reimbursementId),
          description: operation,
          value: {
            reimbursement_id: reimbursementId,
            operation,
            created_at: this.formatDateTime(new Date()),
          },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('该报销单正在处理，请勿重复操作');
      }
      throw error;
    }
  }

  private async releaseReimbursementOperation(reimbursementId: string) {
    await this.prisma.systemSetting.deleteMany({
      where: { key: this.reimbursementOperationKey(reimbursementId) },
    });
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
      // 腾讯 OCR 凭证统一由 OcrService 解析（IntegrationConfig kind=tencent_ocr，env 回退），
      // 与「系统管理 → 腾讯OCR配置」和研发模块共用同一处，避免配置分叉。
      tencent_ocr: await this.ocrService.getTencentConfig(),
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

  private normalizeApprovalControlIds(value: Partial<ApprovalControlIds>) {
    const allowedKeys: Array<keyof ApprovalControlIds> = [
      'title',
      'amount',
      'reason',
      'invoice_count',
      'project',
    ];
    return Object.fromEntries(
      allowedKeys
        .map((key) => [key, typeof value[key] === 'string' ? value[key]!.trim() : ''] as const)
        .filter(([, item]) => item.length > 0),
    ) as Partial<ApprovalControlIds>;
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
    return Boolean(
      config.tencent_ocr.enabled &&
        config.tencent_ocr.secret_id &&
        config.tencent_ocr.secret_key,
    );
  }

  private hasWeComConfig(config: ExpenseIntegrationConfig) {
    return Boolean(
      config.wecom.enabled &&
        config.wecom.corp_id &&
        config.wecom.corp_secret &&
        config.wecom.approval_template_id &&
        config.wecom.default_creator_userid,
    );
  }

  private assertTencentReady(config: ExpenseIntegrationConfig, fields: Array<keyof ExpenseIntegrationConfig['tencent_ocr']>) {
    if (!config.tencent_ocr.enabled) {
      throw new BadRequestException('腾讯 OCR 已停用');
    }
    const missing = this.missingConfigFields(config.tencent_ocr, fields);
    if (missing.length > 0) {
      throw new BadRequestException({
        message: '腾讯 OCR 配置不完整',
        missing: missing.map((key) => `tencent_ocr.${key}`),
      });
    }
  }

  private assertWeComReady(config: ExpenseIntegrationConfig, fields: Array<keyof WeComExpenseConfig>) {
    if (!config.wecom.enabled) {
      throw new BadRequestException('企业微信审批已停用');
    }
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

  /** 票据状态分布（真实统计，按 6 种发票状态聚合张数与金额，供「统计分析」状态分布图使用）。 */
  private buildStatusBreakdown(invoices: ExpenseInvoiceValue[]) {
    const statuses: InvoiceStatus[] = ['待识别', '已识别', '待确认', '已关联', '异常', '已报销'];
    return statuses.map((status) => {
      const matched = invoices.filter((invoice) => invoice.status === status);
      return {
        status,
        count: matched.length,
        amount: matched.reduce((sum, invoice) => sum + invoice.amount, 0),
      };
    });
  }

  /** 近 6 个月的分类金额趋势（真实统计，按发票 issued_date 落桶，无数据的月份为 0）。 */
  private buildMonthlyTrend(invoices: ExpenseInvoiceValue[]) {
    const categories: ExpenseCategory[] = ['差旅', '餐饮', '采购', '办公', '其他'];
    const buckets = Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() - (5 - index));
      return {
        key: this.formatDate(date).slice(0, 7),
        label: `${date.getMonth() + 1}月`,
      };
    });
    return buckets.map(({ key, label }) => {
      const monthInvoices = invoices.filter((invoice) => this.monthKeyOf(invoice.issued_date) === key);
      const row: { month: string } & Record<ExpenseCategory, number> = {
        month: label,
        差旅: 0,
        餐饮: 0,
        采购: 0,
        办公: 0,
        其他: 0,
      };
      categories.forEach((category) => {
        row[category] = monthInvoices
          .filter((invoice) => invoice.category === category)
          .reduce((sum, invoice) => sum + invoice.amount, 0);
      });
      return row;
    });
  }

  /** 将 issued_date 归一化为 YYYY-MM 月桶键（容忍 年月日/斜杠 等分隔符，非法值返回空串）。 */
  private monthKeyOf(issuedDate: string | undefined) {
    if (!issuedDate) return '';
    const normalized = issuedDate.replace(/[年月./]/g, '-');
    const match = normalized.match(/^(\d{4})-(\d{1,2})/);
    if (!match) return '';
    return `${match[1]}-${match[2].padStart(2, '0')}`;
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
