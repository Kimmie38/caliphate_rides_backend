/** An error the API sends back to the app as { message, code } with an HTTP status. */
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message, code = "bad_request") => new HttpError(400, message, code);
export const unauthorized = (message = "Please sign in again.", code = "unauthorized") => new HttpError(401, message, code);
export const forbidden = (message = "You can't do that.", code = "forbidden") => new HttpError(403, message, code);
export const notFound = (message = "Not found.", code = "not_found") => new HttpError(404, message, code);
export const conflict = (message, code = "conflict") => new HttpError(409, message, code);
export const tooMany = (message, code = "too_many_requests") => new HttpError(429, message, code);

/**
 * An error from the payment provider (Flutterwave or Monnify). `reached` is true when the provider
 * answered and refused (so we know it didn't happen), false when it never answered (it may or may not
 * have gone through).
 */
export class PaymentProviderError extends HttpError {
  constructor(message, { reached, providerMessage, providerCode } = {}) {
    super(502, message, "payment_provider_error");
    this.reached = reached;
    this.providerMessage = providerMessage;
    this.providerCode = providerCode;
  }
}
