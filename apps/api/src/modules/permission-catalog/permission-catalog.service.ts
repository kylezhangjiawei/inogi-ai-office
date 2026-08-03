import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { SavePermissionCatalogItemDto } from './dto/save-permission-catalog-item.dto';
import { DEFAULT_PERMISSION_CATALOG } from './permission-catalog.defaults';
import { DEPARTMENT_KB_ID_BY_CODE } from '../research-development/dept-knowledge.constants';

// 映射的唯一事实源在 dept-knowledge.constants，切勿在此另建副本（曾因三处副本产生漂移）

/**
 * 随代码发布的「内置」权限码。这些条目由 ensureDefaults 保证存在，删了会自动回来，
 * 因此不可删除（详见 remove()）。管理员自建的条目不在此列，可以正常删除。
 */
const BUILTIN_CATALOG_CODES: ReadonlySet<string> = new Set(
  DEFAULT_PERMISSION_CATALOG.map((item) => item.code),
);

@Injectable()
export class PermissionCatalogService {
  private readonly logger = new Logger(PermissionCatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listGroups(options: { enabledOnly?: boolean } = {}) {
    await this.ensureDefaults();
    await this.syncDepartmentKnowledgeLabels();
    const items = await this.prisma.permissionCatalogItem.findMany({
      where: options.enabledOnly ? { enabled: true } : undefined,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    const groups = new Map<string, { label: string; permissions: Array<{ code: string; label: string; description?: string; type: string; routePath?: string }> }>();
    for (const item of items) {
      const group = groups.get(item.groupLabel) ?? { label: item.groupLabel, permissions: [] };
      group.permissions.push({
        code: item.code,
        label: item.label,
        description: item.description || undefined,
        type: item.type,
        routePath: item.routePath || undefined,
      });
      groups.set(item.groupLabel, group);
    }

    return [...groups.values()];
  }

  async listItems() {
    await this.ensureDefaults();
    await this.syncDepartmentKnowledgeLabels();
    const items = await this.prisma.permissionCatalogItem.findMany({
      orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
    });
    // builtIn：随代码发布、删了会被 ensureDefaults 补回的条目。前端据此隐藏删除入口，
    // 避免用户点一个必然失败（或看似成功实则复活）的按钮。
    return items.map((item) => ({ ...item, builtIn: BUILTIN_CATALOG_CODES.has(item.code) }));
  }

  async save(payload: SavePermissionCatalogItemDto) {
    await this.ensureDefaults();
    const data = {
      code: payload.code.trim(),
      label: payload.label.trim(),
      description: payload.description?.trim() ?? '',
      groupLabel: payload.groupLabel.trim(),
      type: payload.type,
      routePath: payload.routePath?.trim() ?? '',
      enabled: payload.enabled,
      navHidden: payload.navHidden ?? false,
      sortOrder: payload.sortOrder,
    };

    // 防自锁：停用「页面路由管理」本身会导致没有任何非超管能再打开此页改回来。
    // 超管持 '*' 不受停用影响，仍可救场，但普通管理员会被永久挡在门外，故直接禁止。
    if (data.code === 'page:route-management' && payload.enabled === false) {
      throw new BadRequestException('「页面路由管理」不可停用，否则将无法再进入本页恢复配置');
    }
    await this.assertRoutePathUsable(data.type, data.routePath, payload.id);
    // 停用集合有 5 秒缓存，保存后立即失效，避免管理员改完还要等一会儿才生效
    this.disabledCodesCache = null;

    if (payload.id) {
      return this.prisma.permissionCatalogItem.update({
        where: { id: payload.id },
        data,
      });
    }

    return this.prisma.permissionCatalogItem.create({ data });
  }

  /**
   * 「停用」的权限码集合。
   *
   * 停用语义 = 该权限对所有人失效（页面/接口一律拒绝），而不只是「不再可分配」。
   * 过滤点放在权限解析处（jwt.strategy 与 auth.service 的用户档案映射），因此后端守卫
   * 与前端 /auth/me 自动同时生效，无需逐个守卫改造。
   *
   * 带 5 秒 TTL 缓存：解析在每个请求上发生，不能每次都打库。停用是低频运维动作，
   * 5 秒内的延迟可接受。
   */
  private disabledCodesCache: { at: number; codes: Set<string> } | null = null;
  private static readonly DISABLED_CACHE_TTL_MS = 5_000;

  /**
   * routePath 校验。自「页面路由管理」真正驱动前端路由起，这里就是唯一的防线：
   * 一个笔误足以让整个页面失联（路径不匹配 → 404），或与别的页面撞车互相遮挡。
   *
   * 规则：必须以 / 开头；不得含空格、查询串或哈希；不得使用路径参数（子路由由前端从
   * 主路径派生，参数段不该由管理员配置）；同一路径不得被两个页面占用。
   */
  private async assertRoutePathUsable(type: string, routePath: string, selfId?: string) {
    if (type !== 'page') return; // action 码不对应路由，routePath 无意义
    const path = routePath.trim();
    if (!path) throw new BadRequestException('页面必须填写访问路径');
    if (!path.startsWith('/')) throw new BadRequestException('访问路径必须以 / 开头，例如 /rd-sheet');
    if (/[\s?#]/.test(path)) throw new BadRequestException('访问路径不能包含空格、? 或 #');
    if (path.includes('*')) throw new BadRequestException('访问路径不支持通配符 *');
    /**
     * `:` 参数段是允许的：部分详情页（如 page:purchase-order-detail = /purchase-orders/:id）
     * 本身就有独立权限码，其路径带参数是真实且有意义的登记。
     * ⚠️ 但这类路径**不会**被前端当作派生基准（否则会二次拼接后缀），详情页的实际挂载路径
     * 跟随其列表页主路径 —— 见 App.tsx 对应路由的注释。
     */
    if (path !== '/' && path.endsWith('/')) {
      throw new BadRequestException('访问路径结尾不能有 /');
    }

    const clash = await this.prisma.permissionCatalogItem.findFirst({
      where: {
        routePath: path,
        type: 'page',
        ...(selfId ? { id: { not: selfId } } : {}),
      },
      select: { code: true, label: true },
    });
    if (clash) {
      throw new BadRequestException(
        `访问路径 ${path} 已被「${clash.label}」(${clash.code}) 占用，两个页面不能共用同一路径`,
      );
    }
  }

  async getDisabledCodes(): Promise<Set<string>> {
    const now = Date.now();
    if (
      this.disabledCodesCache &&
      now - this.disabledCodesCache.at < PermissionCatalogService.DISABLED_CACHE_TTL_MS
    ) {
      return this.disabledCodesCache.codes;
    }
    try {
      const items = await this.prisma.permissionCatalogItem.findMany({
        where: { enabled: false },
        select: { code: true },
      });
      const codes = new Set(items.map((item) => item.code));
      this.disabledCodesCache = { at: now, codes };
      return codes;
    } catch (err) {
      // 读不到目录时「不拦截」：宁可放行也不要因目录故障把全站锁死
      this.logger.error(`[getDisabledCodes] failed: ${(err as Error).message}`);
      return this.disabledCodesCache?.codes ?? new Set();
    }
  }

  /**
   * 从用户权限里剔除已停用的码。
   * `*`（超级管理员）不受影响 —— 否则一旦误停用 page:route-management，就没有任何人能改回来。
   */
  async filterDisabled(permissions: string[]): Promise<string[]> {
    if (permissions.includes('*')) return permissions;
    const disabled = await this.getDisabledCodes();
    if (disabled.size === 0) return permissions;
    return permissions.filter((code) => !disabled.has(code));
  }

  /**
   * 导航与路由元数据。任意登录用户可读 —— 前端据此决定「每个页面挂在哪个路径」与
   * 「是否在侧边栏出现」，所以不能限制为管理员，否则普通用户永远只能用内置默认路径，
   * 管理员在页面路由管理里改的路径对他们不生效。
   *
   * 只下发 page 类型：action 码不对应路由。
   */
  async getNavMeta(): Promise<Array<{ code: string; routePath: string; navHidden: boolean }>> {
    await this.ensureDefaults();
    const items = await this.prisma.permissionCatalogItem.findMany({
      where: { type: 'page' },
      select: { code: true, routePath: true, navHidden: true },
    });
    return items.map((item) => ({
      code: item.code,
      routePath: item.routePath ?? '',
      navHidden: item.navHidden,
    }));
  }

  async remove(id: string) {
    await this.ensureDefaults();
    const existing = await this.prisma.permissionCatalogItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('权限目录项不存在');

    /**
     * 内置条目不允许删除。
     *
     * 原因不是"保护"，而是删了根本无效：ensureDefaults() 会在下一次任何列表/保存调用时
     * 把缺失的默认项原样补回来。管理员会看到「删除成功」，刷新后它又回来了——比不让删更困惑。
     * 而且页面组件由代码提供，删掉目录项也不会让路由消失，只会让该页无法再被授权。
     * 需要下线某个页面，请用「停用」——自本次改造起停用是真的对所有人生效的。
     */
    if (BUILTIN_CATALOG_CODES.has(existing.code)) {
      throw new BadRequestException(
        `「${existing.label}」是系统内置页面，删除后会在下次加载时自动恢复，因此不支持删除。如需下线请改用「停用」。`,
      );
    }

    await this.prisma.permissionCatalogItem.delete({ where: { id } });
    this.disabledCodesCache = null;
    return { ok: true };
  }

  /**
   * Ensure all default catalog entries exist in DB.
   *
   * Strategy: find existing codes, only insert the **missing** ones.
   * This way:
   *  - First-time setup: all defaults seeded
   *  - Existing deployments: newly added defaults are auto-synced (e.g. when we
   *    ship a new page, its permission entry shows up after backend restart)
   *  - Admin's manual customizations to existing entries are NOT overwritten
   *
   * Failure tolerance: each item is inserted independently with try-catch.
   * A single bad item (e.g. unique-constraint race, invalid data) will only
   * be logged and skipped — it will NOT crash the entire endpoint. This is
   * critical because `ensureDefaults` runs on every list/save/remove call,
   * so a transaction-wide failure would make the whole permission-catalog
   * page unusable in production.
   */
  async ensureDefaults() {
    let existing: Array<{ code: string }>;
    try {
      existing = await this.prisma.permissionCatalogItem.findMany({
        select: { code: true },
      });
    } catch (err) {
      this.logger.error(
        `[ensureDefaults] failed to query existing codes: ${(err as Error).message}`,
      );
      // If we can't even read, bail out silently — let the caller's own query
      // surface the real DB error rather than masking it here.
      return;
    }

    const existingCodes = new Set(existing.map((row) => row.code));
    const missing = DEFAULT_PERMISSION_CATALOG.filter(
      (item) => !existingCodes.has(item.code),
    );
    if (missing.length === 0) return;

    let okCount = 0;
    let failCount = 0;
    for (const item of missing) {
      try {
        await this.prisma.permissionCatalogItem.upsert({
          where: { code: item.code },
          create: {
            code: item.code,
            label: item.label,
            description: item.description ?? '',
            groupLabel: item.groupLabel,
            type: item.type,
            routePath: item.routePath ?? '',
            enabled: true,
            navHidden: item.navHidden ?? false,
            sortOrder: item.sortOrder,
          },
          // Do NOT overwrite admin's manual customizations on existing rows.
          // upsert is used purely for race-condition safety (two requests
          // both seeing the code as "missing" and both trying to insert).
          update: {},
        });
        okCount += 1;
      } catch (err) {
        failCount += 1;
        this.logger.warn(
          `[ensureDefaults] failed to seed code="${item.code}" label="${item.label}": ${(err as Error).message}`,
        );
      }
    }

    if (failCount > 0) {
      this.logger.warn(
        `[ensureDefaults] seeding done: ${okCount} ok, ${failCount} failed (see warnings above)`,
      );
    } else if (okCount > 0) {
      this.logger.log(`[ensureDefaults] seeded ${okCount} new permission(s)`);
    }
  }

  private async syncDepartmentKnowledgeLabels() {
    const departments = await this.prisma.department.findMany({
      where: { code: { in: Object.keys(DEPARTMENT_KB_ID_BY_CODE) } },
      select: { code: true, name: true },
    });
    await Promise.all(
      departments.map((department) => {
        const kbId = DEPARTMENT_KB_ID_BY_CODE[department.code];
        return this.prisma.permissionCatalogItem.updateMany({
          where: { code: `page:dept-kb-${kbId}` },
          data: {
            label: `${department.name}知识库`,
            description: `${department.name}知识沉淀与分级查阅`,
          },
        });
      }),
    );
  }
}
