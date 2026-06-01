import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  AiSettingsInput,
  AiSettingsMasked,
  AiTestResult,
  AiModelList,
  AppPreferences,
  AuraChatMessage,
  AiSummaryTone,
  ExportFormat,
  ChatMessage,
  DailyReport,
  DashboardState,
  PetPreferences,
  PetProfile,
  PomodoroState,
  ProactivePetNudge,
  Session,
} from "./types";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const emptyDashboard: DashboardState = {
  session_status: "idle",
  today_study_seconds: 0,
  current_session_seconds: 0,
  current_app: "Not started",
  current_window_title: "Start a study session to record the active window",
  keyboard_count: 0,
  mouse_count: 0,
  focus_score: 0,
  app_usage: [],
  activity: [],
  pomodoro: {
    status: "idle",
    total_seconds: 25 * 60,
    remaining_seconds: 25 * 60,
    completed_count: 0,
  },
};

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    if (command === "get_current_status" || command === "get_today_dashboard") {
      return emptyDashboard as T;
    }
    throw new Error("Aura needs to run inside the Tauri desktop app for this action.");
  }

  return invoke<T>(command, args);
}

export const api = {
  startSession: () => call<Session>("start_session"),
  stopSession: () => call<DailyReport>("stop_session"),
  getCurrentStatus: () => call<DashboardState>("get_current_status"),
  getTodayDashboard: () => call<DashboardState>("get_today_dashboard"),
  startPomodoro: (minutes: number) => call<PomodoroState>("start_pomodoro", { minutes }),
  pausePomodoro: () => call<PomodoroState>("pause_pomodoro"),
  resetPomodoro: () => call<PomodoroState>("reset_pomodoro"),
  saveAiSettings: (settings: AiSettingsInput) => call<void>("save_ai_settings", { settings }),
  getAiSettingsMasked: () => call<AiSettingsMasked>("get_ai_settings_masked"),
  deleteAiSettingsProvider: (provider: string) => call<void>("delete_ai_settings_provider", { provider }),
  testAiConnection: (settings: AiSettingsInput) =>
    call<AiTestResult>("test_ai_connection", { settings }),
  listAiModels: (settings: AiSettingsInput) => call<AiModelList>("list_ai_models", { settings }),
  generateAiSummary: (reportId: number, tone?: AiSummaryTone) =>
    call<string>("generate_ai_summary", { report_id: reportId, tone }),
  chatWithAi: (reportId: number, message: string) =>
    call<ChatMessage>("chat_with_ai", { report_id: reportId, message }),
  chatWithAura: (message: string) => call<AuraChatMessage>("chat_with_aura", { message }),
  getAuraChatHistory: () => call<AuraChatMessage[]>("get_aura_chat_history"),
  clearAuraChatHistory: () => call<void>("clear_aura_chat_history"),
  getRecentReports: (limit = 30) => call<DailyReport[]>("get_recent_reports", { limit }),
  deleteDailyReport: (reportId: number) => call<void>("delete_daily_report", { report_id: reportId }),
  exportDailyReport: (reportId: number, format: ExportFormat) =>
    call<string>("export_daily_report", { report_id: reportId, format }),
  getDataDir: () => call<string>("get_data_dir"),
  openDataDir: () => call<void>("open_data_dir"),
  clearLocalData: () => call<void>("clear_local_data"),
  getAppPreferences: () => call<AppPreferences>("get_app_preferences"),
  saveAppPreferences: (preferences: AppPreferences) =>
    call<AppPreferences>("save_app_preferences", { preferences }),
  getPetPreferences: () => call<PetPreferences>("get_pet_preferences"),
  savePetPreferences: (preferences: PetPreferences) =>
    call<PetPreferences>("save_pet_preferences", { preferences }),
  showPetWindow: () => call<void>("show_pet_window"),
  hidePetWindow: () => call<void>("hide_pet_window"),
  dragPetWindow: () => call<void>("drag_pet_window"),
  showPetMenu: (x: number, y: number) => call<void>("show_pet_menu", { x, y }),
  hidePetMenu: () => call<void>("hide_pet_menu"),
  showMainWindow: (settingsTab?: "pet" | "ai" | "privacy-data") =>
    call<void>("show_main_window", { settings_tab: settingsTab }),
  applyPetWindowPreferences: () => call<void>("apply_pet_window_preferences"),
  getPetLibraryDir: () => call<string>("get_pet_library_dir"),
  openPetLibraryDir: () => call<void>("open_pet_library_dir"),
  importPetProfile: (folderPath: string) =>
    call<PetProfile>("import_pet_profile", { folder_path: folderPath }),
  getPetProfiles: () => call<PetProfile[]>("get_pet_profiles"),
  rescanPetProfiles: () => call<PetProfile[]>("rescan_pet_profiles"),
  sendProactivePetNudge: (eventType: "idle_app" | "app_switch") =>
    call<ProactivePetNudge>("send_proactive_pet_nudge", { event_type: eventType }),
};

export function petAssetUrl(path: string) {
  if (!isTauriRuntime() || !path) return path;
  return convertFileSrc(path);
}

export function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
