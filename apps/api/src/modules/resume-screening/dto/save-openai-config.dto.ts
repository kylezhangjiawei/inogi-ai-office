export class SaveOpenAiConfigDto {
  id?: string;
  name!: string;
  model!: string;
  encrypted_secret?: string;
  plain_secret?: string;
  enabled!: boolean;
}
