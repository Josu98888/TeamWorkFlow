import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.config';
import { envs } from './config';

async function bootstrap() {
  const logger = new Logger('Core');

  const app = await NestFactory.create(AppModule);
  configureApp(app);

  await app.listen(envs.port);
  logger.log(`Core is running on: http://localhost:${envs.port}/api`);
}
void bootstrap();
