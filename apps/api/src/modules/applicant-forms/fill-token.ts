import { UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

export interface FillClaims {
  aud: 'applicant-form-fill'; templateId: string; versionId: string; sessionId: string; iat: number; exp: number;
}
export const FILL_LIFETIME_SECONDS = 24 * 60 * 60;
export function issueFillToken(claims: FillClaims, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(`applicant-form-fill:${encoded}`).digest('base64url')}`;
}
export function verifyFillToken(token: unknown, secret: string, now = Date.now()): FillClaims {
  const fail = () => new UnauthorizedException('填写凭证无效或已过期，请重新打开登记链接');
  if (typeof token !== 'string' || token.length > 2048) throw fail();
  const parts = token.split('.');
  if (parts.length !== 2 || !parts.every((v) => /^[A-Za-z0-9_-]+$/.test(v))) throw fail();
  const expected = createHmac('sha256', secret).update(`applicant-form-fill:${parts[0]}`).digest();
  const actual = Buffer.from(parts[1], 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw fail();
  try {
    const claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as FillClaims;
    if (!claims || Object.keys(claims).sort().join() !== 'aud,exp,iat,sessionId,templateId,versionId'
      || claims.aud !== 'applicant-form-fill'
      || ![claims.templateId, claims.versionId, claims.sessionId].every((v) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(v))
      || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)
      || claims.exp - claims.iat !== FILL_LIFETIME_SECONDS || claims.iat > Math.floor(now / 1000) + 60
      || claims.exp <= Math.floor(now / 1000)) throw fail();
    return claims;
  } catch { throw fail(); }
}
