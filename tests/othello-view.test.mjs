import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, Message, MessagePayload } from 'discord.js';
import { buildOthelloView, componentId, parseComponentId } from '../src/othello/view.mjs';
import { createGameState, finishGame, playMove, snapshotGame } from '../src/othello/state.mjs';
import { getLegalMoves } from '../src/othello/board.mjs';

const makeState = () => createGameState({ id: 'game12345678', playerId: '123', channelId: '456' });
const buttons = payload => payload.components.flatMap(row => row.toJSON().components);

test('opening controls use exact coordinates and unique versioned ids', () => {
  const game = makeState();
  const payload = buildOthelloView(game);
  const controls = buttons(payload);
  assert.deepEqual(controls.slice(0, 4).map(b => b.label), ['D3', 'C4', 'F5', 'E6']);
  assert.deepEqual(controls.slice(0, 4).map(b => parseComponentId(b.custom_id).value), ['D3', 'C4', 'F5', 'E6']);
  assert.equal(new Set(controls.map(b => b.custom_id)).size, controls.length);
  assert.ok(controls.every(b => b.custom_id.length <= 100 && !b.disabled));
  assert.match(payload.content, /黒 2.*白 2/);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('pages stay within Discord row and button limits', () => {
  const game = makeState();
  game.board = '02121020/10121202/22200101/20111020/11212020/10010112/21112221/02100000'
    .split('/').map(row => [...row].map(Number));
  for (const page of [0, 1]) {
    game.page = page;
    const payload = buildOthelloView(game);
    assert.ok(payload.components.length <= 5);
    for (const row of payload.components) assert.ok(row.toJSON().components.length <= 5);
    const moves = buttons(payload).filter(b => parseComponentId(b.custom_id).action === 'move');
    assert.equal(moves.length, page ? 1 : 20);
    assert.match(payload.content, new RegExp('候補 ' + (page + 1) + '/2ページ'));
  }
});

test('thinking disables controls; resignation and results show clear states', () => {
  const game = makeState();
  playMove(game, { r: 2, c: 3 });
  const thinking = buildOthelloView(game, { phase: 'thinking' });
  assert.ok(buttons(thinking).every(b => b.disabled));
  assert.match(thinking.content, /AIが考えています/);
  const ai = getLegalMoves(game.board, 2)[0];
  playMove(game, ai);
  game.confirmResign = true;
  assert.deepEqual(buttons(buildOthelloView(game)).map(b => b.label), ['投了する', '対局に戻る']);
  finishGame(game, 'resigned');
  const ended = buildOthelloView(game);
  assert.deepEqual(ended.components, []);
  assert.match(ended.content, /投了.*AIの勝利/);
  assert.doesNotMatch(ended.content, /手番|考えています/);
});

test('an old snapshot renders identically after the live board changes', () => {
  const game = makeState();
  const old = snapshotGame(game);
  const expected = buildOthelloView(old);
  playMove(game, { r: 3, c: 2 });
  const actual = buildOthelloView(old);
  assert.equal(actual.content, expected.content);
  assert.deepEqual(actual.files[0].attachment, expected.files[0].attachment);
  assert.deepEqual(buttons(actual), buttons(expected));
});

test('discord.js serializes real view components and replaces old attachments on edit', async () => {
  const client = new Client({ intents: [] });
  client.user = { id: '789' };
  const channel = { id: '456', client };
  const message = new Message(client, {
    id: '999', channel_id: '456', author: { id: '789', username: 'test', bot: true },
    attachments: [{ id: '111', filename: 'old.png', size: 1, url: 'https://example.invalid/old.png', proxy_url: 'https://example.invalid/old.png' }],
  }, channel);
  const resolved = await MessagePayload.create(message, buildOthelloView(makeState())).resolveBody().resolveFiles();
  assert.equal(resolved.files.length, 1);
  assert.deepEqual(resolved.body.attachments.map(a => a.id), ['0']);
  assert.equal(resolved.body.components[0].components[0].label, 'D3');
  assert.deepEqual(resolved.body.allowed_mentions.parse, []);
  assert.ok(resolved.files[0].data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
});

test('malformed or mismatched component ids are rejected', () => {
  const game = makeState();
  for (const id of [
    '', null, 'x'.repeat(101), componentId(game, 'move', 'Z9'),
    componentId(game, 'move', '1'), componentId(game, 'page', 'D3'),
    componentId(game, 'confirm', '1'), componentId(game, 'unsupported'),
  ]) assert.equal(parseComponentId(id), null);
});
