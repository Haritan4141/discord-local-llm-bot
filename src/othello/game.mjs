import { AttachmentBuilder, MessageFlags } from 'discord.js';
import {
  OTHELLO_AI,
  OTHELLO_PLAYER,
  applyMove,
  countPieces,
  createOthelloBoard,
  getLegalMoves,
  isBoardFull,
  otherColor,
} from './board.mjs';
import { chooseAiMove } from './ai.mjs';
import { renderOthelloPng } from './render.mjs';

export const othelloGames = new Map(); // gameId -> game
export const othelloMessageToGame = new Map(); // messageId -> gameId (reaction mode)

export const REACTION_DIGITS = new Map([
  ['0️⃣', 0], ['1️⃣', 1], ['2️⃣', 2], ['3️⃣', 3], ['4️⃣', 4],
  ['5️⃣', 5], ['6️⃣', 6], ['7️⃣', 7], ['8️⃣', 8], ['9️⃣', 9],
]);

export function formatOthelloStatus(game) {
  const { black, white } = countPieces(game.board);
  const turn = game.current === OTHELLO_PLAYER ? 'あなた (黒)' : 'AI (白)';
  const diffLabel = {
    easy: '弱め',
    normal: '普通',
    hard: '強め',
    max: '最強',
  }[game.difficulty] || game.difficulty;
  const note = game.note ? `\n${game.note}` : '';
  return `オセロ (VS AI) | AI: ${diffLabel} | 操作: リアクション\n手番: ${turn}\n黒 ${black} - 白 ${white}${note}`;
}

export function getReactionMoves(game) {
  const playerMoves = getLegalMoves(game.board, OTHELLO_PLAYER);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(playerMoves.length / pageSize));
  const page = Math.min(game.reactionPage || 0, totalPages - 1);
  const slice = playerMoves.slice(page * pageSize, page * pageSize + pageSize);
  return { playerMoves, slice, page, totalPages };
}

async function notifyReactionPermission(game, message) {
  if (game.reactionPermissionWarned) return;
  game.reactionPermissionWarned = true;
  try {
    await message.channel.send(
      '⚠️ リアクションを付与する権限がありません。権限: メッセージにリアクション / リアクションの管理 を付与してください。',
    );
  } catch {}
}

async function syncReactionControls(game, message, sliceLen, page, totalPages) {
  if (game.reactionDisabled) return;
  const digits = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
  const desired = [];
  const count = Math.min(sliceLen, digits.length);
  for (let i = 0; i < count; i++) desired.push(digits[i]);
  if (totalPages > 1 && page > 0) desired.push('◀️');
  if (totalPages > 1 && page < totalPages - 1) desired.push('▶️');

  const botId = message.client?.user?.id;

  for (let pass = 0; pass < 2; pass++) {
    const fresh = pass === 0 ? message : await message.fetch().catch(() => message);
    const cache = fresh.reactions.cache;
    let missing = false;

    for (const emoji of desired) {
      const reaction = cache.get(emoji);
      if (reaction?.me) continue;
      missing = true;
      try {
        await fresh.react(emoji);
      } catch (e) {
        if (e?.code === 50013) {
          game.reactionDisabled = true;
          await notifyReactionPermission(game, message);
          return;
        }
      }
    }

    if (!missing || pass === 1) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  if (botId) {
    const cache = message.reactions.cache;
    for (const [emoji, reaction] of cache) {
      if (desired.includes(emoji)) continue;
      if (!reaction.me) continue;
      try {
        await reaction.users.remove(botId);
      } catch (e) {
        if (e?.code === 50013) {
          game.reactionDisabled = true;
          await notifyReactionPermission(game, message);
          return;
        }
      }
    }
  }
}

export async function updateReactionGame(game, channel) {
  const { slice, page, totalPages } = getReactionMoves(game);
  const labels = new Map();
  slice.forEach((m, idx) => {
    labels.set(`${m.r},${m.c}`, `${idx}`);
  });
  const file = new AttachmentBuilder(renderOthelloPng(game.board, labels), { name: `othello_${game.id}.png` });

  const list = slice.map((m, idx) => `${idx}: ${String.fromCharCode(65 + m.c)}${m.r + 1}`).join(' ');
  const pageText = `page ${page + 1}/${totalPages}`;
  const msg = await channel.messages.fetch(game.reactionMessageId).catch(() => null);
  if (msg) {
    await msg.edit({
      content: `${formatOthelloStatus(game)}\n${pageText}\n${list || ''}`,
      files: [file],
    });
    const stateKey = `${slice.length}:${page}:${totalPages}`;
    if (!game.reactionDisabled && game.reactionStateKey !== stateKey) {
      game.reactionStateKey = stateKey;
      await syncReactionControls(game, msg, slice.length, page, totalPages);
    }
  }
}

export function checkGameEnd(game) {
  const playerMoves = getLegalMoves(game.board, OTHELLO_PLAYER);
  const aiMoves = getLegalMoves(game.board, OTHELLO_AI);
  if (isBoardFull(game.board) || (playerMoves.length === 0 && aiMoves.length === 0)) {
    game.ended = true;
    const { black, white } = countPieces(game.board);
    if (black > white) game.note = '勝利: あなた (黒)';
    else if (white > black) game.note = '勝利: AI (白)';
    else game.note = '引き分け';
    if (game.reactionMessageId) {
      othelloMessageToGame.delete(game.reactionMessageId);
    }
    return true;
  }
  return false;
}

export function runAiIfNeeded(game) {
  let note = '';
  let loopGuard = 0;
  while (!game.ended && loopGuard < 10) {
    loopGuard += 1;
    if (checkGameEnd(game)) break;
    const moves = getLegalMoves(game.board, game.current);
    if (moves.length === 0) {
      note = game.current === OTHELLO_PLAYER ? 'パス: あなた (黒)' : 'パス: AI (白)';
      game.current = otherColor(game.current);
      continue;
    }
    if (game.current === OTHELLO_AI) {
      const m = chooseAiMove(game.board, moves, game.difficulty);
      if (m) applyMove(game.board, OTHELLO_AI, m);
      game.current = OTHELLO_PLAYER;
      continue;
    }
    break;
  }
  if (loopGuard >= 10) {
    console.warn(`[othello] runAiIfNeeded loopGuard tripped: game=${game.id} current=${game.current}`);
  }
  if (note) game.note = note;
}

export function getOthelloGame(gameId) {
  return othelloGames.get(gameId) || null;
}

export async function handlePlayerMove(game, move) {
  if (game.locked) return { ok: false, message: '他の操作中です。少し待ってください。' };
  if (game.ended) return { ok: false, message: '対局は終了しました。' };
  if (game.current !== OTHELLO_PLAYER) return { ok: false, message: 'AIの手番です。' };
  const legal = getLegalMoves(game.board, OTHELLO_PLAYER);
  const target = legal.find(m => m.r === move.r && m.c === move.c);
  if (!target) return { ok: false, message: 'そこには置けません。' };

  game.locked = true;
  try {
    applyMove(game.board, OTHELLO_PLAYER, target);
    game.current = OTHELLO_AI;
    game.note = '';
    runAiIfNeeded(game);
    return { ok: true };
  } finally {
    game.locked = false;
  }
}

export async function startOthelloGame(interaction, difficulty) {
  const gameId = Math.random().toString(36).slice(2, 10);
  const game = {
    id: gameId,
    channelId: interaction.channelId,
    playerId: interaction.user.id,
    difficulty,
    board: createOthelloBoard(),
    current: OTHELLO_PLAYER,
    ended: false,
    locked: false,
    note: '',
    reactionMessageId: null,
    reactionPage: 0,
    reactionStateKey: '',
    reactionDisabled: false,
    reactionPermissionWarned: false,
  };
  othelloGames.set(gameId, game);

  try {
    await interaction.reply({
      content: `オセロを開始しました。AI=${difficulty}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (e) {
    if (e?.code === 10062 || e?.code === 40060) return;
  }

  const channel = interaction.channel;
  const msg = await channel.send({ content: formatOthelloStatus(game) });
  game.reactionMessageId = msg.id;
  othelloMessageToGame.set(msg.id, gameId);
  await updateReactionGame(game, channel);
}
