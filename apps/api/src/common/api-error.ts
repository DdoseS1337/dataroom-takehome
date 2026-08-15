import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * The frontend branches on `code`, never on message text — see docs/architecture.md.
 *
 * The first six are the contract's codes. The last four are generic and were added
 * here because every response needs one and the contract only names the codes the UI
 * branches on; they all fall through to the retryable error state on the client.
 */
export type ErrorCode =
  | 'NAME_CONFLICT'
  | 'NODE_GONE'
  | 'CYCLE_DETECTED'
  | 'FORBIDDEN'
  | 'SHARE_EXPIRED'
  | 'WRONG_ACCOUNT'
  | 'NOT_FOUND'
  | 'UNAUTHENTICATED'
  | 'VALIDATION_FAILED'
  | 'INTERNAL';

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    status: HttpStatus,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message, status);
  }

  /**
   * Unauthorised and nonexistent are the same response: a 403 would confirm the
   * resource exists. Nothing in this codebase should construct a 403 for a node.
   */
  static notFound(message = 'Not found'): ApiError {
    return new ApiError('NOT_FOUND', HttpStatus.NOT_FOUND, message);
  }

  static gone(message = 'This item was deleted by the owner'): ApiError {
    return new ApiError('NODE_GONE', HttpStatus.GONE, message);
  }

  /**
   * Only for a requester who can already read the item, so `403` discloses nothing a
   * `404` would have hidden. For anyone else the answer is `notFound()`.
   */
  static forbidden(
    message = 'You have read-only access to this item.',
  ): ApiError {
    return new ApiError('FORBIDDEN', HttpStatus.FORBIDDEN, message);
  }

  /**
   * `details` carries what the conflict dialog needs to offer the right choices —
   * notably `existingType`, because a file cannot replace a folder.
   */
  static nameConflict(
    name: string,
    details?: Record<string, unknown>,
  ): ApiError {
    return new ApiError(
      'NAME_CONFLICT',
      HttpStatus.CONFLICT,
      `An item named "${name}" already exists here.`,
      { name, ...details },
    );
  }

  /**
   * A move into the item itself or into one of its own descendants. Detected by prefix
   * comparison on `path` rather than by walking parents — see docs/data-model.md.
   */
  static cycleDetected(message: string): ApiError {
    return new ApiError('CYCLE_DETECTED', HttpStatus.BAD_REQUEST, message);
  }

  static invalid(message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError(
      'VALIDATION_FAILED',
      HttpStatus.BAD_REQUEST,
      message,
      details,
    );
  }
}
