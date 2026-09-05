import { describe, expect, it, vi } from "vitest";
import { LOCK_IN_MS, PhaseMachine, type PhaseSpec } from "./roundEngine";

type P = "a" | "b" | "done";

/** Drives frames at a fixed step so tests read as "advance N ms", not as raf bookkeeping. */
function run(machine: PhaseMachine<P>, fromMs: number, toMs: number, stepMs = 16): number {
  let now = fromMs;
  while (now < toMs) {
    now = Math.min(now + stepMs, toMs);
    machine.tick(now, stepMs / 1000);
  }
  return now;
}

describe("PhaseMachine", () => {
  it("fires onEnter when a phase is entered, not on construction", () => {
    const onEnter = vi.fn();
    const m = new PhaseMachine<P>("a", { b: { onEnter } });
    expect(onEnter).not.toHaveBeenCalled();
    m.setPhase("b", 100, 0);
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it("expires a phase once its deadline passes", () => {
    const onExpire = vi.fn();
    const m = new PhaseMachine<P>("a", { a: { onExpire } });
    m.setPhase("a", 100, 0);
    run(m, 0, 90);
    expect(onExpire).not.toHaveBeenCalled();
    run(m, 90, 120);
    expect(onExpire).toHaveBeenCalled();
  });

  it("passes dt to onFrame — some phases run physics, not just countdowns", () => {
    const onFrame = vi.fn();
    const m = new PhaseMachine<P>("a", { a: { onFrame } });
    m.setPhase("a", 1000, 0);
    m.tick(16, 0.016);
    expect(onFrame).toHaveBeenCalledWith(16, expect.any(Number), 0.016);
  });

  it("never runs a phase forever when no duration is given", () => {
    const onExpire = vi.fn();
    const m = new PhaseMachine<P>("a", { a: { onExpire } });
    m.setPhase("a", undefined, 0);
    run(m, 0, 100_000);
    expect(onExpire).not.toHaveBeenCalled();
    expect(m.remaining(50_000)).toBe(Infinity);
  });

  describe("terminal phases (the game-over stutter bug)", () => {
    it("only fires the finish callback once, however many frames elapse", () => {
      const onGameOver = vi.fn();
      const m = new PhaseMachine<P>("a", {});
      m.finish(900, onGameOver, 0);
      run(m, 0, 3000);
      expect(onGameOver).toHaveBeenCalledOnce();
    });

    it("ignores repeat finish() calls — the exact guard four games were missing", () => {
      const first = vi.fn();
      const second = vi.fn();
      const m = new PhaseMachine<P>("a", {});
      m.finish(900, first, 0);
      m.finish(900, second, 0);
      m.finish(900, second, 0);
      run(m, 0, 2000);
      expect(first).toHaveBeenCalledOnce();
      expect(second).not.toHaveBeenCalled();
    });

    it("stops running phase handlers after finishing", () => {
      const onExpire = vi.fn();
      const onFrame = vi.fn();
      const m = new PhaseMachine<P>("a", { a: { onExpire, onFrame } });
      m.setPhase("a", 100, 0);
      m.finish(50, () => {}, 0);
      run(m, 0, 1000);
      expect(onExpire).not.toHaveBeenCalled();
      expect(onFrame).not.toHaveBeenCalled();
    });

    it("does not fire the finish callback before its delay", () => {
      const onGameOver = vi.fn();
      const m = new PhaseMachine<P>("a", {});
      m.finish(900, onGameOver, 0);
      run(m, 0, 800);
      expect(onGameOver).not.toHaveBeenCalled();
    });

    it("refuses further transitions once halted", () => {
      const onEnter = vi.fn();
      const m = new PhaseMachine<P>("a", { b: { onEnter } });
      m.finish(10, () => {}, 0);
      m.setPhase("b", 100, 0);
      expect(m.phase).toBe("a");
      expect(onEnter).not.toHaveBeenCalled();
    });
  });

  describe("re-entrancy", () => {
    it("does not expire a phase the frame's own onFrame just transitioned away from", () => {
      const bExpire = vi.fn();
      const m = new PhaseMachine<P>("a", {
        a: { onFrame: () => m.setPhase("b", 5000, 0) },
        b: { onExpire: bExpire },
      });
      // `a`'s deadline is already past, so without the guard the expiry check would run
      // against whatever phase onFrame just switched to.
      m.setPhase("a", 0, 0);
      m.tick(100, 0.016);
      expect(m.phase).toBe("b");
      expect(bExpire).not.toHaveBeenCalled();
    });

    it("dispatches at most one expiry per frame even when phases chain", () => {
      const bExpire = vi.fn();
      const m = new PhaseMachine<P>("a", {
        a: { onExpire: () => m.setPhase("b", 0, 0) },
        b: { onExpire: bExpire },
      });
      m.setPhase("a", 0, 0);
      m.tick(100, 0.016);
      expect(m.phase).toBe("b");
      expect(bExpire).not.toHaveBeenCalled(); // next frame's job
      m.tick(116, 0.016);
      expect(bExpire).toHaveBeenCalledOnce();
    });
  });

  describe("countdown ticks", () => {
    it("ticks once per second over the final three seconds", () => {
      const onCountdownTick = vi.fn();
      const m = new PhaseMachine<P>("a", { a: { countdownTicks: true } }, { onCountdownTick });
      m.setPhase("a", 5000, 0);
      run(m, 0, 5000);
      expect(onCountdownTick).toHaveBeenCalledTimes(3);
    });

    it("stays silent on phases that did not opt in", () => {
      const onCountdownTick = vi.fn();
      const m = new PhaseMachine<P>("a", { a: {} }, { onCountdownTick });
      m.setPhase("a", 5000, 0);
      run(m, 0, 5000);
      expect(onCountdownTick).not.toHaveBeenCalled();
    });

    it("restarts its cadence on a new phase rather than leaking timing across phases", () => {
      const onCountdownTick = vi.fn();
      const m = new PhaseMachine<P>("a", { a: { countdownTicks: true }, b: { countdownTicks: true } }, { onCountdownTick });
      m.setPhase("a", 5000, 0);
      const now = run(m, 0, 5000);
      onCountdownTick.mockClear();
      m.setPhase("b", 5000, now);
      run(m, now, now + 5000);
      expect(onCountdownTick).toHaveBeenCalledTimes(3);
    });
  });

  describe("endEarlyWhen", () => {
    const lockInSpec = (everyoneAnswered: () => boolean, onExpire: () => void): PhaseSpec => ({
      endEarlyWhen: everyoneAnswered,
      onExpire,
    });

    it("cuts a long phase short once everyone has answered", () => {
      const onExpire = vi.fn();
      let answered = false;
      const m = new PhaseMachine<P>("a", { a: lockInSpec(() => answered, onExpire) });
      m.setPhase("a", 30_000, 0);
      run(m, 0, 1000);
      expect(onExpire).not.toHaveBeenCalled();
      answered = true;
      run(m, 1000, 1000 + LOCK_IN_MS + 50);
      expect(onExpire).toHaveBeenCalled();
    });

    it("still leaves a lock-in beat rather than resolving instantly", () => {
      const onExpire = vi.fn();
      const m = new PhaseMachine<P>("a", { a: lockInSpec(() => true, onExpire) });
      m.setPhase("a", 30_000, 0);
      run(m, 0, LOCK_IN_MS - 200);
      expect(onExpire).not.toHaveBeenCalled();
      expect(m.isLockingIn).toBe(true);
    });

    it("never extends a phase that would have ended sooner on its own", () => {
      const onExpire = vi.fn();
      const m = new PhaseMachine<P>("a", { a: lockInSpec(() => true, onExpire) });
      m.setPhase("a", 500, 0); // shorter than the lock-in beat
      run(m, 0, 600);
      expect(onExpire).toHaveBeenCalled();
    });

    it("does not keep re-arming the lock-in on later frames", () => {
      const onExpire = vi.fn();
      const m = new PhaseMachine<P>("a", { a: lockInSpec(() => true, onExpire) });
      m.setPhase("a", 30_000, 0);
      run(m, 0, LOCK_IN_MS + 500);
      expect(onExpire).toHaveBeenCalled();
    });

    it("clears the locking-in flag on the next phase", () => {
      const m = new PhaseMachine<P>("a", { a: { endEarlyWhen: () => true }, b: {} });
      m.setPhase("a", 30_000, 0);
      m.tick(16, 0.016);
      expect(m.isLockingIn).toBe(true);
      m.setPhase("b", 1000, 16);
      expect(m.isLockingIn).toBe(false);
    });
  });
});
