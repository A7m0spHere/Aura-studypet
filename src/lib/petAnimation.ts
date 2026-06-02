import { useEffect, useReducer } from "react";
import type { PetEmotion } from "./types";

export type PetMotionName =
  | "idle"
  | "walk_right"
  | "walk_left"
  | "greet"
  | "jump"
  | "happy"
  | "thinking"
  | "scold"
  | "talk";
export type PetAnimationName = PetMotionName | PetEmotion | "dragging" | "dropped";
export type PetAnimationMode = "loop" | "once";
export type PetAnimationDirection = "left" | "right";

export interface PetAnimation {
  name: PetMotionName;
  mode: PetAnimationMode;
  then?: PetMotionName;
  priority?: number;
}

export interface PetAnimationState {
  animation: PetAnimation;
  defaultAnimation: PetMotionName;
  previousAnimation?: PetMotionName;
}

export type PetAction =
  | { type: "animation.set"; animation: PetAnimationName }
  | { type: "animation.play"; animation: PetAnimationName; mode?: PetAnimationMode; then?: PetAnimationName }
  | { type: "animation.complete" }
  | { type: "drag.start"; direction?: PetAnimationDirection }
  | { type: "drag.move"; direction: PetAnimationDirection }
  | { type: "drag.end" }
  | { type: "bubble.show"; animation?: PetAnimationName };

const ONCE_ANIMATION_MS = 920;

const PRIORITY_BY_ANIMATION: Record<PetMotionName, number> = {
  idle: 0,
  greet: 1,
  jump: 1,
  happy: 2,
  scold: 3,
  thinking: 4,
  talk: 5,
  walk_left: 6,
  walk_right: 6,
};

export function normalizePetAnimationName(animation: PetAnimationName | undefined): PetMotionName {
  switch (animation) {
    case "walk_right":
    case "walk_left":
    case "greet":
    case "jump":
    case "happy":
    case "thinking":
    case "scold":
    case "talk":
    case "idle":
      return animation;
    case "studying":
      return "thinking";
    case "nudge":
      return "scold";
    case "ended":
      return "happy";
    case "interact":
      return "greet";
    case "chat":
      return "talk";
    case "dragging":
      return "walk_right";
    case "dropped":
    default:
      return "idle";
  }
}

function priorityFor(animation: PetMotionName) {
  return PRIORITY_BY_ANIMATION[animation] ?? 0;
}

function animationState(
  name: PetAnimationName,
  mode: PetAnimationMode,
  then?: PetAnimationName,
): PetAnimation {
  const normalized = normalizePetAnimationName(name);
  return {
    name: normalized,
    mode,
    then: then ? normalizePetAnimationName(then) : undefined,
    priority: priorityFor(normalized),
  };
}

function canReplace(current: PetAnimation, next: PetAnimation) {
  if (current.mode === "loop") return true;
  return (next.priority ?? priorityFor(next.name)) >= (current.priority ?? priorityFor(current.name));
}

export function petAnimationReducer(
  state: PetAnimationState,
  action: PetAction,
): PetAnimationState {
  switch (action.type) {
    case "animation.set": {
      const defaultAnimation = normalizePetAnimationName(action.animation);
      const currentPriority = state.animation.priority ?? priorityFor(state.animation.name);
      if (state.animation.mode === "loop" && currentPriority <= priorityFor(defaultAnimation)) {
        return {
          ...state,
          defaultAnimation,
          animation: animationState(defaultAnimation, "loop"),
        };
      }
      return { ...state, defaultAnimation };
    }
    case "animation.play": {
      const next = animationState(action.animation, action.mode ?? "once", action.then);
      if (!canReplace(state.animation, next)) return state;
      return {
        ...state,
        animation: next,
      };
    }
    case "animation.complete": {
      if (state.animation.mode !== "once") return state;
      const next = state.animation.then ?? state.defaultAnimation;
      return {
        ...state,
        animation: animationState(next, "loop"),
        previousAnimation: undefined,
      };
    }
    case "drag.start": {
      const next = animationState(action.direction === "left" ? "walk_left" : "walk_right", "loop");
      return {
        ...state,
        previousAnimation:
          state.animation.name === "walk_left" || state.animation.name === "walk_right"
            ? state.previousAnimation
            : state.animation.name,
        animation: next,
      };
    }
    case "drag.move":
      if (state.animation.name !== "walk_left" && state.animation.name !== "walk_right") return state;
      return {
        ...state,
        animation: animationState(action.direction === "left" ? "walk_left" : "walk_right", "loop"),
      };
    case "drag.end": {
      const next = state.previousAnimation ?? state.defaultAnimation;
      return {
        ...state,
        animation: animationState(next, "loop"),
        previousAnimation: undefined,
      };
    }
    case "bubble.show": {
      if (!action.animation) return state;
      const normalized = normalizePetAnimationName(action.animation);
      const mode: PetAnimationMode = normalized === "thinking" || normalized === "talk" ? "loop" : "once";
      const next = animationState(normalized, mode, state.defaultAnimation);
      if (!canReplace(state.animation, next)) return state;
      return {
        ...state,
        animation: next,
      };
    }
    default:
      return state;
  }
}

export function usePetController(defaultAnimation: PetAnimationName) {
  const normalizedDefault = normalizePetAnimationName(defaultAnimation);
  const [state, dispatch] = useReducer(petAnimationReducer, {
    animation: animationState(normalizedDefault, "loop"),
    defaultAnimation: normalizedDefault,
  });

  useEffect(() => {
    dispatch({ type: "animation.set", animation: normalizedDefault });
  }, [normalizedDefault]);

  useEffect(() => {
    if (state.animation.mode !== "once") return;
    const timer = window.setTimeout(() => {
      dispatch({ type: "animation.complete" });
    }, ONCE_ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [state.animation.name, state.animation.mode]);

  return { pet: state, petDispatch: dispatch };
}
