import { IsArray, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateExpenseInvoiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  invoice_no?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  invoice_code?: string;

  @IsOptional()
  @IsString()
  issued_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  vendor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  vendor_tax_no?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsNumber()
  tax?: number;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  project?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  material_missing?: string[];
}
