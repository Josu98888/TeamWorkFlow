import { Controller, Inject } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { AUTH_SERVICE } from '../config';
import { ClientProxy } from '@nestjs/microservices';

@Controller('auth')
export class AuthController {
  @Inject(AUTH_SERVICE) private readonly authClient: ClientProxy;
  constructor() {} 

  @Post('login')
  login() {
    return this.authClient.send({ cmd: 'login' }, {});
  }

  @Post('logout')
  logout() {
    return { message: 'Logout successful' };
  } 

  @Post('register')
  register() {
    return { message: 'Registration successful' };
  }

   @Post('refresh-token')
  refreshToken() {
    return { message: 'Token refreshed successfully' };
  }
}
