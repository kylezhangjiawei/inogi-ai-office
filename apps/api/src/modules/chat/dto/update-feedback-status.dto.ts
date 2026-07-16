import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateFeedbackStatusDto {
  @IsIn(['open', 'in_progress', 'resolved', 'ignored'])
  status!: 'open' | 'in_progress' | 'resolved' | 'ignored';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  resolutionNote?: string;
}
