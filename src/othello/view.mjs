import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { OTHELLO_AI, OTHELLO_PLAYER, countPieces, getLegalMoves } from './board.mjs';
import { coordinate, DIFFICULTY_LABELS } from './state.mjs';
import { renderOthelloPng } from './render.mjs';

export const MOVE_PAGE_SIZE = 20;

export function movePage(state) {
  const moves = state.status === 'playing' && state.current === OTHELLO_PLAYER
    ? getLegalMoves(state.board, OTHELLO_PLAYER) : [];
  const totalPages = Math.max(1, Math.ceil(moves.length / MOVE_PAGE_SIZE));
  const page = Math.max(0, Math.min(state.page, totalPages - 1));
  return { moves, page, totalPages, visible: moves.slice(page * MOVE_PAGE_SIZE, (page + 1) * MOVE_PAGE_SIZE) };
}

export function componentId(state, action, value = '-') {
  return `othello:${state.id}:${state.revision}:${action}:${value}`;
}

export function parseComponentId(id) {
  if (typeof id !== 'string' || id.length > 100) return null;
  const match = /^othello:([\w-]{8,32}):(\d{1,12}):(move|page|resign|confirm|cancel):([A-H][1-8]|\d{1,2}|-)$/.exec(id);
  if (!match) return null;
  const [, gameId, rev, action, value] = match;
  const revision = Number(rev);
  if (action === 'move' && !/^[A-H][1-8]$/.test(value)) return null;
  if (action === 'page' && !/^\d{1,2}$/.test(value)) return null;
  if (['resign', 'confirm', 'cancel'].includes(action) && value !== '-') return null;
  return { gameId, revision, action, value };
}

function button(state, action, label, value = '-', disabled = false, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(componentId(state, action, value))
    .setLabel(label).setStyle(style).setDisabled(disabled);
}

export function formatOthelloStatus(state, phase = 'ready') {
  const { black, white } = countPieces(state.board);
  const lines = [
    `**オセロ｜AI: ${DIFFICULTY_LABELS[state.difficulty]}**`,
    `プレイヤー: <@${state.playerId}>（黒） / AI（白）`,
    `⚫ 黒 ${black}　⚪ 白 ${white}`,
  ];
  if (state.status === 'finished') {
    lines.push(state.result.winner === 0 ? '**引き分けです。**'
      : state.result.winner === OTHELLO_PLAYER ? '**あなたの勝利です！**' : '**AIの勝利です。**');
  } else if (state.status === 'resigned') lines.push('**投了しました。AIの勝利です。**');
  else if (state.status === 'expired') lines.push('**操作が30分間なかったため、対局を終了しました。**');
  else if (state.status === 'error') lines.push('**対局を続けられなくなったため終了しました。**');
  else if (phase === 'thinking' || state.current === OTHELLO_AI) lines.push('AIが考えています…');
  else if (state.confirmResign) lines.push('投了してこの対局を終了しますか？');
  else lines.push('あなたの手番です。下の座標ボタンで石を置いてください。');

  const last = [];
  if (state.lastPlayerMove) last.push(`あなた: ${coordinate(state.lastPlayerMove)}`);
  if (state.lastAiMove) last.push(`AI: ${coordinate(state.lastAiMove)}`);
  if (last.length) lines.push(`直前の着手 — ${last.join(' / ')}`);
  for (const [color, name] of [[OTHELLO_PLAYER, 'あなた'], [OTHELLO_AI, 'AI']]) {
    const times = state.passes.filter(c => c === color).length;
    if (times) lines.push(`${name}は置ける場所がなく${times > 1 ? `${times}回` : ''}パスしました。`);
  }
  if (state.status !== 'playing') lines.push('もう一度遊ぶには `/othello` を実行してください。');
  else if (!state.confirmResign && state.current === OTHELLO_PLAYER) {
    const { totalPages, page } = movePage(state);
    if (totalPages > 1) lines.push(`候補 ${page + 1}/${totalPages}ページ`);
    lines.push('盤面の点は置ける場所、リングは最後に置いた石です。');
  }
  return lines.join('\n');
}

export function buildOthelloView(state, { phase = 'ready' } = {}) {
  const { visible, moves, page, totalPages } = movePage(state);
  const components = [];
  const disabled = phase !== 'ready' || state.current !== OTHELLO_PLAYER;
  if (state.status === 'playing') {
    if (state.confirmResign) {
      components.push(new ActionRowBuilder().addComponents(
        button(state, 'confirm', '投了する', '-', disabled, ButtonStyle.Danger),
        button(state, 'cancel', '対局に戻る', '-', disabled),
      ));
    } else {
      for (let i = 0; i < visible.length; i += 5) {
        components.push(new ActionRowBuilder().addComponents(visible.slice(i, i + 5).map(move =>
          button(state, 'move', coordinate(move), coordinate(move), disabled, ButtonStyle.Primary))));
      }
      const controls = [];
      if (totalPages > 1) {
        controls.push(button(state, 'page', '前の候補', String(Math.max(0, page - 1)), disabled || page === 0));
        controls.push(button(state, 'page', '次の候補', String(page + 1), disabled || page === totalPages - 1));
      }
      controls.push(button(state, 'resign', '投了', '-', disabled));
      components.push(new ActionRowBuilder().addComponents(controls));
    }
  }
  const file = new AttachmentBuilder(renderOthelloPng(state.board, {
    legalMoves: moves, lastMove: state.lastMove,
  }), { name: `othello_${state.id}_${state.revision}.png` });
  return {
    content: formatOthelloStatus(state, phase), components,
    attachments: [], files: [file], allowedMentions: { parse: [] },
  };
}
