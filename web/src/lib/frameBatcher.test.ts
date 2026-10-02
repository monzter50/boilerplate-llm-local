import { describe, expect, it, vi } from "vitest";
import { createFrameBatcher, type FrameScheduler } from "./frameBatcher";

/** Frames that only run when the test says so. */
function manualFrames() {
  let pending: (() => void) | null = null;
  const scheduler: FrameScheduler = {
    schedule: vi.fn((run: () => void) => {
      pending = run;
      return 1;
    }),
    cancel: vi.fn(() => {
      pending = null;
    }),
  };
  const nextFrame = () => {
    const run = pending;
    pending = null;
    run?.();
  };
  return { scheduler, nextFrame };
}

describe("createFrameBatcher", () => {
  it("applies everything pushed within a frame in one call", () => {
    const apply = vi.fn();
    const { scheduler, nextFrame } = manualFrames();
    const batcher = createFrameBatcher<string>(apply, scheduler);

    for (const token of ["a", "b", "c"]) batcher.push(token);
    expect(apply).not.toHaveBeenCalled();
    expect(scheduler.schedule).toHaveBeenCalledTimes(1);

    nextFrame();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(["a", "b", "c"]);

    batcher.push("d");
    nextFrame();
    expect(apply).toHaveBeenLastCalledWith(["d"]);
  });

  it("applies the rest at once on flush, without waiting for a frame", () => {
    const apply = vi.fn();
    const { scheduler, nextFrame } = manualFrames();
    const batcher = createFrameBatcher<string>(apply, scheduler);

    batcher.push("last");
    batcher.flush();
    expect(apply).toHaveBeenCalledWith(["last"]);
    expect(scheduler.cancel).toHaveBeenCalled();

    // The cancelled frame must not apply anything twice.
    nextFrame();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("does nothing on flush when nothing is pending", () => {
    const apply = vi.fn();
    createFrameBatcher<string>(apply, manualFrames().scheduler).flush();
    expect(apply).not.toHaveBeenCalled();
  });
});
