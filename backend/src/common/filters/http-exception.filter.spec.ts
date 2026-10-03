import { ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as unknown as ArgumentsHost;
  new HttpExceptionFilter().catch(exception, host);
  return { status: status.mock.calls[0][0] as number, body: json.mock.calls[0][0] as { statusCode: number; message: string } };
}

describe('HttpExceptionFilter body-parser errors', () => {
  it('turns an oversized body into 413 with the limit, not a generic 500', () => {
    const { status, body } = run(Object.assign(new Error('request entity too large'), { type: 'entity.too.large', limit: 30 * 1024 * 1024 }));
    expect(status).toBe(413);
    expect(body.message).toContain('30 MB');
  });

  it('turns malformed JSON into 400', () => {
    const { status, body } = run(Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed' }));
    expect(status).toBe(400);
    expect(body.message).toBe('Request body is not valid JSON');
  });

  it('still reports unknown errors as 500 without leaking details', () => {
    const { status, body } = run(new Error('secret internals'));
    expect(status).toBe(500);
    expect(body.message).toBe('An unexpected error occurred');
  });
});
