// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardState, PetProfile } from "../lib/types";
import { PetWindow } from "./PetWindow";

const apiMock = vi.hoisted(() => ({
  getPetPreferences: vi.fn(),
  getCurrentStatus: vi.fn(),
  getPetProfiles: vi.fn(),
  hidePetWindow: vi.fn(),
  dragPetWindow: vi.fn(),
}));

const eventMock = vi.hoisted(() => ({
  listener: undefined as undefined | ((event: { payload: unknown }) => void),
}));

const windowMock = vi.hoisted(() => ({
  setPosition: vi.fn(),
  startDragging: vi.fn(),
  cursorPosition: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: apiMock,
  petAssetUrl: (path: string) => `asset://${path}`,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_name: string, callback: (event: { payload: unknown }) => void) => {
    eventMock.listener = callback;
    return Promise.resolve(vi.fn());
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    outerPosition: () => Promise.resolve({ x: 100, y: 120 }),
    outerSize: () => Promise.resolve({ width: 300, height: 380 }),
    setPosition: windowMock.setPosition,
    startDragging: windowMock.startDragging,
  }),
  cursorPosition: windowMock.cursorPosition,
  currentMonitor: () =>
    Promise.resolve({
      workArea: {
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
      },
    }),
  PhysicalPosition: class PhysicalPosition {
    x: number;
    y: number;

    constructor(x: number, y: number) {
      this.x = x;
      this.y = y;
    }
  },
}));

function dashboard(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    session_status: "idle",
    today_study_seconds: 0,
    current_session_seconds: 0,
    current_app: "Code",
    current_window_title: "Aura",
    keyboard_count: 0,
    mouse_count: 0,
    focus_score: 0,
    app_usage: [],
    activity: [],
    pomodoro: {
      status: "idle",
      total_seconds: 1500,
      remaining_seconds: 1500,
      completed_count: 0,
    },
    active_report_id: null,
    ai_summary: null,
    ...overrides,
  };
}

const profile: PetProfile = {
  id: "aura",
  display_name: "Aura",
  description: "test",
  spritesheet_path: "fallback.webp",
  sprites: {
    idle: "idle.png",
    happy: "happy.png",
  },
  persona: null,
  sprite_scale: 1,
  theme_color: null,
  default_emotion: "idle",
  bubble_lines: [],
};

function firePointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: { pointerId: number; button?: number; x?: number; y?: number },
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    button: { value: init.button ?? 0 },
    clientX: { value: init.x ?? 0 },
    clientY: { value: init.y ?? 0 },
    screenX: { value: init.x ?? 0 },
    screenY: { value: init.y ?? 0 },
  });
  fireEvent(target, event);
}

describe("PetWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventMock.listener = undefined;
    apiMock.getPetPreferences.mockResolvedValue({
      pet_enabled: true,
      pet_name: "Aura",
      pet_persona_prompt: "",
      pet_bubble_enabled: true,
      proactive_ai_enabled: false,
      idle_nudge_minutes: 30,
      app_switch_nudge_enabled: true,
      active_pet_id: "aura",
      first_pet_enable_seen: true,
    });
    apiMock.getCurrentStatus.mockResolvedValue(dashboard());
    apiMock.getPetProfiles.mockResolvedValue([profile]);
    apiMock.hidePetWindow.mockResolvedValue(undefined);
    apiMock.dragPetWindow.mockResolvedValue(undefined);
    windowMock.setPosition.mockResolvedValue(undefined);
    windowMock.startDragging.mockResolvedValue(undefined);
    windowMock.cursorPosition.mockResolvedValue({ x: 150, y: 180 });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("switches sprite and bubble when structured pet bubble event includes emotion", async () => {
    render(<PetWindow />);

    const image = await screen.findByRole("img", { name: "Aura" });
    await waitFor(() => expect(image).toHaveStyle({ backgroundImage: 'url("asset://idle.png")' }));

    eventMock.listener?.({ payload: { message: "Nice work", emotion: "happy" } });

    expect(await screen.findByText("Nice work")).toBeInTheDocument();
    await waitFor(() => expect(image).toHaveStyle({ backgroundImage: 'url("asset://happy.png")' }));
  });

  it("keeps old string pet bubble events working", async () => {
    render(<PetWindow />);

    await screen.findByRole("img", { name: "Aura" });
    eventMock.listener?.({ payload: "Legacy event text" });

    expect(await screen.findByText("Legacy event text")).toBeInTheDocument();
  });

  it("uses custom pointer dragging instead of native window dragging", async () => {
    render(<PetWindow />);

    await screen.findByRole("img", { name: "Aura" });
    const stage = document.querySelector(".pet-stage") as HTMLElement;

    firePointer(stage, "pointerdown", { button: 0, pointerId: 7, x: 150, y: 180 });

    await waitFor(() => expect(stage).toHaveClass("pet-stage-dragging"));
    expect(windowMock.startDragging).not.toHaveBeenCalled();

    windowMock.cursorPosition.mockResolvedValueOnce({ x: 190, y: 220 });
    firePointer(stage, "pointermove", { pointerId: 7, x: 190, y: 220 });

    await waitFor(() => expect(windowMock.setPosition).toHaveBeenCalled());
    const position = windowMock.setPosition.mock.calls.at(-1)?.[0];
    expect(position).toMatchObject({ x: 140, y: 160 });
  });

  it("drops back after pointer up", async () => {
    vi.useFakeTimers();
    render(<PetWindow />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const stage = document.querySelector(".pet-stage") as HTMLElement;

    firePointer(stage, "pointerdown", { button: 0, pointerId: 3, x: 150, y: 180 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    firePointer(stage, "pointerup", { pointerId: 3 });
    expect(stage).toHaveClass("pet-stage-dropped");

    act(() => {
      vi.advanceTimersByTime(220);
    });

    expect(stage).not.toHaveClass("pet-stage-dropped");
  });

  it("does not start dragging from the hide button", async () => {
    render(<PetWindow />);

    const button = await screen.findByRole("button", { name: "隐藏桌宠" });
    fireEvent.pointerDown(button, { button: 0, pointerId: 4, screenX: 150, screenY: 180 });
    fireEvent.click(button);

    expect(windowMock.setPosition).not.toHaveBeenCalled();
    expect(apiMock.hidePetWindow).toHaveBeenCalledTimes(1);
  });
});
