import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

const CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_ERROR',
  429: 'TOO_MANY_REQUESTS',
};

/** Every error leaves the API in one shape: { error: { code, message, fields? } } (docs, section 10). */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private log = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as string | { code?: string; message?: string | string[]; fields?: Record<string, string> };
      const message = typeof body === 'string' ? body : Array.isArray(body.message) ? body.message[0] : body.message;
      return res.status(status).json({
        error: {
          code: (typeof body === 'object' && body.code) || CODES[status] || 'ERROR',
          message: status === 429 ? "Juda ko'p urinish. Birozdan keyin qayta urinib ko'ring." : message ?? exception.message,
          ...(typeof body === 'object' && body.fields ? { fields: body.fields } : {}),
        },
      });
    }
    this.log.error(exception instanceof Error ? exception.stack : String(exception));
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: { code: 'INTERNAL_ERROR', message: "Serverda xatolik yuz berdi." } });
  }
}
