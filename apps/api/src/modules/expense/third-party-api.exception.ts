import { HttpException, HttpStatus } from '@nestjs/common';

import type { ThirdPartyOfficialError } from './expense.types';

export class ThirdPartyApiException extends HttpException {
  constructor(
    message: string,
    readonly officialError: ThirdPartyOfficialError,
    status = HttpStatus.BAD_GATEWAY,
  ) {
    super(
      {
        message,
        provider: officialError.provider,
        official_error: officialError,
      },
      status,
    );
  }
}
