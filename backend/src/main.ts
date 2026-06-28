import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Backend v3 (direct-query) running on http://localhost:${port}`);
}

bootstrap();
