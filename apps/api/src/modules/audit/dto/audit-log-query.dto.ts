import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AuditLogQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(100)
  pageSize?: number;

  /** 模块归属（rd / us-collab / procurement / auth / ...）。取值是数据里实际出现过的 module，不做白名单。 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Transform(trimmed)
  module?: string;

  /** 记录来源：web=页面业务操作，api=拦截器抓到的写请求，ai=智能体代执行，system=后台任务。 */
  @IsOptional()
  @IsIn(['web', 'api', 'ai', 'system'])
  @Transform(trimmed)
  source?: string;

  /**
   * 动作码逗号列表。类目（任务/立项/审批流…）→ 动作码的映射是前端 AUDIT_ACTION_META 的一部分，
   * 后端不复制这张表，只按前端展开后的列表做 IN 过滤 —— 映射保持单一事实源。
   */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  @Transform(trimmed)
  actions?: string;

  /** 资源类型（task / proposal / flow / ...），对拦截器留痕是 URL 首段。 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Transform(trimmed)
  resource?: string;

  /** 只看某个具体对象的留痕（详情面板的「同对象记录」用）。 */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Transform(trimmed)
  resourceId?: string;

  /** 只看某个人的操作。无权看全部的用户传了也无效——可见范围在服务层收口。 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Transform(trimmed)
  actorUserId?: string;

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trimmed)
  keyword?: string;

  @IsOptional()
  @IsIn(['newest', 'oldest'])
  sort?: 'newest' | 'oldest';

  /**
   * 调用方手上那份统计是基于哪个筛选指纹算出来的。
   * 与服务端当前指纹一致就跳过统计（翻页场景），不一致或没传则重算。
   * 指纹由服务端生成，调用方只负责原样回带——前端不必自己推导「筛选条件变了没有」。
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  statsSignature?: string;

  /** 翻页快照时刻：分页期间新写入的留痕不挤动页码，与采购留痕页原有行为一致。 */
  @IsOptional()
  @IsISO8601()
  snapshotAt?: string;
}
