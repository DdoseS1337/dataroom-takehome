import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiError, type ApiErrorBody, type ErrorCode } from './api-error';

/**
 * Every error leaves the API as `{ code, message, details? }`. Without this, Nest's
 * built-in exceptions and anything thrown outside a controller would serialise in
 * three different shapes and the frontend would end up matching on message text.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ApiError) {
      response.status(exception.getStatus()).json({
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      } satisfies ApiErrorBody);
      return;
    }

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(fromHttpException(exception));
      return;
    }

    // An unrecognised throw is a bug on this side. Log it whole, tell the client
    // nothing: an internal message can carry a query, a path, or a token.
    this.logger.error(exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL',
      message: 'Something went wrong. Please try again.',
    } satisfies ApiErrorBody);
  }
}

function fromHttpException(exception: HttpException): ApiErrorBody {
  const status = exception.getStatus();
  const payload = exception.getResponse();
  const code = codeForStatus(status);

  // ValidationPipe puts its per-field messages in `message` as an array. Keeping them
  // in `details` leaves `message` a single human-readable string at every status.
  if (
    typeof payload === 'object' &&
    payload !== null &&
    Array.isArray((payload as { message?: unknown }).message)
  ) {
    const fields = (payload as { message: string[] }).message;
    return {
      code,
      message: fields[0] ?? 'The request was not valid.',
      details: { fields },
    };
  }

  return { code, message: exception.message };
}

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'NAME_CONFLICT',
  [HttpStatus.GONE]: 'NODE_GONE',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_FAILED',
};

function codeForStatus(status: number): ErrorCode {
  return CODE_BY_STATUS[status] ?? 'INTERNAL';
}
