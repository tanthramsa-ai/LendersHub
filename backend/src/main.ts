import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  // rawBody:true retains req.rawBody (Buffer) alongside the normally-parsed
  // body on every request — needed by the payment webhook controller to
  // verify a provider's HMAC signature against the exact bytes it sent
  // (re-serializing the parsed JSON would not reproduce an identical byte
  // sequence and would make every signature check fail).
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableCors({
    origin: [
      'https://app.lendershub.in',
      // Any tenant subdomain (e.g. acme.lendershub.in) — matches app/www too
      /^https:\/\/[a-z0-9-]+\.lendershub\.in$/,
      'https://lenders-hub.vercel.app',
      // Vercel preview/auto-suffixed deployments (e.g. lenders-hub-eight.vercel.app)
      /^https:\/\/lenders-hub[a-z0-9-]*\.vercel\.app$/,
      'http://localhost:3000',
      'http://localhost:3002', // .claude/launch.json's "lendershub-frontend" preview port
      'http://localhost:3010',
      'http://localhost:3020',
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
