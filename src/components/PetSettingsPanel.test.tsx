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

const xinhuaProfile = {
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
};

const elainaProfile = {
  ...xinhuaProfile,
  id: "elaina-2",
  display_name: "Elaina",
  spritesheet_path: "C:\\pets\\elaina-2\\spritesheet.webp",
  sprites: {},
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
    apiMock.getPetProfiles.mockResolvedValue([xinhuaProfile]);
    apiMock.rescanPetProfiles.mockResolvedValue({ profiles: [], messages: [] });
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

  it("opens the inline pet action preview from settings", async () => {
    const onPreviewActions = vi.fn();
    render(<PetSettingsPanel onPreviewActions={onPreviewActions} />);

    fireEvent.click(await screen.findByRole("button", { name: /预览动作/ }));

    expect(onPreviewActions).toHaveBeenCalled();
  });

  it("shows refreshed pet profiles and scan messages", async () => {
    apiMock.rescanPetProfiles.mockResolvedValue({
      profiles: [elainaProfile],
      messages: ["elaina-2：pet.json 未声明 spritesheetPath，已自动使用 spritesheet.webp。"],
    });

    render(<PetSettingsPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /刷新列表/ }));

    expect(await screen.findByText(/找到 1 个可用宠物/)).toBeInTheDocument();
    expect(screen.getByText(/已自动使用 spritesheet.webp/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Elaina" })).toBeInTheDocument();
  });

  it("syncs pet name and default persona when the active pet changes", async () => {
    apiMock.getPetProfiles.mockResolvedValue([xinhuaProfile, elainaProfile]);

    render(<PetSettingsPanel />);

    fireEvent.change(await screen.findByLabelText(/当前宠物/), { target: { value: "elaina-2" } });

    await waitFor(() =>
      expect(apiMock.savePetPreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          active_pet_id: "elaina-2",
          pet_name: "Elaina",
          pet_persona_prompt: expect.stringContaining("你是 Elaina"),
        }),
      ),
    );
  });

  it("uses profile persona when the active pet provides one", async () => {
    apiMock.getPetProfiles.mockResolvedValue([
      xinhuaProfile,
      {
        ...elainaProfile,
        persona: "custom Elaina persona",
      },
    ]);

    render(<PetSettingsPanel />);

    fireEvent.change(await screen.findByLabelText(/当前宠物/), { target: { value: "elaina-2" } });

    await waitFor(() =>
      expect(apiMock.savePetPreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          active_pet_id: "elaina-2",
          pet_name: "Elaina",
          pet_persona_prompt: "custom Elaina persona",
        }),
      ),
    );
  });

  it("shows a clear state when the saved active pet is missing from scan results", async () => {
    apiMock.getPetPreferences.mockResolvedValue({
      ...enabledPreferences,
      active_pet_id: "elaina-2",
      pet_name: "Elaina",
    });
    apiMock.getPetProfiles.mockResolvedValue([xinhuaProfile]);

    render(<PetSettingsPanel />);

    expect(await screen.findByText(/Elaina（配置存在，但宠物文件夹未通过扫描）/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /预览动作/ })).toBeDisabled();
  });
});
