import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateExpenseReimbursementDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  applicant?: string;

  @IsOptional()
  @IsString()
  project?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsArray()
  @IsString({ each: true })
  invoice_ids!: string[];

  @IsOptional()
  @IsString()
  wecom_creator_userid?: string;
}
