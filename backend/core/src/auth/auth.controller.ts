import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../http/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import type { TokenPair } from './token.service';

// HTTP transport only: validate the body (global pipe) and call the facade.
// None of these operations takes an actor: register/login/refresh are public
// and logout only revokes the refresh token it is given.
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() body: RegisterDto): Promise<TokenPair> {
    return this.authService.register(body);
  }

  @Public()
  @Post('login')
  login(@Body() body: LoginDto): Promise<TokenPair> {
    return this.authService.login(body);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() body: RefreshTokenDto): Promise<TokenPair> {
    return this.authService.refresh(body);
  }

  @Post('logout')
  logout(@Body() body: RefreshTokenDto): Promise<{ ok: true }> {
    return this.authService.logout(body);
  }
}
