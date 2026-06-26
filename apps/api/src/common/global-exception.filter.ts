import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * 全局兜底异常过滤器。
 *
 * - HttpException（含 NestJS 内置的 401/403/400/404 等，及自定义的 ThirdPartyApiException）：
 *   原样透传框架默认的状态码与响应体，保持前端既有的错误解析契约不变。
 * - 其它未捕获异常：记录完整堆栈用于排查，但只向客户端返回最小安全信息（500 + 通用文案），
 *   绝不把内部错误细节/堆栈泄露出去。
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('GlobalExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ method?: string; url?: string }>();

    if (exception instanceof HttpException) {
      // 保持框架默认契约：状态码与响应体原样返回，前端错误提示不受影响。
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    // 未预期异常：记录完整信息便于排查，只回最小安全信息给客户端。
    this.logger.error(
      `Unhandled exception on ${request?.method ?? '-'} ${request?.url ?? '-'}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: '服务器内部错误',
    });
  }
}
