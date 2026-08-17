import { describe, expect, it } from "bun:test";
import { _internalNextIntervalMs as nextInterval } from "./orchestrator-loop.js";

describe("adaptive tick interval", () => {
  it("keeps the base interval for the first 5 idle ticks", () => {
    for (let idle = 0; idle <= 5; idle++) {
      expect(nextInterval(5000, idle)).toBe(5000);
    }
  });

  it("doubles after each subsequent idle tick (5s base)", () => {
    expect(nextInterval(5000, 6)).toBe(10_000); // 2× = 10s
    expect(nextInterval(5000, 7)).toBe(20_000); // 4× = 20s
    expect(nextInterval(5000, 8)).toBe(40_000); // 8× = 40s
  });

  it("clamps at the 12× ceiling (5s base → 60s max)", () => {
    expect(nextInterval(5000, 100)).toBe(60_000);
    expect(nextInterval(5000, 1_000_000)).toBe(60_000);
  });

  it("respects a non-default base interval (10s base → 120s ceiling)", () => {
    expect(nextInterval(10_000, 5)).toBe(10_000);
    expect(nextInterval(10_000, 6)).toBe(20_000);
    expect(nextInterval(10_000, 100)).toBe(120_000);
  });

  it("snaps back to base when consecutiveIdle resets to 0", () => {
    expect(nextInterval(5000, 50)).toBe(60_000); // ceiling
    expect(nextInterval(5000, 0)).toBe(5000); // immediate snap-back
  });
});
