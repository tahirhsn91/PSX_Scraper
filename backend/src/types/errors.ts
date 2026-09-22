/** Base application error mapped to HTTP responses by the error middleware. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details?: unknown) {
    super('NOT_FOUND', message, 404, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists', details?: unknown) {
    super('CONFLICT', message, 409, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

// ---- Scraper error taxonomy ----
export class ScraperError extends AppError {
  constructor(code: string, message: string, public readonly transient: boolean, details?: unknown) {
    super(code, message, 502, details);
  }
}
export class SiteUnavailableError extends ScraperError {
  constructor(source: string, details?: unknown) {
    super('SITE_UNAVAILABLE', `Source site unavailable: ${source}`, true, details);
  }
}
export class NavigationTimeoutError extends ScraperError {
  constructor(source: string, details?: unknown) {
    super('NAVIGATION_TIMEOUT', `Navigation timed out: ${source}`, true, details);
  }
}
export class InvalidSymbolError extends ScraperError {
  constructor(symbol: string) {
    super('INVALID_SYMBOL', `Symbol not found or invalid: ${symbol}`, false);
  }
}
export class ParseError extends ScraperError {
  constructor(source: string, selector: string) {
    super('PARSE_ERROR', `Failed to parse ${source} (selector: ${selector})`, false, { selector });
  }
}
export class RateLimitedError extends ScraperError {
  constructor(source: string) {
    super('RATE_LIMITED', `Rate limited by ${source}`, true);
  }
}
/**
 * The source is in its back-off window (`utils/sourceBreaker.ts`), so no request was sent.
 * Raised *before* the network call: it means "we are deliberately not asking", which is not
 * the same failure as the source refusing a request we did send.
 */
export class SourceCoolingDownError extends ScraperError {
  constructor(
    public readonly source: string,
    public readonly resumeAt: Date,
  ) {
    super('SOURCE_COOLING_DOWN', `Source cooling down: ${source} (retry after ${resumeAt.toISOString()})`, true, {
      source,
      resumeAt: resumeAt.toISOString(),
    });
  }
}
