import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { envs } from '../config';
import { AuthTokenResponder } from './auth-token.responder';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EventsModule } from './events/events.module';
import { PrismaService } from './prisma/prisma.service';
import { TokenService } from './token.service';

// Only the facade (AuthService) is exported; Prisma and tokens stay private.
@Module({
  imports: [
    EventsModule,
    JwtModule.register({
      secret: envs.jwtSecret,
      signOptions: { algorithm: 'HS256' },
    }),
  ],
  controllers: [AuthController, AuthTokenResponder],
  providers: [PrismaService, AuthService, TokenService],
  exports: [AuthService],
})
export class AuthModule {}
