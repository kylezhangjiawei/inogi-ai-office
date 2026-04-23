import { Body, Controller, Get, Post, Request } from '@nestjs/common';

import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('security/public-key')
  getLoginPublicKey() {
    return this.authService.getLoginSecurityPublicKey();
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.account, dto.password, dto.encryptedPassword);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Get('me')
  me(@Request() req: { user: { id: string } }) {
    return this.authService.getCurrentUser(req.user.id);
  }

  @Post('logout')
  logout(
    @Request() req: { user: { id: string } },
    @Body() dto: RefreshTokenDto,
  ) {
    return this.authService.logout(dto.refreshToken, req.user.id);
  }

  @Post('me/password')
  setPassword(
    @Request() req: { user: { id: string } },
    @Body('password') password: string,
  ) {
    return this.authService.setPassword(req.user.id, password);
  }
}
