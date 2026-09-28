import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse, type Server } from 'node:http';
import { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { createAccessCredentialVersion } from '../src/modules/auth/access-credential-version';
import { PermissionCatalogService } from '../src/modules/permission-catalog/permission-catalog.service';
import { OrderProcessingController } from '../src/modules/order-processing/order-processing.controller';
import { OrderProcessingService } from '../src/modules/order-processing/order-processing.service';
import { OrderStockService } from '../src/modules/order-processing/order-stock.service';
import { TplusSyncController } from '../src/modules/procurement/tplus-sync.controller';
import { TplusSyncService } from '../src/modules/procurement/tplus-sync.service';
import { TplusPoMatchService } from '../src/modules/procurement/tplus-po-match.service';
import { TplusOperationsService } from '../src/modules/procurement/tplus-operations.service';

// Real Express/Nest/JWT path, but no listener, .env or business database.
async function request(server: Server, method: string, path: string, token?: string, body?: unknown) {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const chunks: Buffer[] = [];
  const socket = new Duplex({ read() {}, write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  const req = new IncomingMessage(socket as Socket); req.method = method; req.url = path; req.httpVersion = '1.1'; req.httpVersionMajor = 1; req.httpVersionMinor = 1; req.complete = true;
  req.headers = { host: 'isolated.invalid', connection: 'close', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}) };
  const res = new ServerResponse(req); res.assignSocket(socket as Socket);
  const finished = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('HTTP stalled')), 2000); res.once('finish', () => { clearTimeout(timer); resolve(); }); res.once('error', reject); });
  if (payload) req.push(payload);
  req.push(null); server.emit('request', req, res); await finished; socket.destroy(); return res.statusCode;
}
test('JWT 401, authenticated retired writes 410, legacy read permissions 403; no old DB delegates called', async () => {
  const secret = 'isolated-stock-test-key-not-for-deployment', passwordHash = 'synthetic';
  let permissions: string[] = [], reads = 0;
  const db = { user: { findUnique: async () => ({ id: 'u', passwordHash, name: '测试用户', department: null, role: { permissions } }) } };
  const trap = new Proxy({}, { get() { throw new Error('BUSINESS_DATABASE_ACCESSED'); } });
  const inventory: any = { inventory: async () => { reads++; return { inventory: { items: [] }, ledgerMovements: [] }; } };
  const orderStock = new OrderStockService(trap as any, inventory);
  const service = new OrderProcessingService(trap as any, trap as any, trap as any, trap as any, inventory, orderStock);
  const module = await Test.createTestingModule({ imports: [PassportModule, JwtModule.register({ secret })], controllers: [OrderProcessingController], providers: [
    { provide: PrismaService, useValue: db }, { provide: ConfigService, useValue: { getOrThrow: () => secret } },
    { provide: PermissionCatalogService, useValue: { filterDisabled: async (codes: string[]) => codes } },
    { provide: OrderProcessingService, useValue: service }, { provide: OrderStockService, useValue: orderStock },
    JwtStrategy, { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: RolesGuard },
  ] }).compile();
  const app = module.createNestApplication({ logger: false }); app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  try {
    await app.init(); const token = module.get(JwtService).sign({ sub: 'u', credentialVersion: createAccessCredentialVersion(secret, 'u', passwordHash) });
    for (const [method, path] of [['POST', 'stock-in'], ['POST', 'anything/stock-out'], ['PATCH', 'anything/adjust'], ['POST', 'ai-recognize']]) {
      assert.equal(await request(app.getHttpServer(), method, `/order-processing/inventory/${path}`), 401);
      assert.equal(await request(app.getHttpServer(), method, `/order-processing/inventory/${path}`, token), 410);
      permissions = ['*']; assert.equal(await request(app.getHttpServer(), method, `/order-processing/inventory/${path}`, token), 410); permissions = [];
    }
    assert.equal(await request(app.getHttpServer(), 'GET', '/order-processing/inventory', token), 403);
    assert.equal(await request(app.getHttpServer(), 'GET', '/order-processing/material-options', token), 403);
    assert.equal(reads, 0);
    permissions = ['page:inventory-management']; assert.equal(await request(app.getHttpServer(), 'GET', '/order-processing/inventory', token), 200); assert.equal(reads, 1);
    permissions = ['order-processing:material-map']; assert.equal(await request(app.getHttpServer(), 'POST', '/order-processing/orders/o/lines/l/material-mapping', token), 403);
  } finally { await app.close(); }
});

test('order and purchase-order endpoints require their page permission before calling services', async (t) => {
  const routes = [
    { method: 'POST', path: 'orders/upload', service: 'uploadOrders', permission: 'page:order-workbench' },
    { method: 'POST', path: 'orders/sync-mail', service: 'syncWecomMailOrders', permission: 'page:order-workbench' },
    { method: 'POST', path: 'orders/o/generate-invoice', service: 'generateInvoice', permission: 'page:order-workbench' },
    { method: 'POST', path: 'orders/o/export-invoice', service: 'exportInvoice', permission: 'page:order-workbench' },
    { method: 'POST', path: 'templates/active', service: 'saveActiveTemplate', permission: 'page:order-workbench' },
    { method: 'POST', path: 'templates', service: 'saveTemplate', permission: 'page:order-workbench' },
    { method: 'POST', path: 'templates/ai-generate', service: 'generateAiTemplate', permission: 'page:order-workbench' },
    { method: 'POST', path: 'reminder-rule', service: 'saveReminderRule', permission: 'page:order-workbench' },
    { method: 'GET', path: 'purchase-orders', service: 'getPurchaseOrders', permission: 'page:purchase-orders' },
    { method: 'POST', path: 'purchase-orders/import', service: 'importPurchaseOrders', permission: 'page:purchase-orders' },
    { method: 'GET', path: 'purchase-orders/p', service: 'getPurchaseOrder', permission: 'page:purchase-order-detail' },
  ];
  const secret = 'isolated-order-permissions-key-not-for-deployment', passwordHash = 'synthetic';
  let permissions: string[] = [];
  const calls: string[] = [];
  const db = { user: { findUnique: async () => ({ id: 'u', passwordHash, name: '测试用户', department: null, role: { permissions } }) } };
  const service = Object.fromEntries(routes.map((route) => [route.service, async () => { calls.push(route.service); return { ok: true }; }]));
  const module = await Test.createTestingModule({ imports: [PassportModule, JwtModule.register({ secret })], controllers: [OrderProcessingController, TplusSyncController], providers: [
    { provide: PrismaService, useValue: db }, { provide: ConfigService, useValue: { getOrThrow: () => secret } },
    { provide: PermissionCatalogService, useValue: { filterDisabled: async (codes: string[]) => codes } },
    { provide: OrderProcessingService, useValue: service }, { provide: OrderStockService, useValue: {} },
    { provide: TplusSyncService, useValue: {} }, { provide: TplusPoMatchService, useValue: {} },
    { provide: TplusOperationsService, useValue: { getPurchaseOrder: async () => { calls.push('tplus.getPurchaseOrder'); return { ok: true }; } } },
    JwtStrategy, { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: RolesGuard },
  ] }).compile();
  const app = module.createNestApplication({ logger: false }); app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  try {
    await app.init(); const token = module.get(JwtService).sign({ sub: 'u', credentialVersion: createAccessCredentialVersion(secret, 'u', passwordHash) });
    for (const route of routes) {
      await t.test(route.service, async (routeTest) => {
        const successStatus = route.method === 'GET' ? 200 : 201;
        const cases = [
          { name: 'unauthenticated', permissions: [], token: undefined, status: 401 },
          { name: 'no permission', permissions: [], token, status: 403 },
          { name: 'wrong page', permissions: [route.permission === 'page:purchase-orders' ? 'page:purchase-order-detail' : 'page:purchase-orders'], token, status: 403 },
          { name: 'matching page', permissions: [route.permission], token, status: successStatus },
          { name: 'wildcard', permissions: ['*'], token, status: successStatus },
        ];
        for (const scenario of cases) {
          await routeTest.test(scenario.name, async () => {
            permissions = scenario.permissions; calls.length = 0;
            const status = await request(app.getHttpServer(), route.method, `/order-processing/${route.path}`, scenario.token, route.method === 'POST' ? { templateId: 't' } : undefined);
            assert.deepEqual({ status, calls }, { status: scenario.status, calls: scenario.status === successStatus ? [route.service] : [] });
          });
        }
      });
    }
    await t.test('T+ purchase-order detail', async (detailTest) => {
      const cases = [
        { name: 'unauthenticated', permissions: [], token: undefined, status: 401 },
        { name: 'no permission', permissions: [], token, status: 403 },
        { name: 'list page only', permissions: ['page:purchase-orders'], token, status: 403 },
        { name: 'unrelated page', permissions: ['page:order-workbench'], token, status: 403 },
        { name: 'detail page', permissions: ['page:purchase-order-detail'], token, status: 200 },
        { name: 'wildcard', permissions: ['*'], token, status: 200 },
      ];
      for (const scenario of cases) {
        await detailTest.test(scenario.name, async () => {
          permissions = scenario.permissions; calls.length = 0;
          const status = await request(app.getHttpServer(), 'GET', '/procurement/tplus/views/purchase-orders/p', scenario.token);
          assert.deepEqual({ status, calls }, { status: scenario.status, calls: scenario.status === 200 ? ['tplus.getPurchaseOrder'] : [] });
        });
      }
    });
  } finally { await app.close(); }
});
