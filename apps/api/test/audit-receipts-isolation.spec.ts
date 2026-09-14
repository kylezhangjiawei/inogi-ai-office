import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditReceiptsTestDatabaseUrl } from './helpers/audit-receipts-database';

const target = 'postgresql://inogi_audit_receipts_test@localhost:55441/inogi_audit_receipts_test?host=%2Fprivate%2Ftmp%2Finogi-audit-receipts-db-Ab1234';

test('integration fixtures accept only the dedicated disposable socket database', () => {
  assert.equal(auditReceiptsTestDatabaseUrl(target).pathname, '/inogi_audit_receipts_test');
  const invalid = [
    (url: URL) => { url.hostname = 'db.example.com'; },
    (url: URL) => { url.port = '5432'; },
    (url: URL) => { url.username = 'production'; },
    (url: URL) => { url.password = 'secret'; },
    (url: URL) => { url.pathname = '/production'; },
    (url: URL) => { url.search = ''; },
    (url: URL) => { url.searchParams.set('host', '/tmp'); },
    (url: URL) => { url.searchParams.set('host', '/private/tmp/inogi-audit-receipts-db-Ab1234/../business'); },
    (url: URL) => { url.searchParams.set('schema', 'business'); },
    (url: URL) => { url.searchParams.set('hostaddr', '192.0.2.1'); },
  ];
  for (const mutate of invalid) {
    const url = new URL(target); mutate(url);
    assert.throws(() => auditReceiptsTestDatabaseUrl(url.toString()));
  }
});
