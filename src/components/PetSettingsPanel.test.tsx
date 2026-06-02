// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PetSettingsPanel } from "./PetSettingsPanel";

const apiMock = vi.hoisted(() => ({
  getPetPreferences: vi.fn(),
  savePetPreferences: vi.fn(),
  showPetWindow: vi.fn(),
  hidePetWindow: vi.fn(),
  applyPetWindowPreferences: vi.fn(),
  getPetProfiles: vi.fn(),
  getPetLibraryDir: vi.fn(),
  openPetLibraryDir: vi.fn(),
  rescanPetProfiles: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: apiMock,
}));

const enabledPreferences = {
  pet_enabled: true,
  pet_name: "Aura",
  pet_persona_prompt: "default persona",
  pet_bubble_enabled: true,
  proactive_ai_enabled: true,
  idle_nudge_minutes: 30,
  app_switch_nudge_enabled: true,
  active_pet_id: "xinhua",
  first_pet_enable_seen: true,
  pet_always_on_top: true,
  pet_scale: 1,
};

describe("PetSettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getPetPreferences.mockResolvedValue(enabledPreferences);
    apiMock.savePetPreferences.mockImplementation((preferences) => Promise.resolve(preferences));
    apiMock.showPetWindow.mockResolvedValue(undefined);
    apiMock.hidePetWindow.mockResolvedValue(undefined);
    apiMock.applyPetWindowPreferences.mockResolvedValue(undefined);
    apiMock.getPetLibraryDir.mockResolvedValue("C:\\Users\\tester\\AppData\\Roaming\\com.aura.app\\pets");
    apiMock.getPetProfiles.mockResolvedValue([
      {
        id: "xinhua",
        display_name: "心华",
        description: "test pet",
        spritesheet_path: "C:\\pets\\xinhua\\spritesheet.webp",
        sprites: { idle: "C:\\pets\\xinhua\\idle.png" },
        persona: null,
        sprite_scale: 1,
        theme_color: null,
        default_emotion: "idle",
        bubble_lines: [],
      },
    ]);
    apiMock.rescanPetProfiles.mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it("saves reminder toggles and applies pet window preferences", async () => {
    render(<PetSettingsPanel />);

    fireEvent.click(await screen.findByRole("checkbox", { name: /显示气泡/ }));
    await waitFor(() =>
      expect(apiMock.savePetPreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({ pet_bubble_enabled: false }),
      ),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /主动 AI 关心/ }));
    await waitFor(() =>
      expect(apiMock.savePetPreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({ proactive_ai_enabled: false }),
      ),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /应用切换提醒/ }));
    await waitFor(() =>
      expect(apiMock.savePetPreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({ app_switch_nudge_enabled: false }),
      ),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /桌宠置顶显示/ }));
    await waitFor(() =>
      expect(apiMock.savePetPreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({ pet_always_on_top: false }),
      ),
    );

    expect(apiMock.applyPetWindowPreferences).toHaveBeenCalled();
  });

  it("saves idle threshold and pet size controls", async () => {
    render(<PetSettingsPanel />);

    const idleInput = await screen.findByLabelText(/停留提醒阈值/);
    fireEvent.change(idleInput, { target: { value: "45" } });
    fireEvent.blur(idleInput);
    await waitFor(() =>
      expect(apiMock.savePetPreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({ idle_nudge_minutes: 45 }),
      ),
    );

    fireEvent.change(screen.getByLabelText(/桌宠大小/), { target: { value: "1.2" } });
    await waitFor(() =>
      expect(apiMock.savePetPreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({ pet_scale: 1.2 }),
      ),
    );

    expect(apiMock.applyPetWindowPreferences).toHaveBeenCalled();
  });
});
