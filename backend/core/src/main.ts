import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { configureApp } from './app.config';
import { envs } from './config';

async function bootstrap() {
  const logger = new Logger('Core');

  const app = await NestFactory.create(AppModule);
  configureApp(app);

  // Hybrid app: HTTP for clients plus the NATS responders `telemetry` needs
  // (`auth.token.verify`). The app config is not inherited on purpose: the
  // HTTP filter must not answer NATS requests (responders bind their own).
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.NATS,
    options: { servers: envs.natsServers, queue: 'core' },
  });
  await app.startAllMicroservices();

  await app.listen(envs.port);
  logger.log(`Core is running on: http://localhost:/api/v1`);
}
void bootstrap();
