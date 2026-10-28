import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.config';
import { envs } from './config';

async function bootstrap() {
  const logger = new Logger('Telemetry');

  const app = await NestFactory.create(AppModule);

  configureApp(app);

  app.enableCors({
    origin: envs.webOrigin,
    credentials: true,
  });

  await app.listen(envs.port);
  logger.log(
    `Telemetry service is running on: http://localhost:${envs.port}/api/v1/telemetry`,
  );
}
void bootstrap();
