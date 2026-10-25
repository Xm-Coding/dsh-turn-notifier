import { basename } from 'node:path';

const DEFAULTS = Object.freeze({
  enabled: true,
  includeSubagents: false,
  includeMessage: true,
  notifyOnError: false,
  notifyOnCancel: false,
  title: 'DeepSeek Harness',
  soundName: 'Glass',
  maxCharacters: 240,
});

export function normalizeSettings(config = {}) {
  const requestedMax = Number(config.maxCharacters);
  return {
    enabled: config.enabled !== false,
    includeSubagents: config.includeSubagents === true,
    includeMessage: config.includeMessage !== false,
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

function statusFor(reason, settings) {
  switch (reason?.kind) {
    case 'completed':
      return { label: '本轮已完成', emptyBody: '本轮已完成。' };
    case 'max-tokens':
      return { label: '本轮已达输出上限', emptyBody: '模型已达到本轮输出上限。' };
    case 'error':
      return settings.notifyOnError
        ? { label: '本轮出错', emptyBody: '本轮出错，请回到 Harness 查看详情。' }
        : null;
    case 'aborted':
      return settings.notifyOnCancel
        ? { label: '本轮已停止', emptyBody: '本轮已停止。' }
        : null;
    default:
      return null;
  }
}

/** Build a Codex-style turn-complete notification from committed session state. */
export function buildTurnNotification(session, event, state, rawSettings = {}) {
  const settings = normalizeSettings(rawSettings);
  const reason = event.data?.reason;
  const status = statusFor(reason, settings);
  if (!status) return null;

  const turn = event.data?.turn;
  const hasFinalMessage = state?.turn === turn && state.hasMessage === true;
  const finalText = settings.includeMessage && hasFinalMessage
    ? normalizeText(state.lastText)
    : '';
  const errorText = reason?.kind === 'error' ? normalizeText(reason.error?.message) : '';
  const emptyBody = hasFinalMessage && settings.includeMessage && reason?.kind === 'completed'
    ? '本轮已完成，最终消息没有文本内容。'
    : status.emptyBody;
  const body = truncateText(finalText || errorText || emptyBody, settings.maxCharacters);

  const cwd = session.header?.cwd;
  const project = typeof cwd === 'string' && cwd ? basename(cwd) : '';
  return {
    title: settings.title,
    subtitle: project ? `${status.label} · ${project}` : status.label,
    body,
    soundName: settings.soundName,
  };
}
