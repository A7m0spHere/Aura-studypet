export type SessionStatus = "idle" | "studying" | "paused" | "ended";

export interface Session {
  id: number;
  started_at: string;
  ended_at?: string | null;
  status: SessionStatus;
}

export interface AppUsage {
  app_name: string;
  exe_path?: string | null;
  seconds: number;
}

export interface ActivityPoint {
  label: string;
  keyboard: number;
  mouse: number;
}

export interface PomodoroState {
  status: "idle" | "running" | "paused" | "completed";
  total_seconds: number;
  remaining_seconds: number;
  completed_count: number;
}

export interface DashboardState {
  session_status: SessionStatus;
  today_study_seconds: number;
  current_session_seconds: number;
  current_app: string;
  current_window_title: string;
  keyboard_count: number;
  mouse_count: number;
  focus_score: number;
  app_usage: AppUsage[];
  activity: ActivityPoint[];
  pomodoro: PomodoroState;
  active_report_id?: number | null;
  ai_summary?: string | null;
}

export interface DailyReport {
  id: number;
  session_id: number;
  started_at: string;
  ended_at: string;
  total_seconds: number;
  focus_score: number;
  app_usage: AppUsage[];
  activity: ActivityPoint[];
  pomodoro_completed: number;
  ai_summary?: string | null;
}

export type AiSummaryTone = "gentle" | "normal" | "witty" | "strict";

export interface AppPreferences {
  privacy_notice_accepted: boolean;
  default_pomodoro_minutes: number;
  ai_summary_tone: AiSummaryTone;
  activity_capture_enabled: boolean;
}

export interface PetPreferences {
  pet_enabled: boolean;
  pet_name: string;
  pet_persona_prompt: string;
  pet_bubble_enabled: boolean;
  proactive_ai_enabled: boolean;
  idle_nudge_minutes: number;
  app_switch_nudge_enabled: boolean;
  active_pet_id: string;
  first_pet_enable_seen: boolean;
}

export interface PetProfile {
  id: string;
  display_name: string;
  description: string;
  spritesheet_path: string;
  sprites: PetSpriteMap;
  atlas?: PetAtlasMetadata | null;
  persona?: string | null;
  sprite_scale: number;
  theme_color?: string | null;
  default_emotion: PetEmotion;
  bubble_lines: string[];
}

export interface PetAtlasMetadata {
  columns: number;
  row_count: number;
  frame_width: number;
  frame_height: number;
  rows: number[][];
}

export type PetEmotion = "idle" | "studying" | "thinking" | "happy" | "nudge" | "ended";

export type PetSpriteMap = Partial<Record<PetEmotion, string>>;

export interface AuraReply {
  message: string;
  emotion: PetEmotion;
  created_at: string;
}

export interface AuraChatMessage {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  emotion: PetEmotion;
  created_at: string;
}

export interface ProactivePetNudge {
  message: string;
  emotion: PetEmotion;
  event_type: "idle_app" | "app_switch";
  created_at: string;
}

export interface AiSettingsInput {
  provider: "deepseek" | "custom";
  base_url: string;
  api_key: string;
  model: string;
}

export interface AiSettingsMasked {
  active_provider: "deepseek" | "custom";
  providers: AiProviderSettingsMasked[];
}

export interface AiProviderSettingsMasked {
  provider: "deepseek" | "custom";
  base_url: string;
  model: string;
  api_key_masked: string;
  configured: boolean;
  available_models: string[];
  base_url_editable: boolean;
  api_key_required: boolean;
}

export interface AiTestResult {
  ok: boolean;
  message: string;
}

export interface AiModelList {
  ok: boolean;
  models: string[];
  message: string;
}

export type ExportFormat = "txt" | "markdown";

export interface ChatMessage {
  id: number;
  report_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}
