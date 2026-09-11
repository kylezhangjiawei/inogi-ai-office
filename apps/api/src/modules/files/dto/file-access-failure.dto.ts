import { IsIn, IsInt, Max, Min, ValidateIf } from 'class-validator';

export class FileAccessFailureDto {
  @IsIn(['load', 'renew', 'download'])
  stage!: 'load' | 'renew' | 'download';

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(100)
  @Max(599)
  status?: number;
}
