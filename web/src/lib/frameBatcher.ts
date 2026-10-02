export type FrameScheduler = {
  schedule: (run: () => void) => number;
  cancel: (handle: number) => void;
};

const animationFrames: FrameScheduler = {
  schedule: (run) => requestAnimationFrame(run),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/**
 * Collects items and hands them to `apply` at most once per animation frame.
 * A fast model streams far more tokens per second than the screen can show,
 * and applying each one rebuilds the message list and re-renders it, so
 * batching to the frame rate does the same work for a fraction of the cost.
 *
 * Call `flush()` before acting on the end of the stream, so the last items are
 * applied first. A background tab gets no frames; `flush()` covers that too.
 */
export function createFrameBatcher<T>(
  apply: (items: T[]) => void,
  scheduler: FrameScheduler = animationFrames,
) {
  let queue: T[] = [];
  let handle: number | null = null;

  function flush() {
    if (handle !== null) {
      scheduler.cancel(handle);
      handle = null;
    }
    if (queue.length === 0) return;
    const items = queue;
    queue = [];
    apply(items);
  }

  return {
    push(item: T) {
      queue.push(item);
      handle ??= scheduler.schedule(() => {
        handle = null;
        flush();
      });
    },
    flush,
  };
}
