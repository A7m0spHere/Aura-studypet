// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { petAnimationReducer, usePetController } from "./petAnimation";

describe("petAnimationReducer", () => {
  it("returns once animations to the default animation", () => {
    const state = petAnimationReducer(
      {
        animation: { name: "idle", mode: "loop" },
        defaultAnimation: "studying",
      },
      { type: "animation.play", animation: "happy", mode: "once" },
    );

    expect(state.animation).toEqual({ name: "happy", mode: "once", then: undefined });

    const completed = petAnimationReducer(state, { type: "animation.complete" });

    expect(completed.animation).toEqual({ name: "studying", mode: "loop" });
  });

  it("turns drag start and drag end into pet states", () => {
    const dragging = petAnimationReducer(
      {
        animation: { name: "studying", mode: "loop" },
        defaultAnimation: "studying",
      },
      { type: "drag.start" },
    );

    expect(dragging.animation).toEqual({ name: "dragging", mode: "loop" });
    expect(dragging.previousAnimation).toBe("studying");

    const dropped = petAnimationReducer(dragging, { type: "drag.end" });

    expect(dropped.animation).toEqual({ name: "dropped", mode: "once", then: "studying" });
  });
});

describe("usePetController", () => {
  it("automatically completes once animations", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePetController("idle"));

    act(() => {
      result.current.petDispatch({ type: "animation.play", animation: "happy", mode: "once" });
    });

    expect(result.current.pet.animation.name).toBe("happy");

    act(() => {
      vi.advanceTimersByTime(920);
    });

    expect(result.current.pet.animation.name).toBe("idle");
    vi.useRealTimers();
  });
});
