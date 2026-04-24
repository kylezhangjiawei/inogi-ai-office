export class SaveMailConfigDto {
  id?: string;
  email!: string;
  encrypted_secret?: string;
  plain_secret?: string;
  enabled!: boolean;
}
