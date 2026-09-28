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

// Real Express/Nest/JWT path, but no listener, .env or business database.
async function request(server: Server, method: string, path: string, token?: string) {
  const chunks: Buffer[] = [];
  const socket = new Duplex({ read() {}, write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  const req = new IncomingMessage(socket as Socket); req.method = method; req.url = path; req.httpVersion = '1.1'; req.httpVersionMajor = 1; req.httpVersionMinor = 1; req.complete = true;
  req.headers = { host: 'isolated.invalid', connection: 'close', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const res = new ServerResponse(req); res.assignSocket(socket as Socket);
  const finished = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('HTTP stalled')), 2000); res.once('finish', () => { clearTimeout(timer); resolve(); }); res.once('error', reject); });
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
