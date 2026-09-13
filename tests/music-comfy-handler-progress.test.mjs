import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMusicJobComfy } from '../src/music/comfy.mjs';

test('ComfyUI ACE-Step forwards client ID, shows sampler progress and closes after delivery', async () => {
  let time = 0, hooks, closed = 0, submissions = 0;
  const edits = [];
  const client = {
    openProgress: async options => {
      hooks = options; options.onConnection(true);
      return { clientId: 'ace-client', setPromptId: id => assert.equal(id, 'ace-id'), close() { closed++; } };
    },
    submit: async (workflow, options) => { submissions++; assert.equal(options.clientId, 'ace-client'); assert.equal(workflow['3'].inputs.steps, 8); return 'ace-id'; },
    history: async () => {
      hooks.onEvent({ type: 'executing', data: { node: '3' } });
      hooks.onEvent({ type: 'progress', data: { node: '3', value: 4, max: 8 } });
      return time < 12000 ? {} : { 'ace-id': { status: { completed: true }, outputs: { save: { audio: [{ filename: 'ace.mp3', type: 'output' }] } } } };
    },
    audio: async () => Buffer.from('mp3'),
  };
  await handleMusicJobComfy({ prompt: 'song', durationSec: 120, interaction: { editReply: async p => edits.push(p) } }, {
    client, now: () => time, sleepImpl: async () => { time += 6000; },
    loadTemplate: () => ({ '3': { class_type: 'KSampler', inputs: {} } }), timingHistory: null,
  });
  assert.equal(submissions, 1); assert.equal(closed, 1);
  assert.ok(edits.some(p => p.content?.includes('4 / 8ステップ・50%')));
  assert.match(edits.at(-1).content, /音楽の生成が完了/); assert.equal(edits.at(-1).files.length, 1);
});

test('ComfyUI ACE closes progress after error without delivering or resubmitting', async () => {
  let closed = 0, time = 0, submits = 0;
  const client = {
    openProgress: async () => ({ clientId: 'c', setPromptId() {}, close() { closed++; } }),
    submit: async () => { submits++; return 'id'; },
    history: async () => ({ id: { status: { status_str: 'error' } } }),
  };
  const edits = [];
  await assert.rejects(handleMusicJobComfy({ prompt: 'p', durationSec: 120, interaction: { editReply: async p => edits.push(p) } }, {
    client, now: () => time, sleepImpl: async () => { time += 1000; }, loadTemplate: () => ({}), timingHistory: null,
  }), /execution failed/);
  assert.equal(closed, 1); assert.equal(submits, 1); assert.ok(!edits.some(p => p.files));
});
