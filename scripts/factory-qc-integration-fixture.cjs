/* Local integration fixture: actual Nest controllers/services, isolated memory storage, loopback HTTPS only. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const apiRoot = path.resolve(__dirname, '../apps/api');
const output = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(path.join(output, 'certificate.pem'))) throw new Error('Provide a test directory containing certificate.pem and private-key.pem.');
const apiRequire = createRequire(path.join(apiRoot, 'package.json'));
apiRequire('ts-node').register({ transpileOnly: true, project: path.join(apiRoot, 'tsconfig.json') });
apiRequire('reflect-metadata');
const { Module } = apiRequire('@nestjs/common');
const { NestFactory } = apiRequire('@nestjs/core');
const { FactoryQcService } = require(path.join(apiRoot, 'src/modules/electronic-gate/factory-qc.service.ts'));
const { ElectronicGateService } = require(path.join(apiRoot, 'src/modules/electronic-gate/electronic-gate.service.ts'));
const { FactoryQcPublicController } = require(path.join(apiRoot, 'src/modules/electronic-gate/factory-qc.controller.ts'));
const { PrismaService } = require(path.join(apiRoot, 'src/prisma/prisma.service.ts'));
let rows = new Map(), queue = Promise.resolve(), mode = 'normal';
const requests = [];
const model = get => ({
  async findUnique({where}) { return structuredClone(get().get(where.key) || null); },
  async findMany({where = {}} = {}) { return structuredClone([...get().values()].filter(row => (!where.category || row.category === where.category) && (!where.key?.startsWith || row.key.startsWith(where.key.startsWith)) && (!where.key?.in || where.key.in.includes(row.key)))); },
  async create({data}) { if (get().has(data.key)) throw Object.assign(new Error('Duplicate fixture key'), {code:'P2002'}); const row = {updatedAt:new Date(),...structuredClone(data)}; get().set(row.key,row); return structuredClone(row); },
  async upsert({where,create,update}) { const row = {...(get().get(where.key) || create),...structuredClone(update),updatedAt:new Date()}; get().set(where.key,row); return structuredClone(row); },
  async updateMany({where,data}) { const row = get().get(where.key); if (!row || row.value.revision !== where.value.equals) return {count:0}; get().set(where.key,{...row,...structuredClone(data),updatedAt:new Date()}); return {count:1}; },
});
const db = {
  systemSetting:model(()=>rows),
  async $transaction(operation) {
    const previous=queue; let release; queue=new Promise(resolve=>{release=resolve;}); await previous;
    const working=structuredClone(rows);
    try { const result=await operation({systemSetting:model(()=>working),async $executeRaw(){return 1;}}); rows=working; return result; } finally {release();}
  },
};
class FixtureModule {}
Module({controllers:[FactoryQcPublicController],providers:[FactoryQcService,ElectronicGateService,{provide:PrismaService,useValue:db}]})(FixtureModule);
async function start() {
  const app = await NestFactory.create(FixtureModule,{logger:false,httpsOptions:{key:fs.readFileSync(path.join(output,'private-key.pem')),cert:fs.readFileSync(path.join(output,'certificate.pem'))}});
  app.setGlobalPrefix('api');
  app.use((req,res,next)=>{
    if (req.path.startsWith('/api/factory-qc/')) {
      requests.push({method:req.method,path:req.path,hasAuthorization:!!req.headers.authorization,hasCookie:!!req.headers.cookie,hasBody:!!req.headers['content-length']});
      if(mode==='unavailable') return res.status(503).json({message:'Fixture temporarily unavailable'});
      if(mode==='invalid') return res.status(200).type('json').send('{"schemaVersion":999}');
    }
    if (req.path==='/__fixture/metrics') return res.json({requests,rows:rows.size,mode});
    if (req.path==='/__fixture/mode' && req.method==='POST') {mode=['normal','invalid','unavailable'].includes(req.query.value)?req.query.value:'normal';return res.json({mode});}
    if (req.path==='/__fixture/publish-next' && req.method==='POST') {
      void (async()=>{
        const service=app.get(FactoryQcService), gate=app.get(ElectronicGateService), actor={name:'Local integration fixture'};
        const state=await service.getState(), catalog=structuredClone(state.protocol.active);
        catalog.version='integration-20260909-next';
        const draft=await service.saveCatalogDraft({expectedRevision:state.protocol.revision,catalog});
        await service.publishCatalog({expectedRevision:draft.protocol.revision},actor);
        const item=(await gate.list()).items.find(item=>item.id==='baud-rate'), serialDraft=structuredClone(item.active);
        serialDraft.values.baudRate='57600';
        const saved=await gate.saveDraft(item.id,{expectedRevision:item.revision,draft:serialDraft},actor);
        await gate.publish(item.id,{expectedRevision:saved.revision},actor);
        res.json({protocolVersion:catalog.version,baudRate:57600});
      })().catch(error=>res.status(error.getStatus?.()||500).json({message:error.message}));
      return;
    }
    next();
  });
  await app.listen(0,'127.0.0.1');
  const port=app.getHttpServer().address().port;
  fs.writeFileSync(path.join(output,'ready.json'),JSON.stringify({baseUrl:`https://127.0.0.1:${port}`,pid:process.pid,scope:'Actual Nest HTTPS with in-memory storage; no .env, database or device access.'},null,2));
  process.stdout.write(`Fixture ready: https://127.0.0.1:${port}\n`);
  const close=async()=>{await app.close();process.exit(0);};
  process.on('SIGINT',close);process.on('SIGTERM',close);
  setTimeout(close,600000).unref();
}
start().catch(error=>{process.stderr.write(String(error.stack||error));process.exitCode=1;});
