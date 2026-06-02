// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { normalizePetAnimationName, petAnimationReducer, usePetController } from "./petAnimation";

describe("petAnimationReducer", () => {
  it("returns once animations to the default animation", () => {
    const state = petAnimationReducer(
      {
        animation: { name: "idle", mode: "loop" },
        defaultAnimation: "thinking",
      },
      { type: "animation.play", animation: "happy", mode: "once" },
    );

    expect(state.animation).toMatchObject({ name: "happy", mode: "once" });

    const completed = petAnimationReducer(state, { type: "animation.complete" });

    expect(completed.animation).toMatchObject({ name: "thinking", mode: "loop" });
  });

  it("turns drag start and drag end into pet states", () => {
    const dragging = petAnimationReducer(
      {
        animation: { name: "thinking", mode: "loop", priority: 4 },
        defaultAnimation: "thinking",
      },
      { type: "drag.start", direction: "left" },
    );

    expect(dragging.animation).toMatchObject({ name: "walk_left", mode: "loop" });
    expect(dragging.previousAnimation).toBe("thinking");

    const dropped = petAnimationReducer(dragging, { type: "drag.end" });

    expect(dropped.animation).toMatchObject({ name: "thinking", mode: "loop" });
  });

  it("keeps higher-priority once animations from being interrupted by click animations", () => {
    const thinking = petAnimationReducer(
      {
        animation: { name: "idle", mode: "loop", priority: 0 },
        defaultAnimation: "idle",
      },
      { type: "bubble.show", animation: "scold" },
    );

    const clicked = petAnimationReducer(thinking, { type: "animation.play", animation: "greet", mode: "once" });

    expect(clicked.animation).toMatchObject({ name: "scold", mode: "once" });
  });

  it("normalizes legacy emotions to the new motion names", () => {
    expect(normalizePetAnimationName("studying")).toBe("thinking");
    expect(normalizePetAnimationName("nudge")).toBe("scold");
    expect(normalizePetAnimationName("ended")).toBe("happy");
    expect(normalizePetAnimationName("interact")).toBe("greet");
    expect(normalizePetAnimationName("chat")).toBe("talk");
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
