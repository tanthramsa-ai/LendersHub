import { Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

const COLUMN_LABELS: Record<string, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  email: 'Email',
  phone: 'Phone number',
  pan_number: 'PAN number',
  aadhaar_last4: 'Aadhaar last 4 digits',
  aadhaar_doc_url: 'Aadhaar document',
  date_of_birth: 'Date of birth',
  address: 'Address',
  locality: 'Locality',
  city: 'City',
  state: 'State',
  pincode: 'Pincode',
  occupation: 'Occupation',
  loan_purpose: 'Reason for loan',
  alt_contact: 'Alternate contact number',
  alt_contact_name: 'Alternate contact name',
  alt_contact_relation: 'Alternate contact relation',
  interest_rate: 'Interest rate',
  principal: 'Principal',
  credit_score: 'Credit score',
  branch_id: 'Branch',
  customer_code: 'Customer code',
  created_by: 'Created by',
};

function columnLabel(column?: string | null): string {
  if (!column) return 'Field';
  return COLUMN_LABELS[column] ?? column.replace(/_/g, ' ');
}

function uniqueFieldFromDetail(detail?: string | null): string | null {
  if (!detail) return null;
  const match = detail.match(/Key \(([^)]+)\)=/);
  if (!match) return null;
  return columnLabel(match[1].split(',')[0].trim());
}

// Maps Postgres error codes to HTTP responses without leaking internals.
const PG_CODE_MAP: Record<string, { status: number; message: string }> = {
  '22P02': { status: 400, message: 'Invalid ID format' },                     // invalid_text_representation (bad UUID)
  '23503': { status: 400, message: 'Referenced record does not exist' },      // foreign_key_violation
  '2201W': { status: 400, message: 'Invalid pagination parameters' },         // invalid_row_count_in_limit_or_offset_clause
  '2201X': { status: 400, message: 'Invalid pagination parameters' },         // invalid_row_count_in_result_offset_clause
  '22P06': { status: 400, message: 'Invalid field value' },
  '22021': { status: 400, message: 'Invalid field value' },
  '22007': { status: 400, message: 'Invalid date format' },
  '22008': { status: 400, message: 'Date/time field value out of range' },
  '22P01': { status: 400, message: 'Floating point exception' },
  '21000': { status: 400, message: 'Invalid enum value' },
};

function messageForPgError(
  pgCode: string | undefined,
  pgMessage: string | undefined,
  column: string | undefined,
  detail: string | undefined,
): { status: number; message: string } | null {
  if (pgCode === '23502') {
    return { status: 400, message: `${columnLabel(column)} is required` };
  }
  if (pgCode === '23505') {
    const field = uniqueFieldFromDetail(detail) ?? columnLabel(column);
    return { status: 409, message: `${field} already exists` };
  }
  if (pgCode === '22001') {
    // string_data_right_truncation — e.g. CHAR(4) / CHAR(6) length mismatch
    const label = columnLabel(column);
    if (pgMessage?.includes('character(4)')) {
      return { status: 400, message: `${label} must be exactly 4 characters` };
    }
    if (pgMessage?.includes('character(6)')) {
      return { status: 400, message: `${label} must be exactly 6 characters` };
    }
    return { status: 400, message: `${label} value is too long` };
  }
  if (pgCode === '22003') {
    // numeric_value_out_of_range
    if (column === 'interest_rate' || pgMessage?.includes('interest_rate')) {
      return { status: 400, message: 'Interest rate is out of range (max 200% p.a.)' };
    }
    if (column) {
      return { status: 400, message: `${columnLabel(column)} is out of range` };
    }
    return { status: 400, message: 'Numeric value out of range' };
  }
  if (pgCode && PG_CODE_MAP[pgCode]) {
    return PG_CODE_MAP[pgCode];
  }
  if (pgMessage?.includes('invalid input value for enum')) {
    return { status: 400, message: 'Invalid field value' };
  }
  if (pgMessage && (pgMessage.includes('OFFSET') || pgMessage.includes('LIMIT') || pgMessage.includes('offset'))) {
    return { status: 400, message: 'Invalid pagination parameters' };
  }
  return null;
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
      let message: string | string[] =
        typeof res === 'object' && res !== null
          ? ((res as Record<string, unknown>).message as string | string[]) ?? exception.message
          : (res as string);
      // Nest ValidationPipe returns message as string[]; flatten for clients
      // that display Error.message directly.
      if (Array.isArray(message)) {
        message = message.join('; ');
      }
      this.logger.warn(`[${status}] ${JSON.stringify(message)}`);
      response.status(status).json({ statusCode: status, message });
      return;
    }

    // Postgres / pg errors
    const pgError = exception as Record<string, unknown>;
    const pgCode = pgError?.code as string | undefined;
    const pgMessage = pgError?.message as string | undefined;
    const pgColumn = pgError?.column as string | undefined;
    const pgDetail = pgError?.detail as string | undefined;

    const mapped = messageForPgError(pgCode, pgMessage, pgColumn, pgDetail);
    const status = mapped?.status ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const message = mapped?.message ?? 'An unexpected error occurred';

    this.logger.error(
      `[${status}] pg:${pgCode ?? 'n/a'} col:${pgColumn ?? 'n/a'} ${pgMessage ?? (exception as Error)?.message}`,
      (exception as Error)?.stack,
    );

    response.status(status).json({ statusCode: status, message });
  }
}
