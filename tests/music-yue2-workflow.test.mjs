import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildYue2Workflow,
  parseYue2HistoryResult,
  YUE2_MAX_DURATION_SEC,
} from '../src/music/yue2-workflow.mjs';

function buildSample(overrides = {}) {
  return buildYue2Workflow({
    prompt: 'warm piano pop with an expressive vocal',
    lyrics: '[Verse]\nMorning light across the room',
    durationSec: 120,
    language: 'en',
    bpm: 90,
    seed: 100,
    filenamePrefix: 'audio/yue2/test_sample',
    ...overrides,
  });
}

function validHistory(overrides = {}) {
  const metadata = {
    actualDurationSec: 97.52,
    targetDurationSec: 120,
    maxDurationSec: 360,
    frames: 2438,
    truncated: false,
    abcNonempty: true,
    metadataAvailable: true,
    status: 'ok',
    ...overrides.metadata,
  };
  return {
    prompt_yue2: {
      status: { status_str: 'success', completed: true, messages: [] },
      outputs: {
        save_mp3: {
          audio: [{ filename: 'audio/yue2/test_sample_mp3_00001.mp3', subfolder: '', type: 'output' }],
        },
        save_flac: {
          audio: [{ filename: 'audio/yue2/test_sample_flac_00001.flac', subfolder: '', type: 'output' }],
        },
        result_metadata: { yue2_result: [metadata] },
      },
      ...overrides,
    },
  };
}

test('YuE2 workflow keeps the pinned full-mode generation settings', () => {
  const workflow = buildSample();

  assert.equal(workflow.checkpoint.class_type, 'CheckpointLoaderSimple');
  assert.equal(workflow.checkpoint.inputs.ckpt_name, 'yue2_3b_bf16.safetensors');
  assert.equal(workflow.abc.inputs.mode, 'full');
  assert.equal(workflow.abc.inputs.max_abc_tokens, 8192);
  assert.equal(workflow.music.inputs.mode, 'full');
  assert.equal(workflow.music.inputs.max_duration, 360);
  assert.equal(workflow.sampler.inputs.steps, 32);
  assert.equal(workflow.sampler.inputs.cfg, 1.0);
  assert.equal(workflow.sampler.inputs.sampler_name, 'dpm_2');
  assert.equal(workflow.sampler.inputs.scheduler, 'sgm_uniform');
  assert.equal(workflow.decode.inputs.tile_size, 1920);
  assert.equal(workflow.decode.inputs.overlap, 128);
  assert.equal(workflow.latent.inputs.batch_size, 1);
});

test('requested duration is guidance and generated EOS controls the latent length', () => {
  const workflow = buildSample({ durationSec: 45, maxDurationSec: 300 });
  assert.match(workflow.music.inputs.style, /approximately 45 seconds/);
  assert.match(workflow.music.inputs.style, /allow a natural ending/);
  assert.deepEqual(workflow.latent.inputs.seconds, ['music', 1]);
  assert.equal(workflow.music.inputs.max_duration, 300);
});

test('workflow emits both MP3 and FLAC and exposes result_metadata', () => {
  const workflow = buildSample();
  assert.equal(workflow.save_mp3.class_type, 'SaveAudioAdvanced');
  assert.equal(workflow.save_mp3.inputs.format, 'mp3');
  assert.equal(workflow.save_mp3.inputs['format.quality'], '128k');
  assert.equal(workflow.save_flac.class_type, 'SaveAudioAdvanced');
  assert.equal(workflow.save_flac.inputs.format, 'flac');
  assert.equal(workflow.result_metadata.class_type, 'DiscordYuE2Result');
  assert.deepEqual(workflow.result_metadata.inputs.conditioning, ['music', 0]);
  assert.equal(workflow.result_metadata.inputs.target_duration_sec, 120);
  assert.equal(workflow.result_metadata.inputs.max_duration_sec, 360);
  assert.match(workflow.save_mp3.inputs.filename_prefix, /^[a-z0-9_./-]+$/i);
});

test('default filename prefixes are locally unique and safe', () => {
  const first = buildYue2Workflow({ prompt: 'test', durationSec: 20, seed: 1 });
  const second = buildYue2Workflow({ prompt: 'test', durationSec: 20, seed: 1 });
  assert.notEqual(first.save_mp3.inputs.filename_prefix, second.save_mp3.inputs.filename_prefix);
  assert.match(first.save_mp3.inputs.filename_prefix, /^audio\/yue2\/discord_yue2_[a-z0-9_-]+_mp3$/i);
  assert.doesNotMatch(first.save_mp3.inputs.filename_prefix, /\.\./);
});

test('workflow validates target and hard cap, including the 360-second ceiling', () => {
  assert.throws(() => buildYue2Workflow({ prompt: 'x', durationSec: 0 }), /durationSec/);
  assert.throws(() => buildYue2Workflow({ prompt: 'x', durationSec: 121, maxDurationSec: 120 }), /durationSec.*maxDurationSec/);
  assert.throws(() => buildYue2Workflow({ prompt: 'x', durationSec: 120, maxDurationSec: YUE2_MAX_DURATION_SEC + 0.04 }), /must not exceed 360/);
  assert.throws(() => buildYue2Workflow({ prompt: 'x', durationSec: 20, maxDurationSec: 20, filenamePrefix: '../outside' }), /filenamePrefix/);
  assert.throws(() => buildYue2Workflow({ prompt: 'x', durationSec: 20, filenamePrefix: '/outside' }), /filenamePrefix/);
});

test('unfinished history remains pending, while terminal execution failures throw', () => {
  assert.equal(parseYue2HistoryResult({ prompt_yue2: { status: { completed: false }, outputs: {} } }, 'prompt_yue2'), null);
  assert.throws(
    () => parseYue2HistoryResult({ prompt_yue2: { status: { status_str: 'error', completed: true }, outputs: {} } }, 'prompt_yue2'),
    error => error.code === 'YUE2_EXECUTION_FAILED',
  );
  assert.throws(
    () => parseYue2HistoryResult({ prompt_yue2: { status: { status_str: 'success', completed: true, messages: [['execution_interrupted', {}]] }, outputs: {} } }, 'prompt_yue2'),
    error => error.code === 'YUE2_EXECUTION_FAILED',
  );
  assert.throws(
    () => parseYue2HistoryResult({ prompt_yue2: { execution_error: true, outputs: {} } }, 'prompt_yue2'),
    error => error.code === 'YUE2_EXECUTION_FAILED',
  );
});

test('parser strictly matches a supplied prompt id', () => {
  assert.equal(parseYue2HistoryResult(validHistory(), 'different-prompt'), null);
  assert.equal(parseYue2HistoryResult({}, 'prompt_yue2'), null);
});

test('completed history returns only the strictly selected MP3 and metadata', () => {
  const result = parseYue2HistoryResult(validHistory(), 'prompt_yue2');
  assert.deepEqual(result, {
    audio: { filename: 'audio/yue2/test_sample_mp3_00001.mp3', subfolder: '', type: 'output' },
    actualDurationSec: 97.52,
    targetDurationSec: 120,
    maxDurationSec: 360,
    frames: 2438,
    truncated: false,
    abcNonempty: true,
    metadataAvailable: true,
  });
});

test('parser fails closed for absent or invalid metadata and empty ABC', () => {
  assert.throws(() => parseYue2HistoryResult(validHistory({
    outputs: { save_mp3: { audio: [{ filename: 'song.mp3' }] } },
  }), 'prompt_yue2'), /metadata is missing/);
  assert.throws(() => parseYue2HistoryResult(validHistory({ metadata: { metadataAvailable: false } }), 'prompt_yue2'), /metadata is unavailable/);
  assert.throws(() => parseYue2HistoryResult(validHistory({ metadata: { abcNonempty: false } }), 'prompt_yue2'), /ABC score is missing/);
  assert.throws(() => parseYue2HistoryResult(validHistory({ metadata: { truncated: 'false' } }), 'prompt_yue2'), /truncation metadata is invalid/);
  assert.throws(() => parseYue2HistoryResult(validHistory({ metadata: { frames: 0 } }), 'prompt_yue2'), /frame metadata is invalid/);
  assert.throws(() => parseYue2HistoryResult(validHistory({ metadata: { actualDurationSec: 100 } }), 'prompt_yue2'), /duration and frame metadata disagree/);
  assert.throws(() => parseYue2HistoryResult(validHistory({ metadata: { targetDurationSec: 361 } }), 'prompt_yue2'), /target duration exceeds/);
});

test('parser rejects a FLAC-only or non-MP3 save output', () => {
  const history = validHistory();
  history.prompt_yue2.outputs.save_mp3.audio = [{ filename: 'audio/yue2/test_sample_flac_00001.flac' }];
  assert.throws(() => parseYue2HistoryResult(history, 'prompt_yue2'), /MP3 output is missing/);
});
