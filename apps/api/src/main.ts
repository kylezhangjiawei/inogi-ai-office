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
