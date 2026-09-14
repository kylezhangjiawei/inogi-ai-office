import { IsInt, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class SavePurchaseOrderAvailabilityDto {
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  availableDate!: string | null;

  @IsString()
  @MaxLength(1000)
  note!: string;

  @IsInt()
  @Min(0)
  @Max(2147483646)
  expectedVersion!: number;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  expectedSourceUpdatedAt!: string;
}
