import { IsString } from 'class-validator';

export class LinkExpenseVoucherDto {
  @IsString()
  voucher_id!: string;
}
