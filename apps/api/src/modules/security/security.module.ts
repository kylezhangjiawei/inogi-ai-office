import { Global, Module } from '@nestjs/common';
import { SecureConfigService } from './secure-config.service';

@Global()
@Module({
  providers: [SecureConfigService],
  exports: [SecureConfigService],
})
export class SecurityModule {}
