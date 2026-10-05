import { Alert } from 'react-native';

const NETWORK_MESSAGE = 'Unable to connect. Please check your internet connection and try again.';
const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

const HTTP_PREFIX = /^\s*(?:Error:\s*)?\[HTTP\s+\d+\]\s+\S+:\s*/i;
const URL_OR_PATH = /https?:\/\/|\/api\/|\bBase URL\b|\/v1\//i;

const pickFromObject = (obj) => {
  if (!obj || typeof obj !== 'object') return '';
  const value = obj.error || obj.detail || obj.message || obj.non_field_errors;
  if (Array.isArray(value)) return String(value[0] || '');
  if (value && typeof value === 'object') return pickFromObject(value);
  return typeof value === 'string' ? value : '';
};

const isTechnical = (text) =>
  HTTP_PREFIX.test(text) ||
  /Network request failed for/i.test(text) ||
  /Failed to parse response/i.test(text) ||
  URL_OR_PATH.test(text) ||
  /^\s*[{[]/.test(text);

// Never lets endpoints, URLs or raw JSON reach the user.
export function sanitizeErrorMessage(input, fallback = GENERIC_MESSAGE) {
  if (input === null || input === undefined) return fallback;
  if (typeof input === 'object') {
    input = pickFromObject(input) || pickFromObject(input.data) || input.message || '';
  }
  let text = String(input);
  if (!text.trim()) return fallback;
  if (!isTechnical(text)) return text;

  if (/Network request failed for/i.test(text)) return NETWORK_MESSAGE;

  text = text.replace(HTTP_PREFIX, '').trim();
  if (/^[{[]/.test(text)) {
    try {
      text = pickFromObject(JSON.parse(text)) || '';
    } catch (e) {
      text = '';
    }
  }
  if (!text || /Failed to parse response/i.test(text) || URL_OR_PATH.test(text) || /^[{[]/.test(text)) {
    return fallback;
  }
  return text;
}

if (!Alert.__errorSanitizerInstalled) {
  const originalAlert = Alert.alert.bind(Alert);
  Alert.alert = (title, message, ...rest) =>
    originalAlert(
      title,
      typeof message === 'string' && isTechnical(message) ? sanitizeErrorMessage(message) : message,
      ...rest,
    );
  Alert.__errorSanitizerInstalled = true;
}
