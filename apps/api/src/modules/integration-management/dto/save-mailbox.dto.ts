import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class SaveMailboxDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsOptional()
  @IsString()
  encrypted_secret?: string;

  @IsBoolean()
  enabled!: boolean;
}
