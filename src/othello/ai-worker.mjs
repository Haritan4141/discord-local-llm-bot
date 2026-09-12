import { parentPort } from 'node:worker_threads';
import { chooseAiMove } from './ai.mjs';

if (!parentPort) {
  throw new Error('Othello AI worker must run inside a worker thread');
}

function send(message) {
  try {
    parentPort.postMessage(message);
  } finally {
    parentPort.close();
  }
}

parentPort.once('message', message => {
  if (!message || message.type !== 'search') {
    send({ type: 'error', message: 'Invalid Othello AI worker request' });
    return;
  }

  try {
    const cancelView = message.cancelBuffer
      ? new Int32Array(message.cancelBuffer)
      : null;
    const move = chooseAiMove(
      message.board,
      undefined,
      message.difficulty,
      { ...(message.options || {}), cancelView },
    );
    send({
      type: 'result',
      move: move ? { r: move.r, c: move.c } : null,
    });
  } catch (error) {
    send({
      type: 'error',
      message: error?.message || String(error),
      stack: error?.stack || '',
    });
  }
});
