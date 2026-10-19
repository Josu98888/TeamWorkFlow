import { Controller, Inject, Post, Body } from '@nestjs/common';
import { NATS_SERVICE } from '../config';
import { ClientProxy } from '@nestjs/microservices';
import { authPatterns } from './auth.patterns';
import { Public } from '../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  @Inject(NATS_SERVICE) private readonly client: ClientProxy;

  @Public()
  @Post('login')
  login(@Body() body: any) {
    return this.client.send(authPatterns.login, body);
  }

  @Post('logout')
  logout(@Body() body: any) {
    return this.client.send(authPatterns.logout, body);
  } 

  @Public()
  @Post('register')
  register(@Body() body: any) {
    return this.client.send(authPatterns.register, body);
  }

  @Public()
  @Post('refresh-token')
  refreshToken(@Body() body: any) {
    return this.client.send(authPatterns.refreshToken, body);
  }
}
