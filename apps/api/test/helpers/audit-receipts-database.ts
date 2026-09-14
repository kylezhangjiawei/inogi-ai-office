import * as assert from 'node:assert/strict';

/** Only the socket-only disposable database created by the dedicated runner is accepted. */
export function auditReceiptsTestDatabaseUrl(value: string): URL {
  const url = new URL(value);
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, 'localhost');
  assert.equal(url.port, '55441');
  assert.equal(url.username, 'inogi_audit_receipts_test');
  assert.equal(url.password, '');
  assert.equal(url.pathname, '/inogi_audit_receipts_test');
  assert.deepEqual([...url.searchParams.keys()], ['host']);
  assert.match(url.searchParams.get('host') ?? '', /^\/private\/tmp\/inogi-audit-receipts-db-[A-Za-z0-9]+$/);
  return url;
}
