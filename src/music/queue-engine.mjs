/**
 * A small, backend-agnostic serial queue for music generation jobs.
 *
 * The queue deliberately knows nothing about the shape of a job.  Callers
 * can therefore put ACE-Step, YuE2, or another backend in the same queue and
 * use beforeJob for backend-specific admission/safety checks.
 */

const QUEUE_FULL_CODE = 'MUSIC_QUEUE_FULL';
const QUEUE_DISPOSED_CODE = 'MUSIC_QUEUE_DISPOSED';

function validateOptions({
  runJob,
  idleDelayMs,
  maxJobs,
  setTimer,
  clearTimer,
}) {
  if (typeof runJob !== 'function') {
    throw new TypeError('createMusicQueue requires a runJob function');
  }
  if (!Number.isFinite(idleDelayMs) || idleDelayMs < 0) {
    throw new TypeError('idleDelayMs must be a finite number greater than or equal to 0');
  }
  if (!Number.isInteger(maxJobs) || maxJobs < 1) {
    throw new TypeError('maxJobs must be a positive integer');
  }
  if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
    throw new TypeError('setTimer and clearTimer must be functions');
  }
}

function createQueueError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Create one serial music queue shared by all backends/models.
 *
 * `position` returned by enqueue is one-based and includes the currently
 * running job.  For example, the running job is position 1 and the next job
 * is position 2.
 */
export function createMusicQueue({
  runJob,
  beforeJob = async () => {},
  releaseIdle = async () => {},
  onError = async () => {},
  idleDelayMs = 300_000,
  maxJobs = 5,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  validateOptions({ runJob, idleDelayMs, maxJobs, setTimer, clearTimer });

  if (typeof beforeJob !== 'function') {
    throw new TypeError('beforeJob must be a function');
  }
  if (typeof releaseIdle !== 'function') {
    throw new TypeError('releaseIdle must be a function');
  }
  if (typeof onError !== 'function') {
    throw new TypeError('onError must be a function');
  }

  const pendingJobs = [];
  const idleWaiters = new Set();

  let runningPromise = null;
  let activeJob = null;
  let hasActiveJob = false;
  let idleTimer = null;
  let idleTimerGeneration = 0;
  let idleReleasePromise = null;
  let disposed = false;

  const pendingCount = () => pendingJobs.length;
  const totalCount = () => pendingJobs.length + (hasActiveJob ? 1 : 0);
  const isBusy = () => runningPromise !== null || idleReleasePromise !== null;

  function notifyIdleWaiters() {
    if (isBusy() || pendingJobs.length > 0) return;
    if (idleWaiters.size === 0) return;

    const waiters = [...idleWaiters];
    idleWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  function cancelIdleTimer() {
    idleTimerGeneration += 1;
    if (idleTimer === null) return;
    clearTimer(idleTimer);
    idleTimer = null;
  }

  function finishIdleRelease(retry) {
    // The promise is assigned immediately after the operation is created. The
    // identity check also protects against a stale completion in tests or a
    // custom thenable used by a caller.
    idleReleasePromise = null;
    if (pendingJobs.length > 0) {
      pump();
      return;
    }
    // A backend can report that work is still present (for example, a remote
    // ComfyUI job that outlived our polling timeout). Retry only while the
    // queue is genuinely idle. A zero delay is the explicit "disabled"
    // setting, so it must not turn into a tight retry loop.
    if (retry && idleDelayMs > 0 && !disposed) scheduleIdleRelease();
    notifyIdleWaiters();
  }

  function beginIdleRelease() {
    if (
      disposed
      || idleReleasePromise !== null
      || runningPromise !== null
      || hasActiveJob
      || pendingJobs.length > 0
    ) {
      return;
    }

    // Start the callback in a microtask after assigning idleReleasePromise.
    // This makes a job enqueued while the asynchronous free is starting wait
    // for that free to finish before beforeJob/runJob can begin.
    const operation = Promise.resolve().then(() => releaseIdle());
    const tracked = operation.then(
      (result) => {
        finishIdleRelease(result === false);
      },
      (error) => {
        // A failed best-effort VRAM release must not strand the queue or cause
        // an unhandled rejection. The next job remains allowed to run.
        console.warn(`[music] idle resource release failed: ${error?.message || String(error)}`);
        finishIdleRelease(false);
      },
    );
    idleReleasePromise = tracked;
    // `finishIdleRelease` is intentionally defensive, but keep a final guard
    // in case a custom console/pump implementation throws unexpectedly.
    tracked.catch((error) => {
      console.warn(`[music] idle resource release cleanup failed: ${error?.message || String(error)}`);
      idleReleasePromise = null;
      if (pendingJobs.length > 0) pump();
      notifyIdleWaiters();
    });
  }

  function scheduleIdleRelease() {
    if (
      disposed
      || idleTimer !== null
      || idleReleasePromise !== null
      || runningPromise !== null
      || hasActiveJob
      || pendingJobs.length > 0
    ) {
      notifyIdleWaiters();
      return;
    }
    // Match the existing MUSIC_VRAM_RELEASE_DELAY_SECONDS contract: zero
    // disables automatic release rather than requesting it immediately.
    if (idleDelayMs === 0) {
      notifyIdleWaiters();
      return;
    }

    const generation = ++idleTimerGeneration;
    const timer = setTimer(() => {
      if (generation !== idleTimerGeneration) return;
      idleTimer = null;
      beginIdleRelease();
      notifyIdleWaiters();
    }, idleDelayMs);
    idleTimer = timer;
    timer?.unref?.();
  }

  async function reportError(job, error) {
    try {
      await onError(job, error);
    } catch (handlerError) {
      // Error reporting is deliberately isolated from queue execution. A
      // caller may, for example, fail while editing a Discord reply.
      console.warn(`[music] queue error handler failed: ${handlerError?.message || String(handlerError)}`);
    }
  }

  async function drain() {
    while (pendingJobs.length > 0) {
      // If an idle release began just before this job was queued, wait for it
      // before touching the backend. This is the key VRAM race prevention.
      if (idleReleasePromise !== null) await idleReleasePromise;
      if (pendingJobs.length === 0) break;

      const job = pendingJobs.shift();
      activeJob = job;
      hasActiveJob = true;
      try {
        await beforeJob(job);
        await runJob(job);
      } catch (error) {
        await reportError(job, error);
      } finally {
        activeJob = null;
        hasActiveJob = false;
      }
    }
  }

  function pump() {
    if (runningPromise !== null || pendingJobs.length === 0) {
      notifyIdleWaiters();
      return;
    }

    cancelIdleTimer();
    runningPromise = drain().then(
      () => {
        runningPromise = null;
        if (pendingJobs.length > 0) {
          pump();
        } else {
          scheduleIdleRelease();
          notifyIdleWaiters();
        }
      },
      (error) => {
        // drain catches job and callback errors individually. This branch is
        // a last-resort guard for an unexpected internal failure so one queue
        // failure cannot leave subsequent jobs permanently stuck.
        runningPromise = null;
        console.warn(`[music] queue drain failed: ${error?.message || String(error)}`);
        if (pendingJobs.length > 0) pump();
        else {
          scheduleIdleRelease();
          notifyIdleWaiters();
        }
      },
    );
  }

  function enqueue(job) {
    if (disposed) {
      throw createQueueError(
        QUEUE_DISPOSED_CODE,
        'Music queue has been disposed and does not accept new jobs.',
      );
    }
    if (totalCount() >= maxJobs) {
      throw createQueueError(
        QUEUE_FULL_CODE,
        `Music queue is full (maximum ${maxJobs} jobs, including the active job).`,
      );
    }

    cancelIdleTimer();
    pendingJobs.push(job);
    const position = totalCount();
    pump();
    return position;
  }

  function whenIdle() {
    if (!isBusy() && pendingJobs.length === 0) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.add(resolve));
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelIdleTimer();
    // Already active and pending jobs are allowed to drain. No new jobs can
    // enter after dispose, and no future idle-release timer is scheduled.
    notifyIdleWaiters();
  }

  return {
    enqueue,
    isProcessing: isBusy,
    pendingCount,
    totalCount,
    whenIdle,
    dispose,
  };
}

export const MUSIC_QUEUE_FULL = QUEUE_FULL_CODE;
export const MUSIC_QUEUE_DISPOSED = QUEUE_DISPOSED_CODE;
