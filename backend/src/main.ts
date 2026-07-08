import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: [
      'https://app.lendershub.in',
      'https://lenders-hub.vercel.app',
      // Vercel preview/auto-suffixed deployments (e.g. lenders-hub-eight.vercel.app)
      /^https:\/\/lenders-hub[a-z0-9-]*\.vercel\.app$/,
      'http://localhost:3000',
    ],
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Backend v3 (direct-query) running on http://localhost:${port}`);
}

bootstrap();
