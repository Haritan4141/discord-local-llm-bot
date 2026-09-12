import test from 'node:test';
import assert from 'node:assert/strict';
import { OthelloService } from '../src/othello/game.mjs';
import { countPieces, getLegalMoves } from '../src/othello/board.mjs';
import { buildOthelloView, componentId, movePage } from '../src/othello/view.mjs';
import { coordinate, snapshotGame } from '../src/othello/state.mjs';
import { chooseAiMoveAsync } from '../src/othello/ai-client.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const parseBoard = text => text.split('/').map(row => [...row].map(Number));

function harness(t, options = {}) {
  const edits = [], sends = [], timers = new Set(), logs = [];
  let time = 0;
  const message = {
    id: 'message01', fetch: async () => message,
    edit: async payload => { edits.push(payload); return message; },
  };
  const channel = { send: async payload => { sends.push(payload); return message; } };
  const service = new OthelloService({
    chooseAi: async b => getLegalMoves(b, 2)[0],
    render: (state, { phase = 'ready' } = {}) => ({ state, phase, components: [], files: [] }),
    wait: async () => {}, now: () => time,
    schedule: fn => { const timer = { fn }; timers.add(timer); return timer; },
    unschedule: timer => timers.delete(timer), logger: { warn: text => logs.push(text) },
    ...options,
  });
  t.after(() => service.dispose());
  function interaction(extra = {}) {
    return {
      user: { id: 'player01' }, channelId: 'channel01', guildId: 'guild01', channel, message,
      notices: [], deferred: false, replied: false, isButton: () => true,
      isChatInputCommand() { return !this.customId; },
      async reply(payload) { this.replied = true; this.notices.push(payload); },
      async followUp(payload) { this.notices.push(payload); },
      async deferReply() { this.deferred = true; },
      async deferUpdate() { this.deferred = true; },
      async editReply(payload) { this.notices.push(payload); },
      ...extra,
    };
  }
  const session = () => [...service.games.values()][0];
  const click = (action, value = '-', extra = {}) => interaction({ customId: componentId(session().state, action, value), ...extra });
  return {
    service, session, interaction, click, message, edits, sends, timers, logs,
    setTime: value => { time = value; },
    start: () => service.start(interaction(), 'normal'),
  };
}

test('startup reserves one session before awaiting and releases failed starts', async t => {
  const h = harness(t);
  const gate = deferred();
  const pending = h.service.start(h.interaction({ deferReply: () => gate.promise }), 'normal');
  const duplicate = h.interaction();
  await h.service.start(duplicate, 'normal');
  assert.equal(h.service.games.size, 1);
  assert.equal(h.sends.length, 0);
  assert.match(duplicate.notices[0].content, /開始しています/);
  gate.resolve();
  await pending;
  assert.equal(h.sends.length, 1);
  assert.equal(h.timers.size, 1);
  h.service.dispose();
  await h.service.start(h.interaction({ deferReply: async () => { throw { code: 10062 }; } }), 'normal');
  assert.equal(h.service.games.size, 0);
  assert.equal(h.service.byPlayer.size, 0);
  assert.equal(h.timers.size, 0);
});

test('a failed board send completes the deferred slash receipt and frees its reservation', async t => {
  const h = harness(t);
  const input = h.interaction({
    channel: { send: async () => { throw { code: 50013 }; } },
    followUp: async () => { assert.fail('the original deferred reply must be edited'); },
  });
  await h.service.start(input, 'normal');
  assert.equal(input.deferred, true);
  assert.match(input.notices.at(-1).content, /終了しました/);
  assert.equal(h.service.games.size, 0);
  assert.equal(h.service.byPlayer.size, 0);
});

test('a board deleted before send resolves cannot leave a ghost session', async t => {
  const h = harness(t);
  let fetched = false;
  h.message.fetch = async force => {
    assert.equal(force, true);
    fetched = true;
    throw { code: 10008 };
  };
  const input = h.interaction({ channel: { send: async () => {
    h.service.removeMessage(h.message.id);
    return h.message;
  } } });
  await h.service.start(input, 'normal');
  assert.equal(fetched, true);
  assert.equal(h.service.games.size + h.service.byPlayer.size + h.service.byMessage.size, 0);
  assert.equal(h.timers.size, 0);
  assert.match(input.notices.at(-1).content, /終了しました/);
});

test('deletion during the startup existence check completes the receipt and releases the game', async t => {
  const h = harness(t);
  const gate = deferred();
  h.message.fetch = () => gate.promise;
  const input = h.interaction();
  const starting = h.service.start(input, 'normal');
  await tick();
  h.service.removeMessage(h.message.id);
  gate.resolve(h.message);
  await starting;
  assert.equal(h.service.games.size + h.service.byPlayer.size + h.service.byMessage.size, 0);
  assert.equal(h.timers.size, 0);
  assert.match(input.notices.at(-1).content, /削除された/);
});

test('private start receipts retry or fall back without duplicating or discarding the public board', async t => {
  for (const failures of [1, 2]) {
    const h = harness(t);
    let attempts = 0;
    const input = h.interaction({ async editReply(payload) {
      attempts++;
      if (attempts <= failures) throw new Error('transient receipt failure');
      this.notices.push(payload);
    } });
    await h.service.start(input, 'normal');
    assert.equal(attempts, 2);
    assert.equal(h.sends.length, 1);
    assert.equal(h.service.games.size, 1);
    assert.equal(h.session().busy, false);
    assert.equal(h.timers.size, 1);
    assert.match(input.notices.at(-1).content, /対局を開始しました/);
    assert.match(input.notices.at(-1).content, /message01/);
    if (failures === 2) assert.equal(input.notices.at(-1).flags, 64);
  }
});

test('C4 followed by a click on old D3 cannot turn into a move at C2', async t => {
  const h = harness(t);
  await h.start();
  const oldD3 = h.click('move', 'D3');
  const gate = deferred();
  const original = h.message.edit;
  let first = true;
  h.message.edit = async p => {
    if (first) { first = false; await gate.promise; }
    return original(p);
  };
  const moving = h.service.handle(h.click('move', 'C4'));
  await tick();
  const whileUpdating = snapshotGame(h.session().state);
  await h.service.handle(oldD3);
  assert.deepEqual(h.session().state, whileUpdating);
  assert.match(oldD3.notices[0].content, /更新中/);
  gate.resolve();
  await moving;
  const after = snapshotGame(h.session().state);
  const late = h.interaction({ customId: oldD3.customId });
  await h.service.handle(late);
  assert.deepEqual(h.session().state, after);
  assert.match(late.notices[0].content, /古い盤面/);
  assert.deepEqual(countPieces(after.board), { black: 3, white: 3 });
  assert.equal(coordinate(after.lastPlayerMove), 'C4');
  assert.deepEqual(countPieces(h.edits[0].state.board), { black: 4, white: 1 });
  assert.equal(h.edits[0].phase, 'thinking');
  assert.deepEqual(h.edits.at(-1).state, after);
});

test('page changes invalidate old buttons even if their coordinate remains legal', async t => {
  const h = harness(t);
  await h.start();
  h.session().state.board = parseBoard('02121020/10121202/22200101/20111020/11212020/10010112/21112221/02100000');
  assert.equal(movePage(h.session().state).moves.length, 21);
  const old = h.click('move', coordinate(movePage(h.session().state).visible[0]));
  const before = snapshotGame(h.session().state);
  await h.service.handle(h.click('page', '1'));
  assert.equal(h.session().state.page, 1);
  await h.service.handle(old);
  assert.deepEqual(h.session().state.board, before.board);
  assert.match(old.notices[0].content, /古い盤面/);
  const hidden = h.click('move', old.customId.split(':').at(-1));
  await h.service.handle(hidden);
  assert.deepEqual(h.session().state.board, before.board);
  assert.match(hidden.notices[0].content, /そこには置けません/);
});

test('retries publish the same board and fresh attachments without repeating a move', async t => {
  let aiCalls = 0;
  const h = harness(t, { chooseAi: async b => { aiCalls++; return getLegalMoves(b, 2)[0]; } });
  await h.start();
  const readyAttempts = [];
  h.message.edit = async p => {
    assert.deepEqual(p.attachments, []);
    p.attachments.push({ id: 'simulated-library-mutation' });
    if (p.phase === 'ready') {
      readyAttempts.push(snapshotGame(p.state));
      if (readyAttempts.length < 3) throw new Error('transient');
    }
    return h.message;
  };
  await h.service.handle(h.click('move', 'C4'));
  assert.equal(aiCalls, 1);
  assert.equal(readyAttempts.length, 3);
  assert.deepEqual(readyAttempts[0], readyAttempts[2]);
  assert.deepEqual(countPieces(h.session().state.board), { black: 3, white: 3 });
  assert.equal(h.session().busy, false);
  assert.equal(h.timers.size, 1);
});

test('persistent display failure terminates and clears all session indices', async t => {
  const h = harness(t);
  await h.start();
  const session = h.session();
  let attempts = 0;
  h.message.edit = async () => { attempts++; throw { code: 50013 }; };
  const input = h.click('move', 'D3');
  await h.service.handle(input);
  assert.equal(attempts, 2); // one image attempt, then one text-only cleanup
  assert.equal(h.service.games.size + h.service.byMessage.size + h.service.byPlayer.size, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(session.abort.signal.aborted, true);
  assert.match(input.notices.at(-1).content, /終了しました/);
  const retry = h.interaction({ customId: input.customId });
  await h.service.handle(retry);
  assert.match(retry.notices[0].content, /期限切れ/);
});

test('failed acknowledgement leaves the move and published revision untouched', async t => {
  const h = harness(t);
  await h.start();
  const before = snapshotGame(h.session().state);
  await h.service.handle(h.click('move', 'D3', { deferUpdate: async () => { throw { code: 10062 }; } }));
  assert.deepEqual(h.session().state, before);
  assert.equal(h.edits.length, 0);
  assert.equal(h.session().busy, false);
});

test('ownership, channel, message and malformed input checks never mutate a game', async t => {
  const h = harness(t);
  await h.start();
  const before = snapshotGame(h.session().state);
  for (const extra of [
    { user: { id: 'other' } }, { channelId: 'wrong' }, { guildId: 'wrong' }, { message: { id: 'wrong' } },
    { customId: 'othello:bad' },
  ]) {
    const i = h.click('move', 'D3', extra);
    await h.service.handle(i);
    assert.equal(i.notices.length, 1);
    assert.equal(i.deferred, false);
    assert.deepEqual(h.session().state, before);
  }
});

test('resign confirmation can be cancelled and completed games are released', async t => {
  const h = harness(t);
  await h.start();
  await h.service.handle(h.click('resign'));
  const oldConfirm = h.click('confirm');
  assert.equal(h.session().state.confirmResign, true);
  await h.service.handle(h.click('cancel'));
  await h.service.handle(oldConfirm);
  assert.equal(h.session().state.status, 'playing');
  assert.equal(h.session().state.confirmResign, false);
  await h.service.handle(h.click('resign'));
  await h.service.handle(h.click('confirm'));
  assert.equal(h.edits.at(-1).state.status, 'resigned');
  assert.equal(h.service.games.size + h.service.byPlayer.size + h.service.byMessage.size, 0);
  assert.equal(h.timers.size, 0);
});

test('natural terminal moves publish the result and release the session', async t => {
  const h = harness(t);
  await h.start();
  h.session().state.board = parseBoard('02111111/11111111/11111111/11111111/11111111/11111111/11111111/11111111');
  await h.service.handle(h.click('move', 'A1'));
  assert.equal(h.edits.at(-1).state.status, 'finished');
  assert.deepEqual(h.edits.at(-1).state.result, { black: 64, white: 0, winner: 1 });
  assert.equal(h.service.games.size, 0);
});

test('idle expiration disables the game and a click is acknowledged before slow cleanup', async t => {
  const h = harness(t, { idleMs: 100 });
  await h.start();
  const old = h.click('move', 'D3');
  h.setTime(101);
  const gate = deferred();
  const original = h.message.edit;
  h.message.edit = async p => { await gate.promise; return original(p); };
  const ending = h.service.handle(old);
  await tick();
  assert.equal(old.replied, true);
  assert.match(old.notices[0].content, /期限切れ/);
  gate.resolve();
  await ending;
  assert.equal(h.edits.at(-1).state.status, 'expired');
  assert.equal(h.service.games.size, 0);
});

test('expiration falls back to text-only closure if the final image cannot be sent', async t => {
  for (const error of [new Error('network failure'), { code: 50013 }]) {
    const h = harness(t);
    await h.start();
    let imageAttempts = 0;
    h.message.edit = async payload => {
      if (payload.files) { imageAttempts++; throw error; }
      h.edits.push(payload);
      return h.message;
    };
    await h.service.expire(h.session());
    assert.equal(imageAttempts, error.code === 50013 ? 1 : 3);
    assert.match(h.edits.at(-1).content, /操作がなかったため/);
    assert.deepEqual(h.edits.at(-1).components, []);
    assert.equal(h.service.games.size + h.service.byPlayer.size + h.service.byMessage.size, 0);
    assert.equal(h.timers.size, 0);
  }
});

test('deleting a message aborts AI and discards a late worker result', async t => {
  const ai = deferred();
  let signal;
  const h = harness(t, { chooseAi: async (_b, _d, options) => { signal = options.signal; return ai.promise; } });
  await h.start();
  const session = h.session();
  const moving = h.service.handle(h.click('move', 'D3'));
  await tick();
  const before = snapshotGame(session.state);
  h.service.removeMessage(h.message.id);
  assert.equal(signal.aborted, true);
  ai.resolve(getLegalMoves(before.board, 2)[0]);
  await moving;
  assert.deepEqual(session.state, before);
  assert.equal(h.edits.length, 1);
  assert.equal(h.service.games.size, 0);
});

test('AI errors and illegal AI moves end cleanly', async t => {
  for (const chooseAi of [async () => { throw new Error('worker failed'); }, async () => ({ r: 0, c: 0 })]) {
    const h = harness(t, { chooseAi });
    await h.start();
    const session = h.session();
    await h.service.handle(h.click('move', 'D3'));
    assert.equal(session.state.status, 'error');
    assert.equal(session.state.board[0][0], 0);
    assert.equal(h.service.games.size, 0);
  }
});

test('channel and guild removal clear games; a restarted service rejects old buttons', async t => {
  const h = harness(t);
  await h.start();
  const old = h.click('move', 'D3');
  h.service.removeChannel('channel01');
  assert.equal(h.service.games.size, 0);
  await h.start();
  h.service.removeGuild('guild01');
  assert.equal(h.service.games.size, 0);
  const restarted = harness(t);
  await restarted.service.handle(old);
  assert.match(old.notices[0].content, /再起動後/);
});

test('the active game cap and allowed channels are enforced without posting', async t => {
  const h = harness(t, { maxGames: 1 });
  await h.start();
  const next = h.interaction({ user: { id: 'player02' } });
  await h.service.start(next, 'normal');
  assert.equal(h.sends.length, 1);
  assert.match(next.notices[0].content, /上限/);
  const blocked = harness(t, { isAllowedChannel: () => false });
  await blocked.start();
  assert.equal(blocked.sends.length, 0);
});

test('real worker, state transitions and PNG/button payload work together offline', async t => {
  const h = harness(t, { chooseAi: chooseAiMoveAsync, render: buildOthelloView });
  await h.start();
  assert.match(h.sends[0].content, /黒 2.*白 2/);
  const firstButtons = h.sends[0].components[0].toJSON().components;
  const input = h.interaction({ customId: firstButtons.find(b => b.label === 'D3').custom_id });
  let eventLoopRan = false;
  setImmediate(() => { eventLoopRan = true; });
  await h.service.handle(input);
  assert.equal(eventLoopRan, true);
  const result = h.edits.at(-1);
  const pieces = countPieces(h.session().state.board);
  assert.equal(pieces.black + pieces.white, 6);
  assert.match(result.content, new RegExp('黒 ' + pieces.black + '.*白 ' + pieces.white));
  assert.ok(Buffer.isBuffer(result.files[0].attachment));
  const legal = new Set(getLegalMoves(h.session().state.board, 1).map(coordinate));
  const moves = result.components.flatMap(row => row.toJSON().components).filter(b => /:move:/.test(b.custom_id));
  assert.ok(moves.length > 0);
  assert.ok(moves.every(b => legal.has(b.label) && !b.disabled));
});
