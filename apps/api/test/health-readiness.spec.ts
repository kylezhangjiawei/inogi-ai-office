import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from '../src/modules/health/health.controller';

test('就绪检查实际查询数据库并返回当前应用版本', async () => {
  let queries = 0;
  const controller = new HealthController({ $queryRaw: async () => { queries += 1; return [{ value: 1 }]; } } as never);
  const response = await controller.getReadiness();
  assert.equal(queries, 1);
  assert.equal(response.ok, true);
  assert.equal(response.database, 'ready');
  assert.equal(response.git_sha, controller.getHealth().git_sha);
  assert.equal(response.release, controller.getHealth().release);
});

test('数据库故障返回503，不泄露连接信息；存活接口不依赖数据库', async () => {
  const controller = new HealthController({ $queryRaw: async () => { throw new Error('postgresql://private-connection'); } } as never);
  assert.equal(controller.getHealth().ok, true);
  await assert.rejects(controller.getReadiness(), (error: ServiceUnavailableException) => {
    assert.equal(error.getStatus(), 503);
    assert.deepEqual(error.getResponse(), { ok: false, message: '数据库暂不可用', database: 'unavailable' });
    return true;
  });
});
