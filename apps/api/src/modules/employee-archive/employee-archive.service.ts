import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { OssService } from '../oss/oss.service';
import { SIGNED_URL_TTL_SECONDS } from '../oss/oss.constants';
import {
  BulkImportEmployeeArchivesDto,
  EmployeeArchiveDocumentDto,
  ListEmployeeArchivesQueryDto,
  SaveEmployeeBadgeConfigDto,
  SaveEmployeeArchiveDto,
} from './dto/employee-archive.dto';

const employeeInclude = {
  documents: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.EmployeeArchiveInclude;

type EmployeeWithDocuments = Prisma.EmployeeArchiveGetPayload<{ include: typeof employeeInclude }>;

@Injectable()
export class EmployeeArchiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ossService: OssService,
  ) {}

  async list(query: ListEmployeeArchivesQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const where: Prisma.EmployeeArchiveWhereInput = {
      ...(query.company ? { company: query.company } : {}),
      ...(query.department ? { department: query.department } : {}),
      ...(query.archiveStatus ? { archiveStatus: query.archiveStatus } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { rosterNo: { contains: search, mode: 'insensitive' } },
              { company: { contains: search, mode: 'insensitive' } },
              { department: { contains: search, mode: 'insensitive' } },
              { title: { contains: search, mode: 'insensitive' } },
              { workLocation: { contains: search, mode: 'insensitive' } },
              { costCenter: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.employeeArchive.findMany({
        where,
        include: employeeInclude,
        orderBy: [{ hireDate: 'desc' }, { rosterNo: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.employeeArchive.count({ where }),
    ]);

    return { items: items.map((item) => this.serialize(item)), total, page, pageSize };
  }

  async get(id: string) {
    const employee = await this.prisma.employeeArchive.findUnique({
      where: { id },
      include: employeeInclude,
    });
    if (!employee) throw new NotFoundException('员工归档不存在');
    return this.serialize(employee);
  }

  async stats() {
    const records = await this.prisma.employeeArchive.findMany({
      select: { archiveStatus: true, missingFields: true },
    });
    const counts = records.reduce<Record<string, number>>((result, record) => {
      result[record.archiveStatus] = (result[record.archiveStatus] ?? 0) + 1;
      return result;
    }, {});
    return {
      total: records.length,
      complete: counts.complete ?? 0,
      review: counts.review ?? 0,
      missing: counts.missing ?? 0,
      onboarding: counts.onboarding ?? 0,
      pending: (counts.review ?? 0) + (counts.missing ?? 0) + (counts.onboarding ?? 0),
      missingFieldCount: records.reduce((sum, record) => sum + record.missingFields.length, 0),
    };
  }

  async probationReminders(days: number) {
    const employees = await this.prisma.employeeArchive.findMany({
      where: { employmentStatus: { contains: '试用' }, hireDate: { not: null } },
      include: employeeInclude,
      orderBy: { hireDate: 'asc' },
    });
    const reminders = employees
      .map((employee) => {
        const reminder = this.buildProbationReminder(employee.hireDate);
        return reminder ? { employee: this.serialize(employee), ...reminder } : null;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => item.phase !== 'upcoming' || item.daysUntilConversion <= days);
    return { items: reminders, total: reminders.length, windowDays: days };
  }

  async create(dto: SaveEmployeeArchiveDto, actorId: string) {
    const payload = this.buildPersistenceData(dto);
    try {
      const employee = await this.prisma.employeeArchive.create({
        data: {
          ...(dto.id ? { id: dto.id } : {}),
          ...payload.data,
          createdById: actorId,
          updatedById: actorId,
          documents: { create: payload.documents },
        },
        include: employeeInclude,
      });
      return this.serialize(employee);
    } catch (error) {
      this.rethrowKnownPrismaError(error);
    }
  }

  async update(id: string, dto: SaveEmployeeArchiveDto, actorId: string) {
    await this.assertExists(id);
    const payload = this.buildPersistenceData(dto);
    try {
      const employee = await this.prisma.employeeArchive.update({
        where: { id },
        data: {
          ...payload.data,
          updatedById: actorId,
          documents: { deleteMany: {}, create: payload.documents },
        },
        include: employeeInclude,
      });
      return this.serialize(employee);
    } catch (error) {
      this.rethrowKnownPrismaError(error);
    }
  }

  async bulkImport(dto: BulkImportEmployeeArchivesDto, actorId: string) {
    if (dto.items.length === 0) throw new BadRequestException('导入数据不能为空');
    const rosterNos = dto.items.map((item) => item.rosterNo.trim());
    if (new Set(rosterNos).size !== rosterNos.length) {
      throw new BadRequestException('导入数据中存在重复序号');
    }

    const removedBadgeFileIds = dto.replace
      ? (await this.prisma.employeeArchive.findMany({
          where: { rosterNo: { notIn: rosterNos } },
          select: { badgeConfig: true },
        }))
          .map((employee) => this.getBadgeAvatarFileId(employee.badgeConfig))
          .filter((fileId): fileId is string => Boolean(fileId))
      : [];
    try {
      await this.prisma.$transaction(async (tx) => {
        if (dto.replace) {
          await tx.employeeArchive.deleteMany({ where: { rosterNo: { notIn: rosterNos } } });
        }
        for (const item of dto.items) {
          const payload = this.buildPersistenceData(item);
          await tx.employeeArchive.upsert({
            where: { rosterNo: item.rosterNo.trim() },
            create: {
              ...(item.id ? { id: item.id } : {}),
              ...payload.data,
              createdById: actorId,
              updatedById: actorId,
              documents: { create: payload.documents },
            },
            update: {
              ...payload.data,
              updatedById: actorId,
              documents: { deleteMany: {}, create: payload.documents },
            },
          });
        }
      });
    } catch (error) {
      this.rethrowKnownPrismaError(error);
    }

    await Promise.all(removedBadgeFileIds.map((fileId) => this.cleanupBadgeFile(fileId)));

    const result = await this.list({ page: 1, pageSize: 1000 });
    return { ...result, imported: dto.items.length, replaced: Boolean(dto.replace) };
  }

  async remove(id: string) {
    const employee = await this.prisma.employeeArchive.findUnique({
      where: { id },
      select: { badgeConfig: true },
    });
    if (!employee) throw new NotFoundException('员工归档不存在');
    const badgeFileId = this.getBadgeAvatarFileId(employee.badgeConfig);
    await this.prisma.employeeArchive.delete({ where: { id } });
    if (badgeFileId) await this.cleanupBadgeFile(badgeFileId);
    return { success: true, id };
  }

  async getBadgeConfig(id: string) {
    const employee = await this.prisma.employeeArchive.findUnique({
      where: { id },
      select: { badgeConfig: true },
    });
    if (!employee) throw new NotFoundException('员工归档不存在');
    return this.hydrateBadgeConfig(employee.badgeConfig);
  }

  async saveBadgeConfig(id: string, dto: SaveEmployeeBadgeConfigDto, actorId: string) {
    const existing = await this.prisma.employeeArchive.findUnique({
      where: { id },
      select: { badgeConfig: true },
    });
    if (!existing) throw new NotFoundException('员工归档不存在');
    const previousAvatarFileId = this.getBadgeAvatarFileId(existing.badgeConfig);
    const avatar = dto.avatar ? { ...dto.avatar } : null;
    if (avatar) {
      delete avatar.signedUrl;
      const fileId = typeof avatar.fileId === 'string' ? avatar.fileId : '';
      if (fileId) {
        const file = await this.prisma.fileAsset.findFirst({
          where: {
            id: fileId,
            status: 'active',
            businessType: 'employee-archive/badge-avatar',
            businessId: id,
          },
          select: { id: true },
        });
        if (!file) throw new BadRequestException('胸牌头像文件无效或不属于当前员工');
      }
    }

    const badgeConfig = {
      templateKey: dto.templateKey,
      positions: dto.positions,
      positionConfirmed: dto.positionConfirmed,
      textVisibility: dto.textVisibility,
      avatar,
    } as Prisma.InputJsonValue;
    const employee = await this.prisma.employeeArchive.update({
      where: { id },
      data: { badgeConfig, updatedById: actorId },
      select: { badgeConfig: true },
    });
    const nextAvatarFileId = this.getBadgeAvatarFileId(employee.badgeConfig);
    if (previousAvatarFileId && previousAvatarFileId !== nextAvatarFileId) {
      await this.cleanupBadgeFile(previousAvatarFileId);
    }
    return this.hydrateBadgeConfig(employee.badgeConfig);
  }

  private async assertExists(id: string) {
    const employee = await this.prisma.employeeArchive.findUnique({ where: { id }, select: { id: true } });
    if (!employee) throw new NotFoundException('员工归档不存在');
  }

  private buildPersistenceData(dto: SaveEmployeeArchiveDto) {
    const rawIdentityNumber = this.clean(dto.identityNumber) ||
      (dto.idNoMasked && !dto.idNoMasked.includes('*') ? dto.idNoMasked.trim() : '');
    const identity = rawIdentityNumber ? this.parseChineseIdentityNumber(rawIdentityNumber) : null;
    const birthDate = identity?.birthDate ?? this.normalizeDate(dto.birthDate);
    const birthMonthDay = birthDate ? birthDate.slice(5) : this.clean(dto.birthMonthDay);
    const derivedAge = birthDate ? this.ageFromDate(birthDate) : (dto.age ?? 0);
    const data = {
      rosterNo: dto.rosterNo.trim(),
      company: this.clean(dto.company),
      hireDate: this.toDate(dto.hireDate),
      tenure: this.clean(dto.tenure),
      employmentStatus: this.clean(dto.status),
      workLocation: this.clean(dto.workLocation),
      department: this.clean(dto.department),
      title: this.clean(dto.title),
      name: dto.name.trim(),
      idNoMasked: identity?.masked ?? this.clean(dto.idNoMasked),
      birthDate: this.toDate(birthDate),
      birthMonthDay,
      zodiac: birthDate ? this.zodiacFromDate(birthDate) : this.clean(dto.zodiac),
      constellation: birthDate ? this.constellationFromDate(birthDate) : this.clean(dto.constellation),
      gender: identity?.gender ?? this.clean(dto.gender),
      age: derivedAge,
      ethnicity: this.clean(dto.ethnicity),
      maritalStatus: this.clean(dto.maritalStatus),
      phoneMasked: dto.phoneNumber ? this.maskPhone(dto.phoneNumber) : this.clean(dto.phoneMasked),
      bankAccountMasked: dto.bankAccount ? this.maskBankAccount(dto.bankAccount) : this.clean(dto.bankAccountMasked),
      bankBranch: this.clean(dto.bankBranch),
      education: this.clean(dto.education),
      school: this.clean(dto.school),
      major: this.clean(dto.major),
      hometown: this.clean(dto.hometown),
      registeredAddress: this.clean(dto.registeredAddress),
      currentAddress: this.clean(dto.currentAddress),
      emergencyContact: this.clean(dto.emergencyContact),
      emergencyRelation: this.clean(dto.emergencyRelation),
      emergencyPhoneMasked: dto.emergencyPhoneNumber
        ? this.maskPhone(dto.emergencyPhoneNumber)
        : this.clean(dto.emergencyPhoneMasked),
      socialSecurityNo: dto.socialSecurityNumber
        ? this.maskMiddle(dto.socialSecurityNumber, 2, 3)
        : this.clean(dto.socialSecurityNo),
      socialSecurityFirstMonth: this.clean(dto.socialSecurityFirstMonth),
      note: this.clean(dto.note),
      costCenter: this.clean(dto.costCenter),
      archiveStatus: dto.archiveStatus ?? 'onboarding',
      archiveScore: dto.archiveScore ?? 0,
      missingFields: dto.missingFields ?? [],
      alerts: dto.alerts ?? [],
      source: this.clean(dto.source) || 'manual',
    } satisfies Prisma.EmployeeArchiveUncheckedCreateInput;

    const requiredFields: Array<[string, string | number]> = [
      ['序号', data.rosterNo], ['隶属', data.company], ['入职日期', this.formatDate(data.hireDate)],
      ['工龄', data.tenure], ['状态', data.employmentStatus], ['工作地', data.workLocation],
      ['部门', data.department], ['职务', data.title], ['姓名', data.name], ['证件号码', data.idNoMasked],
      ['出生日期', this.formatDate(data.birthDate)], ['出生月日', data.birthMonthDay], ['生肖', data.zodiac],
      ['星座', data.constellation], ['性别', data.gender], ['年龄', data.age], ['民族', data.ethnicity],
      ['婚姻状况', data.maritalStatus], ['手机号码', data.phoneMasked], ['银行帐号', data.bankAccountMasked],
      ['工资卡开户行全称', data.bankBranch], ['学历', data.education], ['毕业院校', data.school],
      ['专业', data.major], ['籍贯', data.hometown], ['户籍地址', data.registeredAddress],
      ['常住地址', data.currentAddress], ['紧急联系人姓名', data.emergencyContact],
      ['紧急联系人关系', data.emergencyRelation], ['紧急联系人手机', data.emergencyPhoneMasked],
      ['社保号', data.socialSecurityNo], ['社保首月日期', data.socialSecurityFirstMonth],
      ['费用归属', data.costCenter],
    ];
    data.missingFields = requiredFields
      .filter(([, value]) => this.isIncompleteValue(value))
      .map(([label]) => label);
    data.archiveScore = Math.round(((requiredFields.length - data.missingFields.length) / requiredFields.length) * 100);
    data.archiveStatus = data.missingFields.length === 0
      ? 'complete'
      : /入职|待入职/.test(data.employmentStatus)
        ? 'onboarding'
        : /试用/.test(data.employmentStatus)
          ? 'review'
          : 'missing';

    return { data, documents: this.buildDocuments(dto.docs ?? []) };
  }

  private buildDocuments(documents: EmployeeArchiveDocumentDto[]) {
    return documents.map((document, sortOrder) => ({
      title: document.title.trim(),
      source: this.clean(document.source),
      status: document.status ?? 'review',
      detail: this.clean(document.detail),
      documentDate: this.toDate(document.updatedAt),
      sortOrder,
    }));
  }

  private async hydrateBadgeConfig(value: Prisma.JsonValue) {
    const config = value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
    const avatar = config.avatar && typeof config.avatar === 'object' && !Array.isArray(config.avatar)
      ? { ...(config.avatar as Record<string, unknown>) }
      : null;
    const fileId = avatar && typeof avatar.fileId === 'string' ? avatar.fileId : '';
    if (!fileId) return { ...config, avatar };

    const file = await this.prisma.fileAsset.findFirst({
      where: { id: fileId, status: 'active' },
      select: { objectKey: true },
    });
    const signedUrl = file
      ? this.ossService.getSignedUrl(file.objectKey, SIGNED_URL_TTL_SECONDS.DOCUMENT)
      : null;
    return { ...config, avatar: { ...avatar, signedUrl } };
  }

  private getBadgeAvatarFileId(value: Prisma.JsonValue) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const avatar = (value as Record<string, unknown>).avatar;
    if (!avatar || typeof avatar !== 'object' || Array.isArray(avatar)) return '';
    const fileId = (avatar as Record<string, unknown>).fileId;
    return typeof fileId === 'string' ? fileId : '';
  }

  private async cleanupBadgeFile(fileId: string) {
    const file = await this.prisma.fileAsset.findFirst({
      where: { id: fileId, status: 'active' },
      select: { objectKey: true },
    });
    if (!file) return;
    try {
      await this.ossService.deleteObject(file.objectKey);
    } catch {
      // 数据删除不能被对象存储的临时故障阻塞，FileAsset 仍标记为已删除。
    }
    await this.prisma.fileAsset.updateMany({
      where: { id: fileId, status: 'active' },
      data: { status: 'deleted', deletedAt: new Date() },
    });
  }

  private serialize(employee: EmployeeWithDocuments) {
    return {
      id: employee.id,
      rosterNo: employee.rosterNo,
      company: employee.company,
      hireDate: this.formatDate(employee.hireDate),
      tenure: employee.tenure,
      status: employee.employmentStatus,
      workLocation: employee.workLocation,
      department: employee.department,
      title: employee.title,
      name: employee.name,
      idNoMasked: employee.idNoMasked,
      birthDate: this.formatDate(employee.birthDate),
      birthMonthDay: employee.birthMonthDay,
      zodiac: employee.zodiac,
      constellation: employee.constellation,
      gender: employee.gender,
      age: employee.age,
      ethnicity: employee.ethnicity,
      maritalStatus: employee.maritalStatus,
      phoneMasked: employee.phoneMasked,
      bankAccountMasked: employee.bankAccountMasked,
      bankBranch: employee.bankBranch,
      education: employee.education,
      school: employee.school,
      major: employee.major,
      hometown: employee.hometown,
      registeredAddress: employee.registeredAddress,
      currentAddress: employee.currentAddress,
      emergencyContact: employee.emergencyContact,
      emergencyRelation: employee.emergencyRelation,
      emergencyPhoneMasked: employee.emergencyPhoneMasked,
      socialSecurityNo: employee.socialSecurityNo,
      socialSecurityFirstMonth: employee.socialSecurityFirstMonth,
      note: employee.note,
      costCenter: employee.costCenter,
      archiveStatus: employee.archiveStatus,
      archiveScore: employee.archiveScore,
      missingFields: employee.missingFields,
      alerts: employee.alerts,
      badgeConfig: employee.badgeConfig,
      source: employee.source,
      docs: employee.documents.map((document) => ({
        title: document.title,
        source: document.source,
        status: document.status,
        detail: document.detail,
        updatedAt: this.formatDate(document.documentDate),
      })),
      probationReminder:
        employee.employmentStatus.includes('试用') && employee.hireDate
          ? this.buildProbationReminder(employee.hireDate)
          : null,
      createdAt: employee.createdAt.toISOString(),
      updatedAt: employee.updatedAt.toISOString(),
    };
  }

  private parseChineseIdentityNumber(value: string) {
    const normalized = value.replace(/\s+/g, '').toUpperCase();
    let full = normalized;
    if (/^\d{15}$/.test(normalized)) {
      full = `${normalized.slice(0, 6)}19${normalized.slice(6)}`;
    } else if (!/^\d{17}[\dX]$/.test(normalized)) {
      throw new BadRequestException('身份证号码格式不正确');
    }

    if (full.length === 18 && normalized.length === 18 && !this.hasValidIdentityChecksum(full)) {
      throw new BadRequestException('身份证号码校验位不正确');
    }
    const birthDate = this.normalizeDate(`${full.slice(6, 10)}-${full.slice(10, 12)}-${full.slice(12, 14)}`);
    if (!birthDate) throw new BadRequestException('身份证号码中的出生日期不正确');
    const sequence = Number(full.slice(14, 17));
    return {
      birthDate,
      gender: sequence % 2 === 1 ? '男' : '女',
      masked: `${normalized.slice(0, 3)}${'*'.repeat(normalized.length - 7)}${normalized.slice(-4)}`,
    };
  }

  private hasValidIdentityChecksum(value: string) {
    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const codes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
    const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
    return codes[sum % 11] === value[17];
  }

  private constellationFromDate(value: string) {
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const boundaries = [20, 19, 21, 20, 21, 22, 23, 23, 23, 24, 23, 22];
    const names = ['摩羯座', '水瓶座', '双鱼座', '白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座', '天秤座', '天蝎座', '射手座', '摩羯座'];
    return day < boundaries[month - 1] ? names[month - 1] : names[month];
  }

  private zodiacFromDate(value: string) {
    const date = this.toDate(value);
    if (!date) return '';
    try {
      const yearName = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { year: 'numeric', timeZone: 'UTC' })
        .formatToParts(date)
        .find((part) => (part.type as string) === 'yearName')?.value;
      const zodiacByBranch: Record<string, string> = {
        子: '鼠', 丑: '牛', 寅: '虎', 卯: '兔', 辰: '龙', 巳: '蛇',
        午: '马', 未: '羊', 申: '猴', 酉: '鸡', 戌: '狗', 亥: '猪',
      };
      const zodiac = zodiacByBranch[yearName?.slice(-1) ?? ''];
      if (zodiac) return zodiac;
    } catch {
      // 运行时不支持农历日历时使用公历年份兜底。
    }
    const names = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
    return names[(Number(value.slice(0, 4)) - 4) % 12];
  }

  private ageFromDate(value: string) {
    const birth = this.toDate(value);
    if (!birth) return 0;
    const today = new Date();
    let age = today.getUTCFullYear() - birth.getUTCFullYear();
    const hasNotHadBirthday =
      today.getUTCMonth() < birth.getUTCMonth() ||
      (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate());
    if (hasNotHadBirthday) age -= 1;
    return Math.max(0, age);
  }

  private buildProbationReminder(hireDate: Date | null) {
    if (!hireDate) return null;
    const conversionDate = this.addUtcMonthsClamped(hireDate, 3);
    const reminderDate = this.addUtcMonthsClamped(conversionDate, -1);
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const conversionUtc = Date.UTC(
      conversionDate.getUTCFullYear(),
      conversionDate.getUTCMonth(),
      conversionDate.getUTCDate(),
    );
    const daysUntilConversion = Math.ceil((conversionUtc - todayUtc) / 86_400_000);
    const phase = todayUtc > conversionUtc ? 'overdue' : todayUtc >= reminderDate.getTime() ? 'active' : 'upcoming';
    return {
      conversionDate: this.formatDate(conversionDate),
      reminderDate: this.formatDate(reminderDate),
      daysUntilConversion,
      phase,
    };
  }

  private addUtcMonthsClamped(value: Date, months: number) {
    const day = value.getUTCDate();
    const target = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, lastDay));
    return target;
  }

  private normalizeDate(value?: string) {
    const match = value?.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1]) &&
      date.getUTCMonth() === Number(match[2]) - 1 &&
      date.getUTCDate() === Number(match[3])
      ? value!.trim()
      : '';
  }

  private toDate(value?: string) {
    const normalized = this.normalizeDate(value);
    return normalized ? new Date(`${normalized}T00:00:00.000Z`) : null;
  }

  private formatDate(value: Date | null) {
    return value ? value.toISOString().slice(0, 10) : '';
  }

  private clean(value?: string) {
    return value?.trim() ?? '';
  }

  private isIncompleteValue(value: string | number) {
    const normalized = String(value ?? '').trim();
    return !normalized || normalized === '0' || /^(待补充|待确认|未填写|缺失|-|—)$/.test(normalized);
  }

  private maskPhone(value: string) {
    const normalized = value.replace(/\s+/g, '');
    if (normalized.includes('*')) return normalized;
    return normalized.length >= 7
      ? `${normalized.slice(0, 3)}****${normalized.slice(-4)}`
      : this.maskMiddle(normalized, 1, 1);
  }

  private maskBankAccount(value: string) {
    const normalized = value.replace(/[\s-]+/g, '');
    if (normalized.includes('*')) return normalized;
    return normalized.length >= 4 ? `**** **** ${normalized.slice(-4)}` : this.maskMiddle(normalized, 1, 1);
  }

  private maskMiddle(value: string, head: number, tail: number) {
    const normalized = value.trim();
    if (!normalized || normalized.includes('*')) return normalized;
    if (normalized.length <= head + tail) return '*'.repeat(normalized.length);
    return `${normalized.slice(0, head)}${'*'.repeat(normalized.length - head - tail)}${normalized.slice(-tail)}`;
  }

  private rethrowKnownPrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('员工序号已存在');
    }
    throw error;
  }
}
