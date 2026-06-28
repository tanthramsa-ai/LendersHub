import { Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

// Maps Postgres error codes to HTTP responses without leaking internals.
const PG_CODE_MAP: Record<string, { status: number; message: string }> = {
  '22P02': { status: 400, message: 'Invalid ID format' },                     // invalid_text_representation (bad UUID)
  '23502': { status: 400, message: 'Missing required field' },                // not_null_violation
  '23503': { status: 400, message: 'Referenced record does not exist' },      // foreign_key_violation
  '23505': { status: 409, message: 'Record already exists' },                 // unique_violation
  '22003': { status: 400, message: 'Numeric value out of range' },            // numeric_value_out_of_range
  '2201W': { status: 400, message: 'Invalid pagination parameters' },         // invalid_row_count_in_limit_or_offset_clause
  '2201X': { status: 400, message: 'Invalid pagination parameters' },         // invalid_row_count_in_result_offset_clause
  '22P06': { status: 400, message: 'Invalid field value' },
  '22021': { status: 400, message: 'Invalid field value' },
  '22007': { status: 400, message: 'Invalid date format' },
  '22008': { status: 400, message: 'Date/time field value out of range' },
  '22P01': { status: 400, message: 'Floating point exception' },
  '21000': { status: 400, message: 'Invalid enum value' },
};

// Detect invalid enum errors from Postgres message text
function isPgEnumError(message: string) {
  return message?.includes('invalid input value for enum');
}

function isPgOffsetError(message: string) {
  return message?.includes('OFFSET') || message?.includes('LIMIT') || message?.includes('offset');
}

@Catch()
export class HttpExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<{ status: (code: number) => { json: (body: unknown) => void } }>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message =
        typeof res === 'object' && res !== null
          ? (res as Record<string, unknown>).message ?? exception.message
          : res;
      this.logger.warn(`[${status}] ${JSON.stringify(message)}`);
      response.status(status).json({ statusCode: status, message });
      return;
    }

    // Postgres / pg errors
    const pgError = exception as Record<string, unknown>;
    const pgCode = pgError?.code as string | undefined;
    const pgMessage = pgError?.message as string | undefined;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string = 'An unexpected error occurred';

    if (pgCode && PG_CODE_MAP[pgCode]) {
      ({ status, message } = PG_CODE_MAP[pgCode]);
    } else if (pgMessage && isPgEnumError(pgMessage)) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid field value';
    } else if (pgMessage && isPgOffsetError(pgMessage)) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid pagination parameters';
    }

    this.logger.error(
      `[${status}] pg:${pgCode ?? 'n/a'} ${pgMessage ?? (exception as Error)?.message}`,
      (exception as Error)?.stack,
    );

    response.status(status).json({ statusCode: status, message });
  }
}
