/**
 * Exit codes are part of the CLI contract. Keep them stable.
 */
export const EXIT = Object.freeze({
  OK: 0,
  FAILURE: 1,
  USAGE: 2,
  UNAVAILABLE: 3,
  TIMEOUT: 4,
  BROWSER_MISSING: 5,
  BLOCKED: 6,
  THRESHOLD: 7,
  CONFLICT: 8,
});

export class CopycatError extends Error {
  /**
   * @param {string} message
   * @param {number} [exitCode]
   * @param {string} [hint]
   */
  constructor(message, exitCode = EXIT.FAILURE, hint = '') {
    super(message);
    this.name = 'CopycatError';
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

/**
 * Translate Playwright / network errors into stable Copycat errors.
 * @param {unknown} err
 * @param {string} url
 * @returns {CopycatError}
 */
export function classifyNavigationError(err, url) {
  if (err instanceof CopycatError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (/Timeout \d+ms exceeded|TimeoutError/i.test(msg)) {
    return new CopycatError(`Timed out loading ${url}`, EXIT.TIMEOUT, 'Increase --timeout or check that the page finishes loading.');
  }
  if (/ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_ADDRESS_UNREACHABLE|ERR_INTERNET_DISCONNECTED|ERR_UNSAFE_PORT|ERR_FILE_NOT_FOUND|NS_ERROR|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
    return new CopycatError(`Reference unavailable: ${url} (${firstLine(msg)})`, EXIT.UNAVAILABLE, 'Check the URL and that the server is running.');
  }
  if (/Executable doesn't exist|browserType\.launch|Failed to launch|Host system is missing dependencies/i.test(msg)) {
    return browserMissing(msg);
  }
  return new CopycatError(firstLine(msg), EXIT.FAILURE);
}

/** @param {string} detail */
export function browserMissing(detail) {
  return new CopycatError(
    `Chromium for Playwright is not available (${firstLine(detail)})`,
    EXIT.BROWSER_MISSING,
    'Run: npx playwright install chromium   (or: copycat doctor)',
  );
}

/** @param {string} s */
function firstLine(s) {
  return s.split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? s;
}
