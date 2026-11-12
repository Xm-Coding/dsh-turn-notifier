/**
 * Log-safe error summaries.
 *
 * An Error's message is never logged: a failed `execFile` puts the full command
 * line, including the notification body, into `message` and `cmd`, and its
 * `stderr` can echo the same text. Only fields drawn from fixed vocabularies
 * (error class names, Node error codes, exit codes, signal names) are kept.
 */

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const CONSTANT_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

function identifier(value, pattern) {
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

/**
 * Summarize an error for logs without its message, command line, or output.
 * @param {unknown} error - anything thrown or rejected.
 * @returns {string} e.g. `exit-code=1`, `timeout signal=SIGTERM`, `code=ENOENT`.
 */
export function describeError(error) {
  if (typeof error !== 'object' || error === null) return 'non-error-value';

  const parts = [];
  if (error.killed === true) parts.push('timeout');
  if (Number.isSafeInteger(error.code)) parts.push(`exit-code=${error.code}`);
  const code = identifier(error.code, CONSTANT_CODE);
  if (code !== undefined) parts.push(`code=${code}`);
  const signal = identifier(error.signal, CONSTANT_CODE);
  if (signal !== undefined) parts.push(`signal=${signal}`);
  if (parts.length > 0) return parts.join(' ');

  return `error=${identifier(error.name, IDENTIFIER) ?? 'unknown'}`;
}
