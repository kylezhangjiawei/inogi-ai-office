import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { APPLICANT_FORM_LOG_OMITTED, applicantFormLogPath } from './applicant-form-log-policy';

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
    const request = ctx.getRequest<{ method?: string; url?: string; path?: string; originalUrl?: string; route?: { path?: unknown } }>();
    const applicantPath = request ? applicantFormLogPath(request) : null;
    const logPath = applicantPath ?? request?.url ?? '-';
    const errorDetails = applicantPath
      ? APPLICANT_FORM_LOG_OMITTED
      : exception instanceof Error ? exception.stack : String(exception);

    // SSE / 流式响应：响应头已经发出（甚至已经 res.write 过正文），此时再调 response.json()
    // 会抛 ERR_HTTP_HEADERS_SENT，异常从过滤器内部逃逸 → 顶层 unhandled rejection。
    // 单实例部署下这会连带掐断所有在途连接。已发头就只记日志并确保连接收尾，不再写响应体。
    if (response.headersSent) {
      this.logger.error(
        `Exception after headers sent on ${request?.method ?? '-'} ${logPath}`,
        errorDetails,
      );
      if (!response.writableEnded) response.end();
      return;
    }

    if (exception instanceof HttpException) {
      // 保持框架默认契约：状态码与响应体原样返回，前端错误提示不受影响。
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    // 未预期异常：记录完整信息便于排查，只回最小安全信息给客户端。
    this.logger.error(
      `Unhandled exception on ${request?.method ?? '-'} ${logPath}`,
      errorDetails,
    );
    // 非生产环境附带真实错误信息，免去开发排查时「盲猜 500」；生产仍只回通用文案
    const detail =
      !applicantPath && process.env.NODE_ENV !== 'production' && exception instanceof Error
        ? exception.message
        : undefined;
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: '服务器内部错误',
      ...(detail ? { detail } : {}),
    });
  }
}
