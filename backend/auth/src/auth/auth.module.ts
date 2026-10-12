import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { envs } from '../config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TokenService } from './token.service';

@Module({
  imports: [
    JwtModule.register({
      secret: envs.jwtSecret,
      signOptions: { algorithm: 'HS256' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService],
  exports: [TokenService],
})
export class AuthModule {}
