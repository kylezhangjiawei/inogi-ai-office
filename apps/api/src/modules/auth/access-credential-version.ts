import { createHmac } from 'crypto';

/** Bind access tokens to the current credential without putting its hash in the JWT. */
export function createAccessCredentialVersion(secret: string, userId: string, passwordHash: string | null): string {
  return createHmac('sha256', secret)
    .update(JSON.stringify(['inogi/access-credential/v1', userId, passwordHash]))
    .digest('hex');
}
