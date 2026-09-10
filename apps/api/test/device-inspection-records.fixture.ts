import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TestingModule, Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { json } from 'express';
import { DeviceInspectionRecordsService } from '../src/modules/device-inspection-records/device-inspection-records.service';
import { DeviceInspectionRecordsController, DeviceInspectionUploadController } from '../src/modules/device-inspection-records/device-inspection-records.controller';
import { DeviceInspectionUploadGuard } from '../src/modules/device-inspection-records/device-inspection-upload.guard';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { GlobalExceptionFilter } from '../src/common/global-exception.filter';
import { inspectionUploadBody } from '../src/modules/device-inspection-records/device-inspection-upload-body';

export const FIXTURE_UPLOAD_TOKEN = 'fixture-only-device-upload-token';
const JWT_SECRET = 'fixture-only-admin-jwt-secret-never-production';

export function memoryPrisma() {
  const rows = new Map<string, any>(); let sequence = 0;
  const queries: any[] = [];
  const pick = (row: any, select?: any) => row == null ? null : structuredClone(select ? Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, row[key]])) : row);
  const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([key, value]: any) => {
    if (key === 'OR') return value.some((clause: any) => matches(row, clause));
    if (value == null || typeof value !== 'object' || value instanceof Date) return row[key] === value;
    if ('contains' in value) return String(row[key] ?? '').toLowerCase().includes(value.contains.toLowerCase());
    if ('has' in value) return row[key].includes(value.has);
    if ('gte' in value && row[key] < value.gte) return false;
    if ('lte' in value && row[key] > value.lte) return false;
    if ('gt' in value && !(row[key] > value.gt)) return false;
    return true;
  });
  const model = {
    async findUnique({ where, select }: any) { return pick(where.id ? rows.get(where.id) : [...rows.values()].find(row => row.clientId === where.clientId_testId.clientId && row.testId === where.clientId_testId.testId), select); },
    async create({ data }: any) {
      if ([...rows.values()].some(row => row.clientId === data.clientId && row.testId === data.testId)) throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
      const row = { ...structuredClone(data), id: `fixture-${String(++sequence).padStart(6, '0')}`, receivedAt: new Date() };
      rows.set(row.id, row); return pick(row);
    },
    async count({ where }: any) { return [...rows.values()].filter(row => matches(row, where)).length; },
    async findMany(query: any) { queries.push(query); const rowsSorted = [...rows.values()].filter(row => matches(row, query.where)).sort((a, b) => b.collectionAt - a.collectionAt || b.id.localeCompare(a.id)); return rowsSorted.slice(query.skip ?? 0, (query.skip ?? 0) + (query.take ?? rowsSorted.length)).map(row => pick(row, query.select)); },
  };
  const db = { deviceInspectionRecord: model, async $transaction(work: any) { return work(db); } };
  return { db, rows, queries, service: new DeviceInspectionRecordsService(db as any) };
}

@Injectable()
class FixtureJwtStrategy extends PassportStrategy(Strategy) {
  constructor() { super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: JWT_SECRET }); }
  validate(payload: any) { return { id: 'fixture-admin', permissions: payload.permissions ?? [] }; }
}
export async function createFixtureServer(options: { uploadToken?: string; port?: number } = {}) {
  const store = memoryPrisma();
  const module: TestingModule = await Test.createTestingModule({
    imports: [PassportModule], controllers: [DeviceInspectionRecordsController, DeviceInspectionUploadController],
    providers: [FixtureJwtStrategy, DeviceInspectionUploadGuard,
      { provide: ConfigService, useValue: { get: () => options.uploadToken ?? FIXTURE_UPLOAD_TOKEN } },
      { provide: DeviceInspectionRecordsService, useValue: store.service }],
  }).compile();
  const app = module.createNestApplication({ logger: false, bodyParser: false });
  app.use('/api/factory-qc/records', inspectionUploadBody);
  app.use(json({ limit: '25mb' }));
  app.setGlobalPrefix('api');
  const reflector = new Reflector();
  app.useGlobalGuards(new JwtAuthGuard(reflector), new RolesGuard(reflector));
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.listen(options.port ?? 0, '127.0.0.1');
  const address = app.getHttpServer().address();
  const jwt = new JwtService({ secret: JWT_SECRET });
  return { app, store, url: `http://127.0.0.1:${address.port}`, uploadToken: options.uploadToken ?? FIXTURE_UPLOAD_TOKEN,
    adminToken: jwt.sign({ permissions: ['page:device-inspection-records'] }, { expiresIn: '1h' }),
    noPermissionToken: jwt.sign({ permissions: [] }, { expiresIn: '1h' }) };
}

// Optional standalone loopback fixture for native integration. Never imports AppModule,
// PrismaClient, environment files or production credentials; all records remain in memory.
if (require.main === module) {
  createFixtureServer({ port: Number(process.argv[2] ?? 0) }).then(server => {
    console.log(JSON.stringify({ url: server.url, uploadToken: server.uploadToken, adminToken: server.adminToken }));
    const close = () => { void server.app.close().then(() => process.exit(0)); };
    process.once('SIGINT', close); process.once('SIGTERM', close);
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
