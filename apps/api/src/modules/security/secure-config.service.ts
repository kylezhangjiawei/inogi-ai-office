import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  privateDecrypt,
  randomBytes,
} from 'crypto';

@Injectable()
export class SecureConfigService {
  private readonly privateKey: string;
  private readonly publicKey: string;
  private readonly persistenceKey: Buffer;

  constructor(configService: ConfigService) {
    const keyPair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    this.publicKey = keyPair.publicKey;
    this.privateKey = keyPair.privateKey;

    const secretSource =
      configService.get<string>('CONFIG_ENCRYPTION_SECRET') ??
      'inogi-api-local-config-encryption-secret';
    this.persistenceKey = createHash('sha256').update(secretSource).digest();
  }

  getPublicKey() {
    return this.publicKey;
  }

  decryptTransportValue(encryptedValue: string): string {
    const decrypted = privateDecrypt(
      { key: this.privateKey, oaepHash: 'sha256' },
      Buffer.from(encryptedValue, 'base64'),
    );
    return decrypted.toString('utf8');
  }

  encryptForStorage(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.persistenceKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return JSON.stringify({
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      content: encrypted.toString('base64'),
    });
  }

  decryptFromStorage(payload: string): string {
    const parsed = JSON.parse(payload) as { iv: string; authTag: string; content: string };
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.persistenceKey,
      Buffer.from(parsed.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(parsed.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.content, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
