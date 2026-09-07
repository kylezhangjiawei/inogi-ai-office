import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const USER_STATUSES = ['ACTIVE', 'INVITED', 'DISABLED'] as const;

export class SaveUserDto {
  @IsOptional()
  @IsString({ message: '用户 ID 必须为文本' })
  id?: string;

  @IsString({ message: '姓名必须为文本' })
  @MinLength(1, { message: '姓名不能为空' })
  @MaxLength(80, { message: '姓名不能超过 80 个字符' })
  name!: string;

  @IsOptional()
  @IsString({ message: '英文名必须为文本' })
  @MaxLength(80, { message: '英文名不能超过 80 个字符' })
  englishName?: string;

  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确，请输入有效邮箱' })
  email?: string;

  @IsOptional()
  @IsString({ message: '用户名必须为文本' })
  @MaxLength(80, { message: '用户名不能超过 80 个字符' })
  username?: string;

  @IsOptional()
  @IsString({ message: '部门必须为文本' })
  @MaxLength(80, { message: '部门不能超过 80 个字符' })
  department?: string;

  @IsOptional()
  @IsString({ message: '角色 ID 必须为文本' })
  roleId?: string;

  @IsOptional()
  @IsIn(USER_STATUSES, { message: '用户状态无效，请重新选择' })
  status?: (typeof USER_STATUSES)[number];

  /** 仅新建时使用，用于设置初始密码 */
  @IsOptional()
  @IsString({ message: '密码必须为文本' })
  @MinLength(8, { message: '密码至少需要 8 个字符' })
  password?: string;
}
