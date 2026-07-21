import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, text, urlencoded } from 'express';

import { AppModule } from './app.module';

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

  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(text({ type: ['text/*', 'application/xml', 'text/xml'], limit: '5mb' }));
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
