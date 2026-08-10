import { SYSTEM_PROMPT_VALUE } from '../config.mjs';

/**
 * state = {
 *   paused: boolean,
 *   history: [{role, content}],
 *   queue: Array<QueueItem>,
 *   processing: boolean,
 * }
 *
 * QueueItem:
 *  - { kind: 'message', msg, name, text }
 *  - { kind: 'interaction', interaction, name, text, imageAtt, webSearch }
 */

export const stateByChannel = new Map();

export function getState(channelId) {
  if (!stateByChannel.has(channelId)) {
    stateByChannel.set(channelId, {
      paused: false,
      history: [
        {
          role: 'system',
          content: SYSTEM_PROMPT_VALUE,
        },
      ],
      queue: [],
      processing: false,
    });
  }
  return stateByChannel.get(channelId);
}

export function trimHistory(hist, maxMessages = 30) {
  const sys = hist[0];
  const rest = hist.slice(1);
  // slice(-0) returns the whole array, so guard against maxMessages=0 explicitly.
  const trimmed = maxMessages > 0 ? rest.slice(-maxMessages) : [];
  hist.length = 0;
  hist.push(sys, ...trimmed);
}
