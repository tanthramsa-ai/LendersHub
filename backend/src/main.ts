import 'dotenv/config';
import { NestFactory, BaseExceptionFilter } from '@nestjs/core';
import { ValidationPipe, Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

// Returns the actual error message in the 500 body so we can debug without
// reading server logs.  Remove this filter once the issue is resolved.
@Catch()
class DebugAllExceptionsFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<any>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const message =
      exception instanceof HttpException
        ? exception.message
        : (exception as Error)?.message ?? 'Internal server error';

    this.logger.error(
      `[${status}] ${message}`,
      (exception as Error)?.stack,
    );

    response.status(status).json({
      statusCode: status,
      message,
      // Include stack in development so we can see it in the browser network tab
      ...(status >= 500 && { detail: (exception as Error)?.stack?.split('\n').slice(0, 6).join(' | ') }),
    });
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new DebugAllExceptionsFilter());

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Backend v3 (direct-query) running on http://localhost:${port}`);
}

bootstrap();
