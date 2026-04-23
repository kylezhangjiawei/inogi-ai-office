export class SaveMailConfigDto {
  id?: string;
  email!: string;
  encrypted_secret?: string;
  enabled!: boolean;
}
