import { IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class SaveCostGateDto {
  @IsIn(['off', 'threshold', 'always'])
  mode: 'off' | 'threshold' | 'always';

  /** 自动放行阈值（元） */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  autoThresholdYuan?: number;

  /** 预算上限（元）；<=0 或不传视为不设上限 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000000)
  budgetCapYuan?: number | null;
}
