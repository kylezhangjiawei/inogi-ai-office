import { IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

// 查询长度上限：embedding API 单次最多吃 2000 字，UI 端再多没意义；
// 留到 4000 是给"粘贴大段日志查找"留余地，超过就报 400。
const QUERY_MAX_LENGTH = 4000;

export class RagSearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(QUERY_MAX_LENGTH)
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  topK?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourceTypes?: string[];
}

export class RagChatDto {
  @IsString()
  @MinLength(1)
  @MaxLength(QUERY_MAX_LENGTH)
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  topK?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourceTypes?: string[];
}
