/**
 * Global Multer configuration module.
 *
 * Provides MULTER_MODULE_OPTIONS globally so that every FilesInterceptor /
 * FileInterceptor in any feature module automatically picks up our charset
 * setting without needing per-interceptor options.
 *
 * Key setting: defParamCharset = 'utf8'
 *   Browsers send multipart filenames as UTF-8 bytes. Busboy (used internally
 *   by multer) defaults to latin1, which produces garbled Chinese characters
 *   (e.g. "å¾½çš„" instead of "归纳"). Switching to utf8 fixes this at the
 *   source so no post-processing is needed.
 */
import { Global, Module } from '@nestjs/common';

@Global()
@Module({
  providers: [
    {
      provide: 'MULTER_MODULE_OPTIONS',
      useValue: { defParamCharset: 'utf8' },
    },
  ],
  exports: ['MULTER_MODULE_OPTIONS'],
})
export class MulterConfigModule {}
