'use strict';
class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status; this.code = code; this.fields = fields;
  }
}
const mk = (status, code, dflt) => (message, fields) => new HttpError(status, code, message || dflt, fields);
module.exports = {
  HttpError,
  badRequest: mk(400, 'bad_request', 'Bad request.'),
  unauthorized: mk(401, 'unauthorized', 'You must be logged in to do that.'),
  forbidden: mk(403, 'forbidden', 'You do not have permission to do that.'),
  notFound: mk(404, 'not_found', 'The requested item could not be found.'),
  conflict: mk(409, 'conflict', 'That conflicts with existing data.'),
  invalid: mk(422, 'validation_failed', 'Please correct the highlighted fields.'),
  tooMany: mk(429, 'rate_limited', 'You are doing that too often. Please wait a moment.'),
};
