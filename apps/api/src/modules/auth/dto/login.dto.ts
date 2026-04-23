import { IsString, MinLength, ValidateIf } from 'class-validator';

export class LoginDto {
  @IsString()
  account!: string;

  @ValidateIf((payload: LoginDto) => !payload.encryptedPassword)
  @IsString()
  @MinLength(6)
  password?: string;

  @ValidateIf((payload: LoginDto) => !payload.password)
  @IsString()
  @MinLength(32)
  encryptedPassword?: string;
}
