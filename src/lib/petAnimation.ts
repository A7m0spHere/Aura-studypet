import { useEffect, useReducer } from "react";
import type { PetEmotion } from "./types";

export type PetAnimationName = PetEmotion | "dragging" | "dropped";
export type PetAnimationMode = "loop" | "once";

export interface PetAnimation {
  name: PetAnimationName;
  mode: PetAnimationMode;
  then?: PetAnimationName;
}

export interface PetAnimationState {
  animation: PetAnimation;
  defaultAnimation: PetAnimationName;
  previousAnimation?: PetAnimationName;
}

export type PetAction =
  | { type: "animation.set"; animation: PetAnimationName }
  | { type: "animation.play"; animation: PetAnimationName; mode?: PetAnimationMode; then?: PetAnimationName }
  | { type: "animation.complete" }
  | { type: "drag.start" }
  | { type: "drag.end" }
  | { type: "bubble.show"; animation?: PetAnimationName };

const ONCE_ANIMATION_MS = 920;
const DROP_ANIMATION_MS = 220;

export function petAnimationReducer(
  state: PetAnimationState,
  action: PetAction,
): PetAnimationState {
  switch (action.type) {
    case "animation.set": {
      const defaultAnimation = action.animation;
      if (state.animation.mode === "loop" && state.animation.name !== "dragging") {
        return {
          ...state,
          defaultAnimation,
          animation: { name: defaultAnimation, mode: "loop" },
        };
      }
      return { ...state, defaultAnimation };
    }
    case "animation.play":
      return {
        ...state,
        animation: {
          name: action.animation,
          mode: action.mode ?? "once",
          then: action.then,
        },
      };
    case "animation.complete": {
      if (state.animation.mode !== "once") return state;
      const next = state.animation.then ?? state.defaultAnimation;
      return {
        ...state,
        animation: { name: next, mode: "loop" },
        previousAnimation: undefined,
      };
    }
    case "drag.start":
      return {
        ...state,
        previousAnimation:
          state.animation.name === "dragging" || state.animation.name === "dropped"
            ? state.previousAnimation
            : state.animation.name,
        animation: { name: "dragging", mode: "loop" },
      };
    case "drag.end":
      return {
        ...state,
        animation: {
          name: "dropped",
          mode: "once",
          then: state.previousAnimation ?? state.defaultAnimation,
        },
      };
    case "bubble.show":
      if (!action.animation) return state;
      return {
        ...state,
        animation: {
          name: action.animation,
          mode: "once",
          then: state.defaultAnimation,
        },
      };
    default:
      return state;
  }
}

export function usePetController(defaultAnimation: PetAnimationName) {
  const [state, dispatch] = useReducer(petAnimationReducer, {
    animation: { name: defaultAnimation, mode: "loop" },
    defaultAnimation,
  });

  useEffect(() => {
    dispatch({ type: "animation.set", animation: defaultAnimation });
  }, [defaultAnimation]);

  useEffect(() => {
    if (state.animation.mode !== "once") return;
    const delay = state.animation.name === "dropped" ? DROP_ANIMATION_MS : ONCE_ANIMATION_MS;
    const timer = window.setTimeout(() => {
      dispatch({ type: "animation.complete" });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [state.animation.name, state.animation.mode]);

  return { pet: state, petDispatch: dispatch };
}
