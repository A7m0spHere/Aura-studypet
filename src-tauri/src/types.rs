use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::AtomicBool,
        Arc, Mutex,
    },
    thread::JoinHandle,
};

use crate::db::Database;
use crate::pomodoro::PomodoroMachine;
use serde::{Deserialize, Serialize};

use crate::{activity::ActivityHandle, pomodoro::PomodoroState};

pub type AppResult<T> = Result<T, String>;

pub const LEGACY_IDENTIFIER: &str = "com.studypulse.app";
pub const AURA_DB_FILE: &str = "aura.sqlite3";
pub const LEGACY_DB_FILE: &str = "studypulse.sqlite3";
pub const PET_ATLAS_COLUMNS: u32 = 8;
pub const PET_ATLAS_ROWS: u32 = 9;
pub const PET_ATLAS_FRAME_WIDTH: u32 = 192;
pub const PET_ATLAS_FRAME_HEIGHT: u32 = 208;
pub const PET_ATLAS_MIN_ALPHA_PIXELS: usize = 16;

pub(crate) struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub data_dir: PathBuf,
    pub active_session_id: Mutex<Option<i64>>,
    pub pomodoro: Arc<Mutex<PomodoroMachine>>,
    pub sampler: Mutex<Option<SamplerHandle>>,
    pub activity: Mutex<Option<ActivityHandle>>,
}

pub(crate) struct SamplerHandle {
    pub stop: Arc<AtomicBool>,
    pub handle: JoinHandle<()>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Session {
    pub id: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppUsage {
    pub app_name: String,
    pub exe_path: Option<String>,
    pub seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityPoint {
    pub label: String,
    pub keyboard: i64,
    pub mouse: i64,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DashboardState {
    pub session_status: String,
    pub today_study_seconds: i64,
    pub current_session_seconds: i64,
    pub current_app: String,
    pub current_window_title: String,
    pub keyboard_count: i64,
    pub mouse_count: i64,
    pub focus_score: i64,
    pub app_usage: Vec<AppUsage>,
    pub activity: Vec<ActivityPoint>,
    pub pomodoro: PomodoroState,
    pub active_report_id: Option<i64>,
    pub ai_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DailyReport {
    pub id: i64,
    pub session_id: i64,
    pub started_at: String,
    pub ended_at: String,
    pub total_seconds: i64,
    pub focus_score: i64,
    pub app_usage: Vec<AppUsage>,
    pub activity: Vec<ActivityPoint>,
    pub pomodoro_completed: i64,
    pub ai_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct AppPreferences {
    pub privacy_notice_accepted: bool,
    pub default_pomodoro_minutes: i64,
    pub ai_summary_tone: String,
    pub activity_capture_enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct AppPreferencesInput {
    pub privacy_notice_accepted: bool,
    pub default_pomodoro_minutes: i64,
    pub ai_summary_tone: String,
    pub activity_capture_enabled: bool,
}

pub const DEFAULT_PET_PERSONA_PROMPT: &str = "你是 Aura，一个轻量桌面 AI 伙伴。你会陪伴用户学习、工作和复盘。你的语气温和、简短、带一点轻微吐槽，但不能羞辱用户。你只能基于提供的行为数据回应，不要编造。如果用户表现不错，要具体夸奖。如果用户分心，要提醒但不要攻击。每次回复尽量控制在 80 字以内。";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PetPreferences {
    pub pet_enabled: bool,
    pub pet_name: String,
    pub pet_persona_prompt: String,
    pub pet_bubble_enabled: bool,
    pub proactive_ai_enabled: bool,
    pub idle_nudge_minutes: i64,
    pub app_switch_nudge_enabled: bool,
    pub active_pet_id: String,
    pub first_pet_enable_seen: bool,
    pub pet_always_on_top: bool,
    pub pet_scale: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct PetPreferencesInput {
    pub pet_enabled: bool,
    pub pet_name: String,
    pub pet_persona_prompt: String,
    pub pet_bubble_enabled: bool,
    pub proactive_ai_enabled: bool,
    pub idle_nudge_minutes: i64,
    pub app_switch_nudge_enabled: bool,
    pub active_pet_id: String,
    pub first_pet_enable_seen: bool,
    #[serde(default = "default_pet_always_on_top")]
    pub pet_always_on_top: bool,
    #[serde(default = "default_pet_scale")]
    pub pet_scale: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PetProfile {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub spritesheet_path: String,
    pub sprites: HashMap<String, String>,
    pub atlas: Option<PetAtlasMetadata>,
    pub persona: Option<String>,
    pub sprite_scale: f64,
    pub theme_color: Option<String>,
    pub default_emotion: String,
    pub bubble_lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PetAtlasMetadata {
    pub columns: u32,
    pub row_count: u32,
    pub frame_width: u32,
    pub frame_height: u32,
    pub rows: Vec<Vec<usize>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PetManifest {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub spritesheet_path: String,
    #[serde(default)]
    pub sprites: HashMap<String, String>,
    pub persona: Option<String>,
    #[serde(default = "default_sprite_scale")]
    pub sprite_scale: f64,
    pub theme_color: Option<String>,
    pub default_emotion: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BubbleLinesManifest {
    pub name: Option<String>,
    pub personality: Option<String>,
    pub bubble_style: Option<String>,
    pub lines: Option<BubbleLines>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ProactivePetNudge {
    pub message: String,
    pub emotion: String,
    pub event_type: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct AuraReply {
    pub message: String,
    pub emotion: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuraChatMessage {
    pub id: i64,
    pub role: String,
    pub content: String,
    pub emotion: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub(crate) enum BubbleLines {
    Flat(Vec<String>),
    Grouped(HashMap<String, Vec<String>>),
}

#[derive(Debug, Clone, Deserialize)]
pub struct AiSettingsInput {
    #[serde(default)]
    pub provider: Option<String>,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiSettingsMasked {
    pub active_provider: String,
    pub providers: Vec<AiProviderSettingsMasked>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiProviderSettingsMasked {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key_masked: String,
    pub configured: bool,
    pub available_models: Vec<String>,
    pub base_url_editable: bool,
    pub api_key_required: bool,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct AiTestResult {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct AiModelList {
    pub ok: bool,
    pub models: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    pub id: i64,
    pub report_id: i64,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct ReportContext {
    pub id: i64,
    pub session_id: i64,
    pub started_at: String,
    pub ended_at: String,
    pub total_seconds: i64,
    pub focus_score: i64,
    pub app_usage_json: String,
    pub activity_json: String,
    pub pomodoro_completed: i64,
    pub ai_summary: Option<String>,
}

pub(crate) fn default_sprite_scale() -> f64 {
    1.0
}

pub(crate) fn default_pet_always_on_top() -> bool {
    true
}

pub(crate) fn default_pet_scale() -> f64 {
    1.0
}
