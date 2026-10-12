/**
 * Redaction for everything Copycat writes to disk. Reference pages are
 * untrusted and may contain personal data or secrets; reports must not.
 */

const SENSITIVE_PARAM = /^(token|access_token|id_token|refresh_token|auth|authorization|code|session|sessionid|sid|key|api_key|apikey|secret|password|passwd|pwd|signature|sig|jwt|otp|email|phone|ssn)$/i;

/** @type {Array<[RegExp, string]>} */
const PATTERNS = [
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED:jwt]'],
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}\b/g, '[REDACTED:key]'],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED:key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED:key]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED:key]'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[REDACTED:key]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED:key]'],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/-]{12,}=*/gi, '$1 [REDACTED]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED:email]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[REDACTED:number]'],
];

/**
 * @param {string} text
 * @returns {string}
 */
export function redactText(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

/**
 * Strip credentials and sensitive query parameters from a URL string.
 * @param {string} href
 * @returns {string}
 */
export function redactUrl(href) {
  if (typeof href !== 'string' || !href) return href;
  if (href.startsWith('data:')) return `data:[${href.length} chars omitted]`;
  let u;
  try {
    u = new URL(href);
  } catch {
    return redactText(href);
  }
  if (u.username || u.password) {
    u.username = '';
    u.password = '';
  }
  for (const key of [...u.searchParams.keys()]) {
    if (SENSITIVE_PARAM.test(key)) u.searchParams.set(key, 'REDACTED');
  }
  if (u.hash && /(access_token|id_token|token)=/i.test(u.hash)) u.hash = '#REDACTED';
  return redactText(u.toString());
}

/**
 * Deep-redact any JSON-compatible value. Keys that look like secrets have
 * their values removed entirely.
 * @param {any} value
 * @returns {any}
 */
export function redactDeep(value) {
  if (typeof value === 'string') return /^(https?|file):/i.test(value) ? redactUrl(value) : redactText(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/^(cookie|cookies|set-cookie|authorization|password|passwd|secret|token|localStorage|sessionStorage|storageState)$/i.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactDeep(v);
      }
    }
    return out;
  }
  return value;
}

const INJECTION = [
  /ignore (all |any )?(previous|prior|above) (instructions|prompts)/i,
  /disregard (all |the )?(previous|prior|system) (instructions|prompt)/i,
  /you are (now )?(an? )?(ai|assistant|agent|language model)\b/i,
  /\b(system prompt|developer message)\b/i,
  /\b(run|execute) (this|the following) (command|shell|script)/i,
  /\b(curl|wget)\s+https?:\/\/\S+\s*\|\s*(sh|bash)/i,
  /\bexfiltrate|send (your|the) (api key|credentials|token)/i,
];

/**
 * Detect text that looks like instructions aimed at an AI agent. Such text
 * is reported, never followed.
 * @param {string} text
 * @returns {string[]}
 */
export function findPromptInjection(text) {
  if (!text) return [];
  const hits = [];
  for (const re of INJECTION) {
    const m = text.match(re);
    if (m) hits.push(m[0]);
  }
  return hits;
}
