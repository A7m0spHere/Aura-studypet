// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardState, PetPreferences } from "../lib/types";
import { PetContextMenu } from "./PetContextMenu";

const apiMock = vi.hoisted(() => ({
  getCurrentStatus: vi.fn(),
  getPetPreferences: vi.fn(),
  savePetPreferences: vi.fn(),
  applyPetWindowPreferences: vi.fn(),
  hidePetMenu: vi.fn(),
  showMainWindow: vi.fn(),
  startSession: vi.fn(),
  stopSession: vi.fn(),
  startPomodoro: vi.fn(),
  sendProactivePetNudge: vi.fn(),
  generateAiSummary: vi.fn(),
  hidePetWindow: vi.fn(),
}));

const eventMock = vi.hoisted(() => ({
  listener: undefined as undefined | (() => void),
  emitTo: vi.fn(),
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    api: apiMock,
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: eventMock.emitTo,
  listen: vi.fn((_name: string, callback: () => void) => {
    eventMock.listener = callback;
    return Promise.resolve(vi.fn());
  }),
}));

const dashboard: DashboardState = {
  session_status: "studying",
  today_study_seconds: 3661,
  current_session_seconds: 1200,
  current_app: "Code",
  current_window_title: "Aura",
  keyboard_count: 12,
  mouse_count: 4,
  focus_score: 82,
  app_usage: [],
  activity: [],
  pomodoro: {
    status: "idle",
    total_seconds: 25 * 60,
    remaining_seconds: 25 * 60,
    completed_count: 1,
  },
  active_report_id: 7,
  ai_summary: null,
};

const preferences: PetPreferences = {
  pet_enabled: true,
  pet_name: "Aura",
  pet_persona_prompt: "",
  pet_bubble_enabled: true,
  proactive_ai_enabled: true,
  idle_nudge_minutes: 30,
  app_switch_nudge_enabled: true,
  active_pet_id: "",
  first_pet_enable_seen: true,
  pet_always_on_top: true,
  pet_scale: 1,
};

describe("PetContextMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventMock.listener = undefined;
    apiMock.getCurrentStatus.mockResolvedValue(dashboard);
    apiMock.getPetPreferences.mockResolvedValue(preferences);
    apiMock.savePetPreferences.mockImplementation((next) => Promise.resolve(next));
    apiMock.applyPetWindowPreferences.mockResolvedValue(undefined);
    apiMock.hidePetMenu.mockResolvedValue(undefined);
    apiMock.showMainWindow.mockResolvedValue(undefined);
    apiMock.startPomodoro.mockResolvedValue({
      status: "running",
      total_seconds: 25 * 60,
      remaining_seconds: 25 * 60,
      completed_count: 1,
    });
    apiMock.sendProactivePetNudge.mockResolvedValue({
      message: "你已经做得很好了，继续保持。",
      emotion: "happy",
      event_type: "idle_app",
      created_at: new Date().toISOString(),
    });
  });

  afterEach(() => cleanup());

  it("renders study status and opens API settings", async () => {
    render(<PetContextMenu />);

    expect(await screen.findByText("今日状态：专注中")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /API 配置/ }));

    await waitFor(() => expect(apiMock.showMainWindow).toHaveBeenCalledWith("ai"));
    expect(apiMock.hidePetMenu).toHaveBeenCalled();
  });

  it("starts pomodoro and persists always-on-top changes", async () => {
    render(<PetContextMenu />);

    fireEvent.click(await screen.findByRole("button", { name: /置顶显示/ }));
    await waitFor(() =>
      expect(apiMock.savePetPreferences).toHaveBeenCalledWith({
        ...preferences,
        pet_always_on_top: false,
      }),
    );
    expect(apiMock.applyPetWindowPreferences).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "番茄钟（25分钟）" }));
    await waitFor(() => expect(apiMock.startPomodoro).toHaveBeenCalledWith(25));
  });

  it("refreshes dashboard and preferences when the menu window is opened", async () => {
    apiMock.getCurrentStatus
      .mockResolvedValueOnce({ ...dashboard, session_status: "idle", today_study_seconds: 0 })
      .mockResolvedValueOnce(dashboard);
    render(<PetContextMenu />);

    expect(await screen.findByText("今日状态：刚开始")).toBeInTheDocument();

    eventMock.listener?.();

    expect(await screen.findByText("今日状态：专注中")).toBeInTheDocument();
    await waitFor(() => expect(apiMock.getCurrentStatus).toHaveBeenCalledTimes(2));
    expect(apiMock.getPetPreferences).toHaveBeenCalledTimes(2);
  });

  it("sends encouragement to the pet bubble from the quick menu", async () => {
    render(<PetContextMenu />);

    fireEvent.click(await screen.findByText("快捷菜单"));
    fireEvent.click(screen.getByRole("button", { name: "让 Aura 鼓励一下" }));

    await waitFor(() => expect(apiMock.sendProactivePetNudge).toHaveBeenCalledWith("idle_app"));
    expect(eventMock.emitTo).toHaveBeenCalledWith("pet", "pet-bubble", {
      message: "你已经做得很好了，继续保持。",
      emotion: "happy",
    });
    expect(apiMock.hidePetMenu).toHaveBeenCalled();
  });
});
