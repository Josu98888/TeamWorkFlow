import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { configureApp } from './app.config';
import { envs } from './config';
import { buildNatsOptions } from './config/nats-options';

async function bootstrap() {
  const logger = new Logger('Core');

  if (!envs.cookieSecure && process.env.NODE_ENV === 'production') {
    logger.warn(
      'COOKIE_SECURE=false in production: auth cookies are sent without the Secure flag. Only acceptable for an HTTP-only test deployment, never with real users.',
    );
  }

  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableCors({
    origin: envs.webOrigin,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'X-Client',
    ],
  });

  // Hybrid app: HTTP for clients plus the NATS responders `telemetry` needs
  // (`auth.token.verify`). The app config is not inherited on purpose: the
  // HTTP filter must not answer NATS requests (responders bind their own).
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.NATS,
    options: {
      ...buildNatsOptions(envs.natsServers, envs.natsCreds),
      queue: 'core',
    },
  });
  await app.startAllMicroservices();

  await app.listen(envs.port);
  logger.log(`Core is running on: http://localhost:${envs.port}/api/v1`);
}
void bootstrap();
