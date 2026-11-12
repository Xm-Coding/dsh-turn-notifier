import { basename } from 'node:path';
import { copyFor, normalizeLocale } from './i18n.js';

const DEFAULTS = Object.freeze({
  enabled: true,
  includeSubagents: false,
  includeMessage: true,
  showSessionTitle: true,
  notifyOnError: false,
  notifyOnCancel: false,
  title: 'DeepSeek Harness',
  soundName: 'Glass',
  maxCharacters: 240,
  locale: 'auto',
});

export function normalizeSettings(config = {}) {
  const requestedMax = Number(config.maxCharacters);
  return {
    enabled: config.enabled !== false,
    includeSubagents: config.includeSubagents === true,
    includeMessage: config.includeMessage !== false,
    showSessionTitle: config.showSessionTitle !== false,
    notifyOnError: config.notifyOnError === true,
    notifyOnCancel: config.notifyOnCancel === true,
    title: typeof config.title === 'string' && config.title.trim()
      ? config.title.trim()
      : DEFAULTS.title,
    soundName: typeof config.soundName === 'string'
      ? config.soundName.trim()
      : DEFAULTS.soundName,
    maxCharacters: Number.isSafeInteger(requestedMax)
      ? Math.min(2000, Math.max(40, requestedMax))
      : DEFAULTS.maxCharacters,
    locale: normalizeLocale(config.locale),
  };
}

export function normalizeText(value) {
  return String(value ?? '')
    .replaceAll('\0', '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncateText(value, maxCharacters) {
  const characters = Array.from(value);
  if (characters.length <= maxCharacters) return value;
  return `${characters.slice(0, Math.max(1, maxCharacters - 1)).join('')}…`;
}

/** Longest session title shown in the subtitle, in Unicode code points. */
const SUBTITLE_TITLE_MAX = 60;

/**
 * Resolve the copy for one turn ending, or null when it must not notify.
 * `preview` names the only text the body may show when previews are on:
 * `reply` (final assistant text), `error` (the failure message), or `none`.
 * @param reason - the `turn/end` event's `reason`.
 * @param settings - output of `normalizeSettings`.
 */
export function turnStatus(reason, settings) {
  const copy = copyFor(settings.locale).status;
  switch (reason?.kind) {
    case 'completed':
      return { ...copy.completed, preview: 'reply' };
    case 'max-tokens':
      return { ...copy.maxTokens, preview: 'reply' };
    case 'error':
      return settings.notifyOnError
        ? { ...copy.error, preview: 'error' }
        : null;
    case 'aborted': {
      if (!settings.notifyOnCancel) return null;
      const cause = reason.reason?.kind;
      if (cause === 'disposed') return null;
      const aborted = Object.hasOwn(copy.aborted, cause) ? copy.aborted[cause] : copy.aborted.generic;
      return { ...aborted, preview: 'none' };
    }
    default:
      return null;
  }
}

function subtitleContext(session, presentation, settings) {
  const title = settings.showSessionTitle ? normalizeText(presentation?.title).replace(/\n+/g, ' ') : '';
  if (title) return truncateText(title, SUBTITLE_TITLE_MAX);
  const directory = presentation?.directory ?? session.header?.cwd;
  return typeof directory === 'string' && directory ? basename(directory) : '';
}

/**
 * Build a Codex-style turn-complete notification.
 * @param session - the session whose turn ended.
 * @param event - its `turn/end` event.
 * @param state - `{ turn, hasMessage, lastText }` for the turn's final
 *   assistant message, or null when its text is unknown or not needed.
 * @param rawSettings - plugin config (normalized here).
 * @param presentation - `{ title?, directory? }` from `readSessionPresentation`;
 *   the subtitle shows the session title, else the directory's last segment.
 * @returns the notification, or null when this ending must not notify.
 */
export function buildTurnNotification(session, event, state, rawSettings = {}, presentation = undefined) {
  const settings = normalizeSettings(rawSettings);
  const reason = event.data?.reason;
  const status = turnStatus(reason, settings);
  if (!status) return null;

  const turn = event.data?.turn;
  const hasFinalMessage = state?.turn === turn && state.hasMessage === true;
  // Assistant text in an errored or stopped turn is usually an intermediate
  // step ("let me check…"), so only finished turns may show it. With previews
  // off, no branch reads assistant text or error details.
  let preview = '';
  if (settings.includeMessage) {
    if (status.preview === 'reply' && hasFinalMessage) preview = normalizeText(state.lastText);
    else if (status.preview === 'error') preview = normalizeText(reason.error?.message);
  }
  const emptyBody = settings.includeMessage && hasFinalMessage && reason.kind === 'completed'
    ? copyFor(settings.locale).completedWithoutText
    : status.emptyBody;
  const body = truncateText(preview || emptyBody, settings.maxCharacters);

  const context = subtitleContext(session, presentation, settings);
  return {
    title: settings.title,
    subtitle: context ? `${status.label} · ${context}` : status.label,
    body,
    soundName: settings.soundName,
  };
}
