import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { envs } from './config';

async function bootstrap() {
  const logger = new Logger('Telemetry');

  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1/telemetry');

  app.enableCors({
    origin: envs.webOrigin,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(envs.port);
  logger.log(`Telemetry service is running on: http://localhost:${envs.port}/api/v1/telemetry`);
}
void bootstrap();
