export function startTypingLoop(sendTyping, intervalMs = 8000) {
  let stopped = false;
  let timer = null;

  async function tick() {
    if (stopped) return;

    try {
      await sendTyping();
    } catch {}

    if (stopped) return;

    timer = setTimeout(tick, intervalMs);
    if (typeof timer?.unref === 'function') timer.unref();
  }

  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
