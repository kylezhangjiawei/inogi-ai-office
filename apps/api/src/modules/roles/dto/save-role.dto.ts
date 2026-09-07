import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SaveRoleDto {
  @IsOptional()
  @IsString({ message: '角色标识无效，请刷新列表后重试' })
  id?: string;

  @IsString({ message: '角色名称必须是文本' })
  @MinLength(1, { message: '角色名称不能为空' })
  @MaxLength(80, { message: '角色名称不能超过 80 个字符' })
  name!: string;

  @IsOptional()
  @IsString({ message: '角色说明必须是文本' })
  @MaxLength(240, { message: '角色说明不能超过 240 个字符' })
  description?: string;

  @IsArray({ message: '权限配置无效，请重新选择' })
  @IsString({ each: true, message: '权限项必须是字符串' })
  permissions!: string[];
}
