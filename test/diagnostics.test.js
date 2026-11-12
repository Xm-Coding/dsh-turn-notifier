import test from 'node:test';
import assert from 'node:assert/strict';
import { describeError } from '../lib/diagnostics.js';

const SENTINEL = 'SENTINEL-日志-41be';

test('messages, commands and output never reach the summary', () => {
  const error = Object.assign(new Error(`Command failed: applet t s ${SENTINEL}`), {
    code: 1,
    cmd: `applet t s ${SENTINEL}`,
    stdout: SENTINEL,
    stderr: SENTINEL,
    spawnargs: [SENTINEL],
  });
  assert.equal(describeError(error), 'exit-code=1');
});

test('known fields are combined', () => {
  assert.equal(describeError({ killed: true, code: null, signal: 'SIGTERM' }), 'timeout signal=SIGTERM');
  assert.equal(describeError({ code: 'ENOENT' }), 'code=ENOENT');
  assert.equal(describeError({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }), 'code=ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
});

test('free-form values fall back to the error class name', () => {
  assert.equal(describeError(new TypeError(SENTINEL)), 'error=TypeError');
  assert.equal(describeError(Object.assign(new Error('x'), { code: SENTINEL, signal: SENTINEL })), 'error=Error');
  assert.equal(describeError(Object.assign(new Error('x'), { name: `Bad ${SENTINEL}` })), 'error=unknown');
  assert.equal(describeError(SENTINEL), 'non-error-value');
  assert.equal(describeError(undefined), 'non-error-value');
});
