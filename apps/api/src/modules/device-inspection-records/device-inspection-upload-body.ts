import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { json, type NextFunction, type Request, type Response } from 'express';

const parser = json({ limit: '2mb' });
/** Runs before the general 25MB parser and preserves 400/413 with the app's exception filter. */
export function inspectionUploadBody(request: Request, response: Response, next: NextFunction) {
  parser(request, response, (error?: any) => {
    if (error?.type === 'entity.too.large') return next(new PayloadTooLargeException('检测记录不能超过2MB'));
    if (error?.type === 'entity.parse.failed') return next(new BadRequestException('检测记录JSON格式无效'));
    return next(error);
  });
}
