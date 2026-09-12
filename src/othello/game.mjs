import { randomBytes } from 'node:crypto';
import { MessageFlags } from 'discord.js';
import { OTHELLO_AI, OTHELLO_PLAYER } from './board.mjs';
import { createGameState, finishGame, playMove, snapshotGame } from './state.mjs';
import { buildOthelloView, movePage, parseComponentId } from './view.mjs';

const IDLE_MS = 30 * 60 * 1000;
const PERMANENT_ERRORS = new Set([10003, 10008, 50001, 50013]);
const defaultAi = async (...args) => (await import('./ai-client.mjs')).chooseAiMoveAsync(...args);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// A game never depends on a collector or a long-lived interaction token.
export class OthelloService {
  constructor({
    chooseAi = defaultAi, render = buildOthelloView, isAllowedChannel = () => true,
    idleMs = IDLE_MS, maxGames = 100, wait = delay, now = Date.now,
    schedule = setTimeout, unschedule = clearTimeout, logger = console,
  } = {}) {
    Object.assign(this, { chooseAi, render, isAllowedChannel, idleMs, maxGames, wait, now, schedule, unschedule, logger });
    this.games = new Map();
    this.byPlayer = new Map();
    this.byMessage = new Map();
  }

  owns(interaction) {
    return interaction.isButton?.() && interaction.customId?.startsWith('othello:');
  }

  log(stage, error) {
    // REST errors can contain request payloads/tokens; log only a code.
    this.logger.warn('[othello] ' + stage + ': ' + (error?.code || error?.name || 'Error'));
  }

  async tell(interaction, content) {
    try {
      const payload = { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
      if (interaction.deferred && interaction.isChatInputCommand?.()) {
        // A failed /othello start must also finish its deferred receipt.
        await this.completeReceipt(interaction, content);
      } else if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch (error) { this.log('notice failed', error); }
  }

  async completeReceipt(interaction, content) {
    const payload = { content, allowedMentions: { parse: [] } };
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await interaction.editReply(payload); return; }
      catch (error) {
        this.log('start receipt failed', error);
        if (attempt === 0) await this.wait(300);
      }
    }
    // Keep a successfully created game alive even if its private receipt fails.
    try { await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral }); }
    catch (error) { this.log('receipt fallback failed', error); }
  }

  async closeDisplay(session, content, error) {
    if (!session.message || [10003, 10008, 50001].includes(error?.code)) return;
    try {
      // Text-only cleanup can succeed when image uploads lack permission.
      await session.message.edit({ content, components: [], allowedMentions: { parse: [] } });
    } catch (editError) { this.log('final notice failed', editError); }
  }

  alive(session) { return this.games.get(session.state.id) === session; }

  cancelTimer(session) {
    if (session.timer !== null) this.unschedule(session.timer);
    session.timer = null;
  }

  armTimer(session) {
    this.cancelTimer(session);
    if (!this.alive(session)) return;
    session.expiresAt = this.now() + this.idleMs;
    session.timer = this.schedule(() => {
      void this.expire(session).catch(error => this.log('expire failed', error));
    }, this.idleMs);
    session.timer?.unref?.();
  }

  drop(session) {
    if (!this.alive(session)) return;
    this.cancelTimer(session);
    session.abort.abort();
    this.games.delete(session.state.id);
    if (this.byPlayer.get(session.playerKey) === session) this.byPlayer.delete(session.playerKey);
    if (session.message) this.byMessage.delete(session.message.id);
  }

  removeMessage(id) {
    const session = this.byMessage.get(id);
    if (session) this.drop(session);
  }

  removeChannel(id) {
    for (const session of this.games.values()) if (session.state.channelId === id) this.drop(session);
  }

  removeGuild(id) {
    for (const session of this.games.values()) if (session.state.guildId === id) this.drop(session);
  }

  dispose() {
    for (const session of this.games.values()) this.drop(session);
  }

  async publish(session, phase = 'ready') {
    // Build ONCE before awaiting. A retry never reapplies a move or mixes an
    // old image with a new status. The caller holds the session lock.
    const snapshot = snapshotGame(session.state);
    const payload = this.render(snapshot, { phase });
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!this.alive(session)) return false;
      try {
        // discord.js appends new file entries while resolving attachments.
        // Each attempt needs its own array to keep replacement idempotent.
        await session.message.edit({ ...payload, attachments: [] });
        if (!this.alive(session)) return false;
        session.publishedRevision = snapshot.revision;
        return true;
      } catch (error) {
        lastError = error;
        if (PERMANENT_ERRORS.has(error?.code)) break;
        if (attempt < 2) await this.wait(attempt === 0 ? 300 : 1000);
      }
    }
    throw lastError;
  }

  async fail(session, error, interaction) {
    if (!this.alive(session)) return;
    this.log('game ended after failure', error);
    finishGame(session.state, 'error');
    this.drop(session);
    await this.closeDisplay(session, '⚠️ 対局の更新に失敗したため終了しました。もう一度 /othello を実行してください。', error);
    if (interaction) await this.tell(interaction, '⚠️ 対局を続けられなくなったため終了しました。もう一度 /othello を実行してください。');
  }

  async start(interaction, difficulty) {
    if (!this.isAllowedChannel(interaction.channelId)) {
      await this.tell(interaction, 'このチャンネルでは使用できません。');
      return;
    }
    const playerKey = interaction.channelId + ':' + interaction.user.id;
    const existing = this.byPlayer.get(playerKey);
    if (existing) {
      const link = existing.message
        ? 'https://discord.com/channels/' + (existing.state.guildId || '@me') + '/' + existing.state.channelId + '/' + existing.message.id : null;
      await this.tell(interaction, link
        ? 'このチャンネルでは既に対局中です。[盤面を開く](' + link + ')\n新しく始める場合は、盤面の「投了」で終了してください。'
        : '対局を開始しています。少しお待ちください。');
      return;
    }
    if (this.games.size >= this.maxGames) {
      await this.tell(interaction, '対局数が上限に達しています。しばらくしてからお試しください。');
      return;
    }
    const state = createGameState({
      id: randomBytes(9).toString('base64url'), playerId: interaction.user.id,
      channelId: interaction.channelId, guildId: interaction.guildId, difficulty,
    });
    const session = {
      state, playerKey, message: null, publishedRevision: -1, busy: true,
      timer: null, expiresAt: Infinity, abort: new AbortController(),
    };
    // Reserve before the first await to prevent duplicate starts.
    this.games.set(state.id, session);
    this.byPlayer.set(playerKey, session);
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (!this.alive(session)) {
        await this.tell(interaction, '対局の開始が取り消されました。もう一度 /othello を実行してください。');
        return;
      }
      const payload = this.render(snapshotGame(state));
      // Don't retry creation: an ambiguous response could duplicate the board.
      const message = await interaction.channel.send(payload);
      session.message = message;
      if (!this.alive(session)) {
        await this.closeDisplay(session, 'この対局は終了しました。');
        await this.tell(interaction, '対局の開始が取り消されました。もう一度 /othello を実行してください。');
        return;
      }
      this.byMessage.set(message.id, session);
      // A delete event may arrive before send resolves and before this index
      // exists. Force a REST fetch after indexing to close that startup gap.
      await message.fetch(true);
      if (!this.alive(session)) {
        await this.tell(interaction, '盤面が削除されたため対局を終了しました。もう一度 /othello を実行してください。');
        return;
      }
      session.publishedRevision = state.revision;
      await this.completeReceipt(interaction, '対局を開始しました。あなたは黒です。\nhttps://discord.com/channels/'
        + (state.guildId || '@me') + '/' + state.channelId + '/' + message.id);
    } catch (error) {
      if (this.alive(session)) await this.fail(session, error, interaction);
      else await this.tell(interaction, '対局は終了しました。もう一度 /othello を実行してください。');
    } finally {
      session.busy = false;
      if (this.alive(session)) this.armTimer(session);
    }
  }

  async runAi(session) {
    while (this.alive(session) && session.state.status === 'playing' && session.state.current === OTHELLO_AI) {
      if (!await this.publish(session, 'thinking')) return;
      const move = await this.chooseAi(snapshotGame(session.state).board, session.state.difficulty, { signal: session.abort.signal });
      if (!this.alive(session)) return;
      if (!move || !playMove(session.state, move, OTHELLO_AI)) throw new Error('Invalid AI move');
    }
  }

  async handle(interaction) {
    if (!this.owns(interaction)) return false;
    const input = parseComponentId(interaction.customId);
    const session = input && this.games.get(input.gameId);
    if (!session) {
      await this.tell(interaction, 'この対局は終了または期限切れです。Bot再起動後も対局は引き継がれません。新しく /othello を実行してください。');
      return true;
    }
    const state = session.state;
    if (interaction.user.id !== state.playerId) {
      await this.tell(interaction, 'この盤面は対局を始めた人だけが操作できます。自分の対局は /othello で始められます。');
      return true;
    }
    if (interaction.channelId !== state.channelId || interaction.guildId !== state.guildId
      || interaction.message?.id !== session.message?.id || !this.isAllowedChannel(interaction.channelId)) {
      await this.tell(interaction, 'この場所では対局を操作できません。元の盤面を開いてください。');
      return true;
    }
    if (session.busy) {
      await this.tell(interaction, 'AIの思考または盤面の更新中です。画面が更新されてから操作してください。');
      return true;
    }
    if (session.expiresAt <= this.now()) {
      await this.tell(interaction, 'この対局は期限切れです。新しく /othello を実行してください。');
      await this.expire(session);
      return true;
    }
    if (state.status !== 'playing' || input.revision !== state.revision || input.revision !== session.publishedRevision) {
      await this.tell(interaction, '古い盤面からの操作でした。最新の盤面にあるボタンを押してください。');
      return true;
    }

    session.busy = true;
    this.cancelTimer(session);
    let acknowledged = false;
    try {
      await interaction.deferUpdate();
      acknowledged = true;
      if (!this.alive(session)) return true;
      const { action, value } = input;
      if (action === 'move' && !state.confirmResign && state.current === OTHELLO_PLAYER) {
        const r = Number(value[1]) - 1;
        const c = value.charCodeAt(0) - 65;
        if (!movePage(state).visible.some(m => m.r === r && m.c === c) || !playMove(state, { r, c }, OTHELLO_PLAYER)) {
          await this.tell(interaction, 'そこには置けません。表示されている座標から選んでください。');
          return true;
        }
        await this.runAi(session);
      } else if (action === 'page' && !state.confirmResign) {
        const page = Number(value);
        if (page >= movePage(state).totalPages || page === state.page) return true;
        state.page = page;
        state.revision += 1;
      } else if (action === 'resign' && !state.confirmResign) {
        state.confirmResign = true;
        state.revision += 1;
      } else if (action === 'cancel' && state.confirmResign) {
        state.confirmResign = false;
        state.revision += 1;
      } else if (action === 'confirm' && state.confirmResign) {
        finishGame(state, 'resigned');
      } else {
        await this.tell(interaction, '最新の盤面にあるボタンを押してください。');
        return true;
      }
      if (!this.alive(session)) return true;
      await this.publish(session);
      if (state.status !== 'playing') this.drop(session);
    } catch (error) {
      if (acknowledged) await this.fail(session, error, interaction);
      else this.log('acknowledgement failed; move not applied', error);
    } finally {
      session.busy = false;
      if (this.alive(session)) this.armTimer(session);
    }
    return true;
  }

  async expire(session) {
    if (!this.alive(session) || session.busy) return;
    session.busy = true;
    this.cancelTimer(session);
    finishGame(session.state, 'expired');
    try { await this.publish(session); }
    catch (error) {
      this.log('expiry display failed', error);
      await this.closeDisplay(session, '⌛ 30分間操作がなかったため対局を終了しました。新しく /othello を実行してください。', error);
    }
    finally { this.drop(session); }
  }
}
