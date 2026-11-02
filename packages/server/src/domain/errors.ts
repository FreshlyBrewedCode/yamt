/** An error with an HTTP status; the API turns it into `{ error, hint? }`. */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 500 | 503,
    message: string,
    /** Points at what fixes it, e.g. a config key. */
    readonly hint?: string,
  ) {
    super(message);
  }
}
