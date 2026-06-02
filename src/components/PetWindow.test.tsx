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
  showPetMenu: vi.fn(),
  chatWithAura: vi.fn(),
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

const atlasProfile: PetProfile = {
  ...profile,
  spritesheet_path: "atlas.webp",
  sprites: {},
  atlas: {
    columns: 8,
    row_count: 9,
    frame_width: 192,
    frame_height: 208,
    rows: Array.from({ length: 9 }, () => [0, 1, 2, 3, 4, 5]),
  },
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
      pet_always_on_top: true,
      pet_scale: 1,
    });
    apiMock.getCurrentStatus.mockResolvedValue(dashboard());
    apiMock.getPetProfiles.mockResolvedValue([profile]);
    apiMock.hidePetWindow.mockResolvedValue(undefined);
    apiMock.dragPetWindow.mockResolvedValue(undefined);
    apiMock.showPetMenu.mockResolvedValue(undefined);
    apiMock.chatWithAura.mockResolvedValue({
      id: 10,
      role: "assistant",
      content: "我在。",
      emotion: "happy",
      created_at: new Date().toISOString(),
    });
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

  it("uses walk animations for drag direction", async () => {
    apiMock.getPetProfiles.mockResolvedValueOnce([atlasProfile]);
    render(<PetWindow />);

    const image = await screen.findByRole("img", { name: "Aura" });
    const stage = document.querySelector(".pet-stage") as HTMLElement;

    firePointer(stage, "pointerdown", { button: 0, pointerId: 17, x: 150, y: 180 });
    expect(image).toHaveStyle({ backgroundPosition: "0px 0px" });

    windowMock.cursorPosition.mockResolvedValueOnce({ x: 170, y: 180 });
    firePointer(stage, "pointermove", { pointerId: 17, x: 170, y: 180 });

    await waitFor(() => expect(image).toHaveStyle({ backgroundPosition: "0px -416px" }));

    windowMock.cursorPosition.mockResolvedValueOnce({ x: 130, y: 180 });
    firePointer(stage, "pointermove", { pointerId: 17, x: 130, y: 180 });

    await waitFor(() => expect(image).toHaveStyle({ backgroundPosition: "0px -208px" }));
  });

  it("switches drag animation when horizontal trend changes", async () => {
    apiMock.getPetProfiles.mockResolvedValueOnce([atlasProfile]);
    render(<PetWindow />);

    const image = await screen.findByRole("img", { name: "Aura" });
    const stage = document.querySelector(".pet-stage") as HTMLElement;

    firePointer(stage, "pointerdown", { button: 0, pointerId: 18, x: 150, y: 180 });

    windowMock.cursorPosition.mockResolvedValueOnce({ x: 128, y: 180 });
    firePointer(stage, "pointermove", { pointerId: 18, x: 128, y: 180 });
    await waitFor(() => expect(image).toHaveStyle({ backgroundPosition: "0px -208px" }));

    windowMock.cursorPosition.mockResolvedValueOnce({ x: 164, y: 180 });
    firePointer(stage, "pointermove", { pointerId: 18, x: 164, y: 180 });
    await waitFor(() => expect(image).toHaveStyle({ backgroundPosition: "0px -416px" }));
  });

  it("opens the custom pet menu on right click", async () => {
    render(<PetWindow />);

    await screen.findByRole("img", { name: "Aura" });
    const stage = document.querySelector(".pet-stage") as HTMLElement;
    fireEvent.contextMenu(stage, { screenX: 320, screenY: 240 });

    await waitFor(() => expect(apiMock.showPetMenu).toHaveBeenCalledWith(408, 138));
    expect(apiMock.dragPetWindow).not.toHaveBeenCalled();
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

  it("does not run single-click interaction after dragging", async () => {
    apiMock.getPetProfiles.mockResolvedValueOnce([{ ...profile, bubble_lines: ["drag should not click"] }]);
    render(<PetWindow />);

    await screen.findByRole("img", { name: "Aura" });
    vi.useFakeTimers();
    const stage = document.querySelector(".pet-stage") as HTMLElement;

    firePointer(stage, "pointerdown", { button: 0, pointerId: 12, x: 150, y: 180 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    windowMock.cursorPosition.mockResolvedValueOnce({ x: 170, y: 200 });
    firePointer(stage, "pointermove", { pointerId: 12, x: 170, y: 200 });
    firePointer(stage, "pointerup", { pointerId: 12, x: 170, y: 200 });
    fireEvent.click(stage);

    act(() => {
      vi.advanceTimersByTime(220);
    });

    expect(screen.queryByText("drag should not click")).not.toBeInTheDocument();
  });

  it("does not render an in-window hide button", async () => {
    render(<PetWindow />);

    await screen.findByRole("img", { name: "Aura" });

    expect(windowMock.setPosition).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(apiMock.hidePetWindow).not.toHaveBeenCalled();
  });

  it("opens chat on double click without running single-click interaction", async () => {
    apiMock.getPetProfiles.mockResolvedValueOnce([{ ...profile, bubble_lines: ["single click only"] }]);
    render(<PetWindow />);

    await screen.findByRole("img", { name: "Aura" });
    vi.useFakeTimers();
    const stage = document.querySelector(".pet-stage") as HTMLElement;

    fireEvent.click(stage);
    fireEvent.doubleClick(stage);

    expect(screen.getByPlaceholderText("和 Aura 说点什么")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(screen.queryByText("single click only")).not.toBeInTheDocument();
  });

  it("plays greet or jump when the pet is clicked", async () => {
    apiMock.getPetProfiles.mockResolvedValueOnce([atlasProfile]);
    render(<PetWindow />);

    const image = await screen.findByRole("img", { name: "Aura" });
    vi.useFakeTimers();
    const stage = document.querySelector(".pet-stage") as HTMLElement;

    fireEvent.click(stage);
    act(() => {
      vi.advanceTimersByTime(180);
    });

    expect(image).toHaveStyle({ backgroundPosition: "0px -624px" });
  });

  it("keeps chat form events from starting pet drag", async () => {
    render(<PetWindow />);

    await screen.findByRole("img", { name: "Aura" });
    const stage = document.querySelector(".pet-stage") as HTMLElement;
    fireEvent.doubleClick(stage);
    const input = await screen.findByPlaceholderText("和 Aura 说点什么");

    firePointer(input, "pointerdown", { button: 0, pointerId: 11, x: 150, y: 180 });

    expect(windowMock.setPosition).not.toHaveBeenCalled();
    expect(apiMock.dragPetWindow).not.toHaveBeenCalled();
  });

  it("sends pet chat and shows the assistant reply", async () => {
    render(<PetWindow />);

    await screen.findByRole("img", { name: "Aura" });
    const stage = document.querySelector(".pet-stage") as HTMLElement;
    fireEvent.doubleClick(stage);

    const input = await screen.findByPlaceholderText("和 Aura 说点什么");
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await waitFor(() => expect(apiMock.chatWithAura).toHaveBeenCalledWith("你好"));
    expect(await screen.findByText("我在。")).toBeInTheDocument();
  });

  it("hides assistant bubbles after timeout while chat is open", async () => {
    render(<PetWindow />);

    await screen.findByRole("img", { name: "Aura" });
    const stage = document.querySelector(".pet-stage") as HTMLElement;
    fireEvent.doubleClick(stage);
    expect(await screen.findByPlaceholderText("和 Aura 说点什么")).toBeInTheDocument();

    vi.useFakeTimers();
    act(() => {
      eventMock.listener?.({ payload: { message: "继续加油", emotion: "happy" } });
    });

    expect(screen.getByText("继续加油")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.queryByText("继续加油")).not.toBeInTheDocument();
  });

  it("closes chat from the inline close button without sending or dragging", async () => {
    render(<PetWindow />);

    await screen.findByRole("img", { name: "Aura" });
    const stage = document.querySelector(".pet-stage") as HTMLElement;
    fireEvent.doubleClick(stage);

    expect(await screen.findByPlaceholderText("和 Aura 说点什么")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭聊天框" }));

    expect(screen.queryByPlaceholderText("和 Aura 说点什么")).not.toBeInTheDocument();
    expect(apiMock.chatWithAura).not.toHaveBeenCalled();
    expect(windowMock.setPosition).not.toHaveBeenCalled();
    expect(apiMock.dragPetWindow).not.toHaveBeenCalled();
  });

  it("plays thinking while waiting for AI and talk when the reply arrives", async () => {
    apiMock.getPetProfiles.mockResolvedValueOnce([atlasProfile]);
    let resolveReply: (value: {
      id: number;
      role: "assistant";
      content: string;
      emotion: "happy";
      created_at: string;
    }) => void;
    apiMock.chatWithAura.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveReply = resolve;
      }),
    );
    render(<PetWindow />);

    const image = await screen.findByRole("img", { name: "Aura" });
    const stage = document.querySelector(".pet-stage") as HTMLElement;
    fireEvent.doubleClick(stage);

    const input = await screen.findByPlaceholderText("和 Aura 说点什么");
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await waitFor(() => expect(image).toHaveStyle({ backgroundPosition: "0px -1248px" }));

    resolveReply!({
      id: 11,
      role: "assistant",
      content: "我在。",
      emotion: "happy",
      created_at: new Date().toISOString(),
    });

    expect(await screen.findByText("我在。")).toBeInTheDocument();
    await waitFor(() => expect(image).toHaveStyle({ backgroundPosition: "0px -1664px" }));
  });

  it("shows pet chat failures as a bubble without crashing", async () => {
    apiMock.chatWithAura.mockRejectedValueOnce(new Error("AI unavailable"));
    render(<PetWindow />);

    await screen.findByRole("img", { name: "Aura" });
    const stage = document.querySelector(".pet-stage") as HTMLElement;
    fireEvent.doubleClick(stage);

    const input = await screen.findByPlaceholderText("和 Aura 说点什么");
    fireEvent.change(input, { target: { value: "报错测试" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(await screen.findByText("Error: AI unavailable")).toBeInTheDocument();
  });
});
