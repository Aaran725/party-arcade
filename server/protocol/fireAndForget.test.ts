import { describe, it, expect, vi, afterEach } from "vitest";
import { fireAndForget } from "./handlers";

describe("fireAndForget", () => {
  afterEach(() => vi.restoreAllMocks());

  it("swallows a promise rejection instead of leaving it unhandled", async () => {
    const unhandled = vi.fn();
    process.once("unhandledRejection", unhandled);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    fireAndForget(async () => {
      throw new Error("simulated AI call failure");
    });

    // Let the microtask queue (the .catch() below the throw) actually run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unhandled).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("does nothing extra when the wrapped function succeeds", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let ran = false;
    fireAndForget(async () => {
      ran = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ran).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
