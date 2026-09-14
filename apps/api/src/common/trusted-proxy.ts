import { isIP } from 'node:net';

/** Only explicit proxy addresses are trusted. Hop counts and unrestricted trust permit spoofed XFF on shorter paths. */
export function parseTrustedProxy(value: string | undefined): false | string[] {
  const raw = value?.trim();
  if (!raw || raw.toLowerCase() === 'false') return false;
  const entries = raw.split(',').map((entry) => entry.trim());
  if (entries.length > 32 || entries.some((entry) => {
    if (entry === 'loopback') return false;
    const [address, prefix, extra] = entry.split('/');
    const family = isIP(address);
    if (!family || extra !== undefined) return true;
    return prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128));
  })) throw new Error('TRUST_PROXY 仅支持 loopback 或逗号分隔的代理 IP/CIDR；不得使用 true、跳数或全网网段');
  return entries;
}
