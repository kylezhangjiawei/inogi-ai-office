import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

// Only low-risk UI actions are accepted from the browser. Regeneration and
// feedback are recorded by the server after ownership/business validation.
const CLIENT_EVENT_TYPES = ['chat_open', 'copy', 'share'] as const;

export class CreateUsageEventDto {
  @IsIn(CLIENT_EVENT_TYPES)
  eventType!: (typeof CLIENT_EVENT_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  messageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, string | number | boolean | null>;
}
