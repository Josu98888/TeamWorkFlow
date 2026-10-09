import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { envs } from './config';

async function bootstrap() {
  const logger = new Logger('AuthMicroservice');

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.NATS,
      options: {
        servers: envs.natsServers,
      },
    },
  );

  app.useGlobalPipes(createValidationPipe());

  await app.listen();
  logger.log('Auth microservice listening on NATS');
}
void bootstrap();
