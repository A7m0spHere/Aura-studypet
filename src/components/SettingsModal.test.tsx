// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppPreferences } from "../lib/types";
import { SettingsModal } from "./SettingsModal";

const apiMock = vi.hoisted(() => ({
  getAiSettingsMasked: vi.fn(),
  saveAiSettings: vi.fn(),
  testAiConnection: vi.fn(),
  listAiModels: vi.fn(),
  getDataDir: vi.fn(),
  openDataDir: vi.fn(),
  clearLocalData: vi.fn(),
  getPetPreferences: vi.fn(),
  savePetPreferences: vi.fn(),
  showPetWindow: vi.fn(),
  hidePetWindow: vi.fn(),
  dragPetWindow: vi.fn(),
  applyPetWindowPreferences: vi.fn(),
  importPetProfile: vi.fn(),
  getPetProfiles: vi.fn(),
  getPetLibraryDir: vi.fn(),
  openPetLibraryDir: vi.fn(),
  rescanPetProfiles: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: apiMock,
}));

const preferences: AppPreferences = {
  privacy_notice_accepted: true,
  default_pomodoro_minutes: 25,
  ai_summary_tone: "witty",
  activity_capture_enabled: true,
};

function renderModal() {
  return render(
    <SettingsModal
      open
      onClose={vi.fn()}
      onShowPrivacy={vi.fn()}
      preferences={preferences}
      onSavePreferences={vi.fn()}
      onDataCleared={vi.fn()}
    />,
  );
}

async function openAiTab() {
  fireEvent.click(await screen.findByRole("button", { name: /AI 配置/ }));
}

async function openDataTab() {
  fireEvent.click(await screen.findByRole("button", { name: /隐私与数据/ }));
}

describe("SettingsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getAiSettingsMasked.mockResolvedValue({
      active_provider: "deepseek",
      providers: [
        {
          provider: "deepseek",
          base_url: "https://api.deepseek.com",
          model: "deepseek-v4-pro",
          api_key_masked: "******1111",
          configured: true,
          available_models: ["deepseek-v4-pro", "deepseek-v4-flash"],
          base_url_editable: false,
          api_key_required: true,
        },
        {
          provider: "custom",
          base_url: "https://api.example.com/v1",
          model: "custom-model",
          api_key_masked: "******2222",
          configured: true,
          available_models: [],
          base_url_editable: true,
          api_key_required: true,
        },
      ],
    });
    apiMock.saveAiSettings.mockResolvedValue(undefined);
    apiMock.testAiConnection.mockResolvedValue({
      ok: true,
      message: "API 可用，当前模型 deepseek-v4-pro 可正常响应。",
    });
    apiMock.listAiModels.mockResolvedValue({
      ok: true,
      models: ["demo-model-a", "demo-model-b"],
      message: "检测到 2 个可用模型。",
    });
    apiMock.getDataDir.mockResolvedValue("C:\\Users\\tester\\AppData\\Roaming\\com.aura.app");
    apiMock.openDataDir.mockResolvedValue(undefined);
    apiMock.clearLocalData.mockResolvedValue(undefined);
    apiMock.getPetPreferences.mockResolvedValue({
      pet_enabled: false,
      pet_name: "",
      pet_persona_prompt: "default persona",
      pet_bubble_enabled: true,
      proactive_ai_enabled: false,
      idle_nudge_minutes: 30,
      app_switch_nudge_enabled: true,
      active_pet_id: "",
      first_pet_enable_seen: false,
      pet_always_on_top: true,
      pet_scale: 1,
    });
    apiMock.savePetPreferences.mockImplementation((preferences) => Promise.resolve(preferences));
    apiMock.showPetWindow.mockResolvedValue(undefined);
    apiMock.hidePetWindow.mockResolvedValue(undefined);
    apiMock.applyPetWindowPreferences.mockResolvedValue(undefined);
    apiMock.getPetLibraryDir.mockResolvedValue("C:\\Users\\tester\\AppData\\Roaming\\com.aura.app\\pets");
    apiMock.openPetLibraryDir.mockResolvedValue(undefined);
    apiMock.importPetProfile.mockResolvedValue({
      id: "xinhua",
      display_name: "心华",
      description: "test pet",
      spritesheet_path: "C:\\pets\\xinhua\\spritesheet.webp",
      sprites: {},
      persona: null,
      sprite_scale: 1,
      theme_color: null,
      default_emotion: "idle",
      bubble_lines: [],
    });
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
    apiMock.rescanPetProfiles.mockResolvedValue([
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
  });

  afterEach(() => {
    cleanup();
  });

  it("uses left navigation and defaults to general settings", async () => {
    renderModal();

    expect(await screen.findByRole("button", { name: /常规/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Aura 桌宠/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /AI 配置/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /隐私与数据/ })).toBeInTheDocument();
    expect(screen.getByText("键鼠活跃度统计")).toBeInTheDocument();
  });

  it("removes the builtin public API template", async () => {
    renderModal();
    await openAiTab();

    expect(await screen.findByRole("button", { name: "DeepSeek" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "自定义 OpenAI 兼容 API" })).toBeInTheDocument();
    expect(screen.queryByText("内置公益 API")).not.toBeInTheDocument();
  });

  it("shows DeepSeek model choices and requires the user key field", async () => {
    renderModal();
    await openAiTab();

    fireEvent.click(await screen.findByRole("button", { name: "DeepSeek" }));

    expect(screen.getByDisplayValue("https://api.deepseek.com")).toBeDisabled();
    expect(screen.getByRole("option", { name: "deepseek-v4-pro" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "deepseek-v4-flash" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("******1111")).not.toBeDisabled();
  });

  it("tests the current form values without saving them", async () => {
    renderModal();
    await openAiTab();

    fireEvent.click(await screen.findByRole("button", { name: "测试 API" }));

    await waitFor(() => expect(apiMock.testAiConnection).toHaveBeenCalledTimes(1));
    expect(apiMock.saveAiSettings).not.toHaveBeenCalled();
    expect(await screen.findByText(/API 可用/)).toBeInTheDocument();
  });

  it("keeps DeepSeek and custom keys separated while switching templates", async () => {
    renderModal();
    await openAiTab();

    fireEvent.click(await screen.findByRole("button", { name: "DeepSeek" }));
    expect(screen.getByPlaceholderText("******1111")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "自定义 OpenAI 兼容 API" }));
    expect(screen.getByPlaceholderText("******2222")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://api.example.com/v1")).not.toBeDisabled();
  });

  it("detects custom models and allows selecting one", async () => {
    renderModal();
    await openAiTab();

    fireEvent.click(await screen.findByRole("button", { name: "自定义 OpenAI 兼容 API" }));
    fireEvent.click(screen.getByRole("button", { name: "检测可用模型" }));

    await waitFor(() => expect(apiMock.listAiModels).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("option", { name: "demo-model-a" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "demo-model-b" })).toBeInTheDocument();
  });

  it("keeps custom fields blank when no custom values are configured", async () => {
    apiMock.getAiSettingsMasked.mockResolvedValueOnce({
      active_provider: "custom",
      providers: [
        {
          provider: "deepseek",
          base_url: "https://api.deepseek.com",
          model: "deepseek-v4-pro",
          api_key_masked: "",
          configured: false,
          available_models: ["deepseek-v4-pro", "deepseek-v4-flash"],
          base_url_editable: false,
          api_key_required: true,
        },
        {
          provider: "custom",
          base_url: "",
          model: "",
          api_key_masked: "",
          configured: false,
          available_models: [],
          base_url_editable: true,
          api_key_required: true,
        },
      ],
    });

    renderModal();
    await openAiTab();

    expect(await screen.findByPlaceholderText("例如 https://api.example.com/v1")).not.toBeDisabled();
    expect(screen.getByPlaceholderText("可先检测模型，也可以手动输入")).not.toBeDisabled();
  });

  it("shows local data tools and clears data after double confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderModal();
    await openDataTab();

    expect(await screen.findByText("本地数据")).toBeInTheDocument();
    expect(await screen.findByText("C:\\Users\\tester\\AppData\\Roaming\\com.aura.app")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /清空本地数据/ }));

    await waitFor(() => expect(apiMock.clearLocalData).toHaveBeenCalledTimes(1));
  });

  it("requires an imported pet before enabling pet mode", async () => {
    apiMock.getPetProfiles.mockResolvedValueOnce([]);
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: /Aura 桌宠/ }));

    expect(await screen.findByText("尚未导入宠物")).toBeInTheDocument();
    expect(screen.getByText("请先导入宠物文件夹")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /启用/ })).toBeDisabled();
  });
});
