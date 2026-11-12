import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Host-side notification copy. The plugin-manager metadata stays in each
 * locale's `meta` object; only `copy` reaches the notification formatter.
 */
const CATALOGS = Object.freeze({
  zh: require('../locale/zh.json').copy,
  en: require('../locale/en.json').copy,
});

export const DEFAULT_LOCALE = 'zh';
export const SUPPORTED_LOCALES = Object.freeze(['auto', 'zh', 'en']);

/**
 * Normalize a configured locale. `auto` is resolved to the deterministic
 * fallback by `resolveLocale`; this function only validates the setting.
 * @param {unknown} value - raw `locale` config value.
 * @returns {'auto' | 'zh' | 'en'}
 */
export function normalizeLocale(value) {
  if (typeof value !== 'string') return 'auto';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'auto') return 'auto';
  if (normalized === 'zh' || normalized.startsWith('zh-') || normalized.startsWith('zh_')) return 'zh';
  if (normalized === 'en' || normalized.startsWith('en-') || normalized.startsWith('en_')) return 'en';
  return 'auto';
}

/**
 * Resolve `auto` without guessing from the browser: Host has no verified
 * language service, so the documented fallback is Chinese.
 * @param {unknown} value - raw config value.
 * @returns {'zh' | 'en'}
 */
export function resolveLocale(value) {
  const locale = normalizeLocale(value);
  return locale === 'en' ? 'en' : DEFAULT_LOCALE;
}

/** @param {unknown} value - raw config value. */
export function copyFor(value) {
  return CATALOGS[resolveLocale(value)];
}
