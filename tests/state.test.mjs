import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getState,
  stateByChannel,
  trimHistory,
} from '../src/discord/state.mjs';
import { SYSTEM_PROMPT_VALUE } from '../src/config.mjs';

function resetState() {
  stateByChannel.clear();
}

test('getState seeds a system prompt and empty queue', () => {
  resetState();
  const st = getState('channel-1');
  assert.equal(st.history.length, 1);
  assert.equal(st.history[0].role, 'system');
  assert.equal(st.history[0].content, SYSTEM_PROMPT_VALUE);
  assert.deepEqual(st.queue, []);
  assert.equal(st.paused, false);
  assert.equal(st.processing, false);
});

test('getState returns the same object for the same channel', () => {
  resetState();
  const a = getState('channel-1');
  const b = getState('channel-1');
  assert.equal(a, b);
});

test('trimHistory keeps the system message and the last N entries', () => {
  const history = [
    { role: 'system', content: 'you are a bot' },
  ];
  for (let i = 0; i < 50; i++) {
    history.push({ role: 'user', content: `msg ${i}` });
  }
  trimHistory(history, 5);
  assert.equal(history.length, 6); // system + 5
  assert.equal(history[0].role, 'system');
  assert.equal(history[1].content, 'msg 45');
  assert.equal(history[5].content, 'msg 49');
});

test('trimHistory is a no-op when history fits within the limit', () => {
  const history = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
  ];
  trimHistory(history, 10);
  assert.equal(history.length, 3);
  assert.equal(history[2].content, 'b');
});

test('trimHistory with maxMessages=0 keeps only system', () => {
  const history = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
  ];
  trimHistory(history, 0);
  assert.equal(history.length, 1);
  assert.equal(history[0].role, 'system');
});
