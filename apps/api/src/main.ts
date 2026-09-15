import 'reflect-metadata';

import { gzip } from 'node:zlib';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { inspectionUploadBody } from './modules/device-inspection-records/device-inspection-upload-body';
import { json, text, urlencoded, type NextFunction, type Request, type Response } from 'express';

import { AppModule } from './app.module';
import { parseTrustedProxy } from './common/trusted-proxy';

/**
 * 进程级兜底：任何未被捕获的 Promise rejection / 同步异常，只记日志、不退出进程。
 *
 * 背景：SSE 长连接（MateChat 流式对话）一旦有一处 await 的 rejection 逃逸到顶层，
 * Node 默认 `--unhandled-rejections=throw` 会直接结束进程；单实例部署下，这会让
 * 所有在途的 SSE 连接同时断线（前端表现为一句 network error，且未落库的回答一起消失）。
 * 生产不能因为单个请求的边角异常而全站中断——这里把「进程存活」与「单请求失败」解耦，
 * 请求级的错误仍由全局异常过滤器 / 各自的 catch 正常处理并回报给该请求。
 */
const processLogger = new Logger('Process');
process.on('unhandledRejection', (reason) => {
  processLogger.error(
    `未处理的 Promise rejection（已忽略，进程继续运行）: ${
      reason instanceof Error ? reason.stack ?? reason.message : String(reason)
    }`,
  );
});
process.on('uncaughtException', (error) => {
  processLogger.error(
    `未捕获的异常（已忽略，进程继续运行）: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
  );
});

/**
 * 研发数据表快照响应 gzip（零依赖，Node 内置 zlib 异步压缩，不阻塞事件循环）。
 * 快照 JSON 文本压缩率 5~10 倍，是「打开慢」的直接止血项；nginx 若已开 gzip 也不冲突
 * （响应已带 Content-Encoding 时 nginx 不会二次压缩）。仅挂在该路由，不影响其他接口。
 */
function gzipJsonResponses(req: Request, res: Response, next: NextFunction) {
  if (!/\bgzip\b/i.test(String(req.headers['accept-encoding'] ?? ''))) return next();
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    const payload = JSON.stringify(body);
    // 小响应（保存返回的元数据等）不值得压缩
    if (payload.length < 1024) return originalJson(body);
    gzip(Buffer.from(payload), (err, zipped) => {
      if (err || res.headersSent) {
        originalJson(body);
        return;
      }
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Vary', 'Accept-Encoding');
      res.send(zipped);
    });
    return res;
  };
  next();
}

const defaultCorsOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
];

async function bootstrap() {
  // 安全闸门：生产环境必须显式配置 JWT_SECRET；鉴权模块同样采用 fail-closed，
  // 避免任何缺少密钥的部署进入可签发令牌的运行状态。
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET?.trim()) {
    // eslint-disable-next-line no-console
    console.error(
      '[FATAL] 生产环境未配置 JWT_SECRET：拒绝以内置默认密钥启动。请在 apps/api/.env 设置一个强随机 JWT_SECRET 后重启。',
    );
    process.exit(1);
  }

  let trustedProxy: ReturnType<typeof parseTrustedProxy>;
  try { trustedProxy = parseTrustedProxy(process.env.TRUST_PROXY); }
  catch (error) {
    console.error(`[FATAL] ${error instanceof Error ? error.message : 'TRUST_PROXY 配置无效'}`);
    process.exit(1);
  }
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // The bundled Nginx forwards from loopback. Trust only configured proxy peers; direct clients cannot choose req.ip through XFF.
  app.getHttpAdapter().getInstance().set('trust proxy', trustedProxy);
  // Stop background workers on deployment; durable leases let another instance resume.
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  app.use(text({ type: ['text/*', 'application/xml', 'text/xml'], limit: '5mb' }));
  // 研发数据表会把高保真工作簿（含 base64 图片）作为 JSON 保存；当前线上快照
  // 已超过通用 25 MB 上限。仅对此路由放宽，避免扩大其他 JSON 接口的攻击面。
  app.use('/api/research-development/sheet-workbook', json({ limit: '50mb' }));
  // 大快照读取的下行提速（图片出仓后快照为纯文本，压缩率 5~10x）
  app.use('/api/research-development/sheet-workbook', gzipJsonResponses);
  app.use('/api/factory-qc/records', inspectionUploadBody);
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',').map((item) => item.trim()) ?? defaultCorsOrigins,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
