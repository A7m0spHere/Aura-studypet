mod activity;
mod ai;
mod collector;
mod db;
mod pomodoro;

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard,
    },
    thread,
    thread::JoinHandle,
    time::Duration,
};

use activity::{start_activity_capture, ActivityHandle};
use ai::{AiMessage, AiSettings};
use chrono::{DateTime, NaiveTime, Utc};
use collector::sample_foreground_window;
use db::Database;
use pomodoro::{PomodoroMachine, PomodoroState, TickResult};
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

type AppResult<T> = Result<T, String>;
const LEGACY_IDENTIFIER: &str = "com.studypulse.app";
const AURA_DB_FILE: &str = "aura.sqlite3";
const LEGACY_DB_FILE: &str = "studypulse.sqlite3";
const PET_ATLAS_COLUMNS: u32 = 8;
const PET_ATLAS_ROWS: u32 = 9;
const PET_ATLAS_FRAME_WIDTH: u32 = 192;
const PET_ATLAS_FRAME_HEIGHT: u32 = 208;
const PET_ATLAS_MIN_ALPHA_PIXELS: usize = 16;

struct AppState {
    db: Arc<Mutex<Database>>,
    data_dir: PathBuf,
    active_session_id: Mutex<Option<i64>>,
    pomodoro: Arc<Mutex<PomodoroMachine>>,
    sampler: Mutex<Option<SamplerHandle>>,
    activity: Mutex<Option<ActivityHandle>>,
}

struct SamplerHandle {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
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
struct DashboardState {
    session_status: String,
    today_study_seconds: i64,
    current_session_seconds: i64,
    current_app: String,
    current_window_title: String,
    keyboard_count: i64,
    mouse_count: i64,
    focus_score: i64,
    app_usage: Vec<AppUsage>,
    activity: Vec<ActivityPoint>,
    pomodoro: PomodoroState,
    active_report_id: Option<i64>,
    ai_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct DailyReport {
    id: i64,
    session_id: i64,
    started_at: String,
    ended_at: String,
    total_seconds: i64,
    focus_score: i64,
    app_usage: Vec<AppUsage>,
    activity: Vec<ActivityPoint>,
    pomodoro_completed: i64,
    ai_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct AppPreferences {
    privacy_notice_accepted: bool,
    default_pomodoro_minutes: i64,
    ai_summary_tone: String,
    activity_capture_enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct AppPreferencesInput {
    privacy_notice_accepted: bool,
    default_pomodoro_minutes: i64,
    ai_summary_tone: String,
    activity_capture_enabled: bool,
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
}

#[derive(Debug, Clone, Deserialize)]
struct PetPreferencesInput {
    pet_enabled: bool,
    pet_name: String,
    pet_persona_prompt: String,
    pet_bubble_enabled: bool,
    proactive_ai_enabled: bool,
    idle_nudge_minutes: i64,
    app_switch_nudge_enabled: bool,
    active_pet_id: String,
    first_pet_enable_seen: bool,
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
struct PetManifest {
    id: String,
    display_name: String,
    description: String,
    spritesheet_path: String,
    #[serde(default)]
    sprites: HashMap<String, String>,
    persona: Option<String>,
    #[serde(default = "default_sprite_scale")]
    sprite_scale: f64,
    theme_color: Option<String>,
    default_emotion: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BubbleLinesManifest {
    name: Option<String>,
    personality: Option<String>,
    bubble_style: Option<String>,
    lines: Option<BubbleLines>,
}

#[derive(Debug, Clone, Serialize)]
struct ProactivePetNudge {
    message: String,
    emotion: String,
    event_type: String,
    created_at: String,
}

#[derive(Debug, Clone, Serialize)]
struct AuraReply {
    message: String,
    emotion: String,
    created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuraChatMessage {
    id: i64,
    role: String,
    content: String,
    emotion: String,
    created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum BubbleLines {
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
struct AiTestResult {
    ok: bool,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
struct AiModelList {
    ok: bool,
    models: Vec<String>,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    id: i64,
    report_id: i64,
    role: String,
    content: String,
    created_at: String,
}

#[derive(Debug, Clone)]
pub struct ReportContext {
    id: i64,
    session_id: i64,
    started_at: String,
    ended_at: String,
    total_seconds: i64,
    focus_score: i64,
    app_usage_json: String,
    activity_json: String,
    pomodoro_completed: i64,
    ai_summary: Option<String>,
}

#[tauri::command]
fn start_session(state: State<AppState>) -> AppResult<Session> {
    if let Some(session_id) = *active_session(&state)? {
        return db(&state)?.get_session(session_id).map_err(to_string);
    }

    db(&state)?
        .close_stale_studying_sessions()
        .map_err(to_string)?;

    let session = db(&state)?.start_session().map_err(to_string)?;
    *active_session(&state)? = Some(session.id);
    start_sampler_if_needed(&state, session.id)?;
    start_activity_if_needed(&state, session.id)?;
    Ok(session)
}

#[tauri::command]
fn stop_session(state: State<AppState>) -> AppResult<DailyReport> {
    let session_id = {
        let mut active = active_session(&state)?;
        let session_id = if let Some(session_id) = *active {
            session_id
        } else {
            return Err("no active study session".to_string());
        };
        *active = None;
        session_id
    };

    stop_sampler(&state);
    stop_activity(&state);
    let session = db(&state)?.stop_session(session_id).map_err(to_string)?;
    db(&state)?
        .aggregate_app_usage(session_id)
        .map_err(to_string)?;
    let app_usage = db(&state)?
        .app_usage_for_session(session_id)
        .map_err(to_string)?;
    let pomodoro_completed = pomodoro_snapshot(&state).completed_count;
    let total_seconds = session_total_seconds(&session);
    let focus_score = focus_score(total_seconds, app_usage.len(), pomodoro_completed);
    let activity = db(&state)?
        .activity_points_for_session(session_id)
        .map_err(to_string)?;
    let app_usage_json = serde_json::to_string(&app_usage).map_err(to_string)?;
    let activity_json = serde_json::to_string(&activity).map_err(to_string)?;
    let report_id = db(&state)?
        .create_daily_report(
            &session,
            total_seconds,
            focus_score,
            &app_usage_json,
            &activity_json,
            pomodoro_completed,
            None,
        )
        .map_err(to_string)?;

    Ok(report_for_session(
        report_id,
        session,
        total_seconds,
        focus_score,
        app_usage,
        activity,
        pomodoro_completed,
        None,
    ))
}

#[tauri::command]
fn get_current_status(state: State<AppState>) -> DashboardState {
    dashboard_state(&state).unwrap_or_else(|error| {
        eprintln!("[Aura dashboard] failed to load dashboard: {error}");
        empty_dashboard(pomodoro_snapshot(&state))
    })
}

#[tauri::command]
fn get_today_dashboard(state: State<AppState>) -> DashboardState {
    get_current_status(state)
}

#[tauri::command]
fn start_pomodoro(minutes: i64, state: State<AppState>) -> AppResult<PomodoroState> {
    let (snapshot, token) = {
        let mut machine = pomodoro(&state)?;
        machine.start(minutes)
    };

    spawn_pomodoro_timer(Arc::clone(&state.pomodoro), Arc::clone(&state.db), token);
    Ok(snapshot)
}

#[tauri::command]
fn pause_pomodoro(state: State<AppState>) -> AppResult<PomodoroState> {
    Ok(pomodoro(&state)?.pause())
}

#[tauri::command]
fn reset_pomodoro(state: State<AppState>) -> AppResult<PomodoroState> {
    Ok(pomodoro(&state)?.reset())
}

#[tauri::command]
fn save_ai_settings(settings: AiSettingsInput, state: State<AppState>) -> AppResult<()> {
    let settings = hydrate_saved_ai_key_if_needed(settings, &state)?;
    let canonical = canonical_ai_settings_input_clean(&settings)?;
    db(&state)?.save_ai_settings(&canonical).map_err(to_string)
}

#[tauri::command]
fn get_ai_settings_masked(state: State<AppState>) -> AppResult<AiSettingsMasked> {
    db(&state)?.get_ai_settings_masked().map_err(to_string)
}

#[tauri::command]
async fn test_ai_connection(
    settings: AiSettingsInput,
    state: State<'_, AppState>,
) -> AppResult<AiTestResult> {
    let settings = hydrate_saved_ai_key_if_needed(settings, &state)?;
    let resolved = resolve_ai_settings(&settings)?;
    match ai::test_connection(&resolved).await {
        Ok(result) => Ok(AiTestResult {
            ok: true,
            message: match (result.model_count, result.chat_ok) {
                (Some(count), true) => {
                    format!(
                        "API 可用，检测到 {count} 个模型，当前模型 {} 可正常响应。",
                        resolved.model
                    )
                }
                (None, true) => {
                    format!(
                        "API 可用，当前模型 {} 可正常响应；该服务未返回模型列表。",
                        resolved.model
                    )
                }
                _ => "API 连接异常，请稍后重试。".into(),
            },
        }),
        Err(error) => Ok(AiTestResult {
            ok: false,
            message: error,
        }),
    }
}

#[tauri::command]
async fn list_ai_models(
    settings: AiSettingsInput,
    state: State<'_, AppState>,
) -> AppResult<AiModelList> {
    let settings = hydrate_saved_ai_key_if_needed(settings, &state)?;
    let resolved = resolve_ai_settings_for_models(&settings)?;
    match ai::list_models(&resolved).await {
        Ok(mut models) => {
            models.sort();
            models.dedup();
            Ok(AiModelList {
                ok: true,
                message: format!("检测到 {} 个可用模型。", models.len()),
                models,
            })
        }
        Err(error) => Ok(AiModelList {
            ok: false,
            models: Vec::new(),
            message: error,
        }),
    }
}

#[tauri::command(rename_all = "snake_case")]
async fn generate_ai_summary(
    report_id: i64,
    tone: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let (settings, report, pet_preferences) = {
        let database = db(&state)?;
        (
            database.get_ai_settings().map_err(to_string)?,
            database.get_report_context(report_id).map_err(to_string)?,
            database.get_pet_preferences().map_err(to_string)?,
        )
    };

    let Some(settings) = settings else {
        let summary = mock_ai_summary(&report, Some(&pet_preferences));
        db(&state)?
            .update_report_summary(report_id, &summary)
            .map_err(to_string)?;
        return Ok(summary);
    };
    if settings.api_key.trim().is_empty() {
        let summary = mock_ai_summary(&report, Some(&pet_preferences));
        db(&state)?
            .update_report_summary(report_id, &summary)
            .map_err(to_string)?;
        return Ok(summary);
    }

    let summary = ai::chat_completion(
        &settings,
        summary_messages_clean(&report, tone.as_deref(), Some(&pet_preferences)),
    )
    .await?;
    db(&state)?
        .update_report_summary(report_id, &summary)
        .map_err(to_string)?;
    Ok(summary)
}

#[tauri::command]
fn get_recent_reports(limit: Option<i64>, state: State<AppState>) -> AppResult<Vec<DailyReport>> {
    db(&state)?
        .recent_daily_reports(limit.unwrap_or(30))
        .map_err(to_string)
}

#[tauri::command(rename_all = "snake_case")]
fn delete_daily_report(report_id: i64, state: State<AppState>) -> AppResult<()> {
    db(&state)?
        .delete_daily_report(report_id)
        .map_err(to_string)
}

#[tauri::command]
fn get_data_dir(state: State<AppState>) -> String {
    state.data_dir.to_string_lossy().to_string()
}

#[tauri::command]
fn open_data_dir(state: State<AppState>) -> AppResult<()> {
    fs::create_dir_all(&state.data_dir).map_err(to_string)?;
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&state.data_dir)
            .spawn()
            .map_err(|error| format!("打开数据目录失败: {error}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("当前版本仅支持在 Windows 上打开数据目录。".into())
    }
}

#[tauri::command]
fn clear_local_data(state: State<AppState>) -> AppResult<()> {
    if current_session_id(&state)?.is_some() {
        return Err("请先结束当前学习会话，再清空本地学习数据。".into());
    }
    stop_sampler(&state);
    stop_activity(&state);
    db(&state)?.clear_local_data().map_err(to_string)
}

#[tauri::command(rename_all = "snake_case")]
fn export_daily_report(
    report_id: i64,
    format: String,
    state: State<AppState>,
) -> AppResult<String> {
    let report = db(&state)?
        .get_report_context(report_id)
        .map_err(to_string)?;
    let extension = match format.as_str() {
        "txt" => "txt",
        "markdown" | "md" => "md",
        _ => return Err("导出格式只支持 txt 或 markdown。".into()),
    };
    let export_dir = state.data_dir.join("exports");
    fs::create_dir_all(&export_dir).map_err(to_string)?;
    let file_path = export_dir.join(format!("Aura_Report_{}.{}", report.id, extension));
    let content = render_report_export(&report, extension == "md")?;
    fs::write(&file_path, content).map_err(to_string)?;
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_app_preferences(state: State<AppState>) -> AppResult<AppPreferences> {
    db(&state)?.get_app_preferences().map_err(to_string)
}

#[tauri::command]
fn save_app_preferences(
    preferences: AppPreferencesInput,
    state: State<AppState>,
) -> AppResult<AppPreferences> {
    let minutes = preferences.default_pomodoro_minutes.clamp(1, 180);
    let tone = normalize_tone(&preferences.ai_summary_tone).to_string();
    db(&state)?
        .save_app_preferences(
            preferences.privacy_notice_accepted,
            minutes,
            &tone,
            preferences.activity_capture_enabled,
        )
        .map_err(to_string)?;
    db(&state)?.get_app_preferences().map_err(to_string)
}

#[tauri::command]
fn get_pet_preferences(state: State<AppState>) -> AppResult<PetPreferences> {
    db(&state)?.get_pet_preferences().map_err(to_string)
}

#[tauri::command]
fn save_pet_preferences(
    preferences: PetPreferencesInput,
    state: State<AppState>,
) -> AppResult<PetPreferences> {
    let current = db(&state)?.get_pet_preferences().map_err(to_string)?;
    let pet_name = non_empty_or(preferences.pet_name, &current.pet_name);
    let pet_persona_prompt =
        non_empty_or(preferences.pet_persona_prompt, DEFAULT_PET_PERSONA_PROMPT);
    let active_pet_id = non_empty_or(preferences.active_pet_id, "default-aura");
    let normalized = PetPreferences {
        pet_enabled: preferences.pet_enabled,
        pet_name,
        pet_persona_prompt,
        pet_bubble_enabled: preferences.pet_bubble_enabled,
        proactive_ai_enabled: preferences.proactive_ai_enabled && preferences.pet_enabled,
        idle_nudge_minutes: preferences.idle_nudge_minutes.clamp(5, 240),
        app_switch_nudge_enabled: preferences.app_switch_nudge_enabled,
        active_pet_id,
        first_pet_enable_seen: preferences.first_pet_enable_seen,
    };
    db(&state)?
        .save_pet_preferences(&normalized)
        .map_err(to_string)?;
    db(&state)?.get_pet_preferences().map_err(to_string)
}

#[tauri::command]
fn show_pet_window(app: tauri::AppHandle, state: State<AppState>) -> AppResult<()> {
    let preferences = db(&state)?.get_pet_preferences().map_err(to_string)?;
    if !preferences.pet_enabled {
        return Err("桌宠模式尚未启用。".into());
    }
    let Some(window) = app.get_webview_window("pet") else {
        return Err("pet window is not available".into());
    };
    let _ = window.set_shadow(false);
    window.show().map_err(to_string)?;
    window.set_always_on_top(true).map_err(to_string)?;
    Ok(())
}

#[tauri::command]
fn hide_pet_window(app: tauri::AppHandle) -> AppResult<()> {
    let Some(window) = app.get_webview_window("pet") else {
        return Ok(());
    };
    window.hide().map_err(to_string)
}

#[tauri::command]
fn drag_pet_window(app: tauri::AppHandle) -> AppResult<()> {
    let Some(window) = app.get_webview_window("pet") else {
        return Err("pet window is not available".into());
    };
    window.start_dragging().map_err(to_string)
}

#[tauri::command]
fn get_pet_library_dir(state: State<AppState>) -> AppResult<String> {
    let pet_root = pet_library_dir(&state.data_dir);
    fs::create_dir_all(&pet_root).map_err(to_string)?;
    Ok(pet_root.to_string_lossy().to_string())
}

#[tauri::command]
fn open_pet_library_dir(state: State<AppState>) -> AppResult<()> {
    let pet_root = pet_library_dir(&state.data_dir);
    fs::create_dir_all(&pet_root).map_err(to_string)?;
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&pet_root)
            .spawn()
            .map_err(|error| format!("打开宠物文件夹失败: {error}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("当前版本仅支持在 Windows 上打开宠物文件夹。".into())
    }
}

#[tauri::command(rename_all = "snake_case")]
fn import_pet_profile(folder_path: String, state: State<AppState>) -> AppResult<PetProfile> {
    let source_dir = PathBuf::from(folder_path.trim());
    if !source_dir.is_dir() {
        return Err("请选择一个包含 pet.json 的宠物文件夹。".into());
    }
    let profile = read_pet_profile_from_dir(&source_dir)?;
    if profile.id == "default-aura" {
        return Err("导入宠物不能使用保留 id: default-aura".into());
    }

    let pet_root = state.data_dir.join("pets");
    fs::create_dir_all(&pet_root).map_err(to_string)?;
    let target_dir = pet_root.join(&profile.id);
    fs::create_dir_all(&target_dir).map_err(to_string)?;

    fs::copy(source_dir.join("pet.json"), target_dir.join("pet.json")).map_err(to_string)?;
    let manifest_text = fs::read_to_string(source_dir.join("pet.json")).map_err(to_string)?;
    let manifest: PetManifest = serde_json::from_str(&manifest_text)
        .map_err(|error| format!("pet.json 格式无效: {error}"))?;
    if !manifest.spritesheet_path.trim().is_empty() {
        copy_pet_asset(&source_dir, &target_dir, &manifest.spritesheet_path)?;
    }
    for relative_path in manifest.sprites.values() {
        copy_pet_asset(&source_dir, &target_dir, relative_path)?;
    }
    let bubble_path = source_dir.join("bubble-lines.json");
    if bubble_path.is_file() {
        fs::copy(bubble_path, target_dir.join("bubble-lines.json")).map_err(to_string)?;
    }

    let imported = read_pet_profile_from_dir(&target_dir)?;
    let mut preferences = db(&state)?.get_pet_preferences().map_err(to_string)?;
    preferences.active_pet_id = imported.id.clone();
    preferences.pet_name = imported.display_name.clone();
    if let Some(prompt) = pet_prompt_from_bubble_lines(&target_dir)? {
        preferences.pet_persona_prompt = prompt;
    }
    db(&state)?
        .save_pet_preferences(&preferences)
        .map_err(to_string)?;
    Ok(imported)
}

#[tauri::command]
fn get_pet_profiles(state: State<AppState>) -> AppResult<Vec<PetProfile>> {
    let mut profiles = vec![default_pet_profile()];
    let pet_root = pet_library_dir(&state.data_dir);
    fs::create_dir_all(&pet_root).map_err(to_string)?;
    if !pet_root.is_dir() {
        return Ok(profiles);
    }
    for entry in fs::read_dir(&pet_root).map_err(to_string)? {
        let entry = entry.map_err(to_string)?;
        let path = entry.path();
        if path.is_dir() {
            match read_pet_profile_from_dir(&path) {
                Ok(profile) => profiles.push(profile),
                Err(error) => eprintln!("[Aura Companion pet] ignored invalid pet: {error}"),
            }
        }
    }
    profiles.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    profiles.dedup_by(|a, b| a.id == b.id);
    Ok(profiles)
}

#[tauri::command]
fn rescan_pet_profiles(state: State<AppState>) -> AppResult<Vec<PetProfile>> {
    get_pet_profiles(state)
}

#[tauri::command(rename_all = "snake_case")]
async fn send_proactive_pet_nudge(
    event_type: String,
    state: State<'_, AppState>,
) -> AppResult<ProactivePetNudge> {
    let event_type = match event_type.as_str() {
        "idle_app" | "app_switch" => event_type,
        _ => return Err("unknown proactive pet event".into()),
    };
    let (preferences, settings, dashboard) = {
        let preferences = db(&state)?.get_pet_preferences().map_err(to_string)?;
        if !preferences.pet_enabled || !preferences.proactive_ai_enabled {
            return Err("主动 AI 关心尚未启用。".into());
        }
        let settings = db(&state)?.get_ai_settings().map_err(to_string)?;
        let dashboard = dashboard_state(&state)?;
        (preferences, settings, dashboard)
    };

    let fallback_emotion = if event_type == "app_switch" {
        "nudge"
    } else {
        "thinking"
    };
    let raw_message = if let Some(settings) = settings {
        if settings.api_key.trim().is_empty() {
            local_pet_nudge(&event_type, &dashboard)
        } else {
            ai::chat_completion(
                &settings,
                proactive_pet_messages(&preferences, &dashboard, &event_type),
            )
            .await
            .unwrap_or_else(|_| local_pet_nudge(&event_type, &dashboard))
        }
    } else {
        local_pet_nudge(&event_type, &dashboard)
    };
    let reply = parse_aura_reply(&raw_message, fallback_emotion);

    Ok(ProactivePetNudge {
        message: reply.message,
        emotion: reply.emotion,
        event_type,
        created_at: now(),
    })
}

#[tauri::command(rename_all = "snake_case")]
async fn chat_with_aura(message: String, state: State<'_, AppState>) -> AppResult<AuraChatMessage> {
    let message = message.trim().to_string();
    if message.is_empty() {
        return Err("message cannot be empty".into());
    }

    let (settings, history, pet_preferences, dashboard) = {
        let database = db(&state)?;
        let settings = database.get_ai_settings().map_err(to_string)?;
        database
            .add_aura_chat_message("user", &message, "idle")
            .map_err(to_string)?;
        let history = database.aura_chat_messages(40).map_err(to_string)?;
        let pet_preferences = database.get_pet_preferences().map_err(to_string)?;
        let dashboard = dashboard_state(&state)?;
        (settings, history, pet_preferences, dashboard)
    };

    let raw_reply = if let Some(settings) = settings {
        if settings.api_key.trim().is_empty() {
            local_aura_chat_reply(&message, &dashboard)
        } else {
            ai::chat_completion(
                &settings,
                aura_chat_messages(&history, &pet_preferences, &dashboard),
            )
            .await
            .unwrap_or_else(|_| local_aura_chat_reply(&message, &dashboard))
        }
    } else {
        local_aura_chat_reply(&message, &dashboard)
    };
    let reply = parse_aura_reply(&raw_reply, "happy");

    db(&state)?
        .add_aura_chat_message("assistant", &reply.message, &reply.emotion)
        .map_err(to_string)
}

#[tauri::command]
fn get_aura_chat_history(state: State<AppState>) -> AppResult<Vec<AuraChatMessage>> {
    db(&state)?.aura_chat_messages(80).map_err(to_string)
}

#[tauri::command]
fn clear_aura_chat_history(state: State<AppState>) -> AppResult<()> {
    db(&state)?.clear_aura_chat_messages().map_err(to_string)
}

#[tauri::command(rename_all = "snake_case")]
async fn chat_with_ai(
    report_id: i64,
    message: String,
    state: State<'_, AppState>,
) -> AppResult<ChatMessage> {
    let message = message.trim().to_string();
    if message.is_empty() {
        return Err("message cannot be empty".into());
    }

    let (settings, report, history, pet_preferences) = {
        let database = db(&state)?;
        let settings = database.get_ai_settings().map_err(to_string)?;
        let report = database.get_report_context(report_id).map_err(to_string)?;
        let pet_preferences = database.get_pet_preferences().map_err(to_string)?;
        let user_message = database
            .add_chat_message(report_id, "user", &message)
            .map_err(to_string)?;
        let mut history = database
            .chat_messages_for_report(report_id)
            .map_err(to_string)?;
        if !history.iter().any(|item| item.id == user_message.id) {
            history.push(user_message);
        }
        (settings, report, history, pet_preferences)
    };

    let reply = if let Some(settings) = settings {
        if settings.api_key.trim().is_empty() {
            format!("Mock reply received: {message}")
        } else {
            ai::chat_completion(
                &settings,
                chat_messages_clean(&report, &history, Some(&pet_preferences)),
            )
            .await?
        }
    } else {
        format!("Mock reply received: {message}")
    };

    db(&state)?
        .add_chat_message(report_id, "assistant", &reply)
        .map_err(to_string)
}

fn dashboard_state(state: &State<AppState>) -> AppResult<DashboardState> {
    let now = Utc::now();
    let active_id = current_session_id(state)?;
    let latest_sample = db(state)?.latest_window_sample().map_err(to_string)?;
    let today_study_seconds = db(state)?.today_study_seconds(now).map_err(to_string)?;
    let current_session_seconds = if let Some(session_id) = active_id {
        db(state)?
            .get_session(session_id)
            .map(|session| session_elapsed_seconds(&session, now))
            .map_err(to_string)?
    } else {
        0
    };
    let app_usage = if let Some(session_id) = active_id {
        db(state)?
            .app_usage_from_samples_for_session(session_id)
            .map_err(to_string)?
    } else {
        db(state)?
            .app_usage_from_samples_since(&today_start_utc(now))
            .map_err(to_string)?
    };
    let (keyboard_count, mouse_count, activity) = if let Some(session_id) = active_id {
        let (keyboard, mouse) = db(state)?
            .activity_totals_for_session(session_id)
            .map_err(to_string)?;
        let (pending_keyboard, pending_mouse) = pending_activity_counts(state);
        (
            keyboard + pending_keyboard,
            mouse + pending_mouse,
            db(state)?
                .activity_points_for_session(session_id)
                .map_err(to_string)?,
        )
    } else {
        (0, 0, Vec::new())
    };
    let focus_score = focus_score(
        today_study_seconds,
        app_usage.len(),
        pomodoro_snapshot(state).completed_count,
    );
    let active_report_id = db(state)?.latest_report_id().map_err(to_string)?;

    let current_app = latest_sample
        .as_ref()
        .map(|sample| sample.app_name.clone())
        .unwrap_or_else(|| "Not started".into());
    let current_window_title = latest_sample
        .map(|sample| sample.window_title)
        .unwrap_or_else(|| "Start a study session to record the active window".into());

    Ok(DashboardState {
        session_status: if active_id.is_some() {
            "studying".into()
        } else {
            "idle".into()
        },
        today_study_seconds,
        current_session_seconds,
        current_app,
        current_window_title,
        keyboard_count,
        mouse_count,
        focus_score,
        app_usage,
        activity,
        pomodoro: pomodoro_snapshot(state),
        active_report_id,
        ai_summary: None,
    })
}

fn empty_dashboard(pomodoro: PomodoroState) -> DashboardState {
    DashboardState {
        session_status: "idle".into(),
        today_study_seconds: 0,
        current_session_seconds: 0,
        current_app: "Not started".into(),
        current_window_title: "Start a study session to record the active window".into(),
        keyboard_count: 0,
        mouse_count: 0,
        focus_score: 0,
        app_usage: Vec::new(),
        activity: Vec::new(),
        pomodoro,
        active_report_id: None,
        ai_summary: None,
    }
}

fn report_for_session(
    id: i64,
    session: Session,
    total_seconds: i64,
    focus_score: i64,
    app_usage: Vec<AppUsage>,
    activity: Vec<ActivityPoint>,
    pomodoro_completed: i64,
    ai_summary: Option<String>,
) -> DailyReport {
    DailyReport {
        id,
        session_id: session.id,
        started_at: session.started_at,
        ended_at: session.ended_at.unwrap_or_else(now),
        total_seconds,
        focus_score,
        app_usage,
        activity,
        pomodoro_completed,
        ai_summary,
    }
}

fn default_pet_profile() -> PetProfile {
    PetProfile {
        id: "default-aura".into(),
        display_name: "Aura".into(),
        description: "Aura Companion 默认桌宠".into(),
        spritesheet_path: String::new(),
        sprites: HashMap::new(),
        atlas: None,
        persona: Some(DEFAULT_PET_PERSONA_PROMPT.into()),
        sprite_scale: 1.0,
        theme_color: None,
        default_emotion: "idle".into(),
        bubble_lines: vec![
            "今天还没进入状态，要不要开一段？".into(),
            "我在记录这段专注时间。".into(),
            "这段记录下来了，要不要让我总结一下？".into(),
        ],
    }
}

fn pet_library_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("pets")
}

fn analyze_pet_atlas(path: &Path) -> AppResult<PetAtlasMetadata> {
    let image = image::open(path)
        .map_err(|error| format!("failed to read pet spritesheet metadata: {error}"))?
        .to_rgba8();
    if image.width() != PET_ATLAS_COLUMNS * PET_ATLAS_FRAME_WIDTH
        || image.height() != PET_ATLAS_ROWS * PET_ATLAS_FRAME_HEIGHT
    {
        return Err(format!(
            "unsupported pet spritesheet size {}x{}",
            image.width(),
            image.height()
        ));
    }

    let mut rows = Vec::with_capacity(PET_ATLAS_ROWS as usize);
    for row in 0..PET_ATLAS_ROWS {
        let mut valid_frames = Vec::new();
        for column in 0..PET_ATLAS_COLUMNS {
            let mut alpha_pixels = 0usize;
            let start_x = column * PET_ATLAS_FRAME_WIDTH;
            let start_y = row * PET_ATLAS_FRAME_HEIGHT;
            'cell: for y in start_y..start_y + PET_ATLAS_FRAME_HEIGHT {
                for x in start_x..start_x + PET_ATLAS_FRAME_WIDTH {
                    if image.get_pixel(x, y).0[3] > 0 {
                        alpha_pixels += 1;
                        if alpha_pixels >= PET_ATLAS_MIN_ALPHA_PIXELS {
                            break 'cell;
                        }
                    }
                }
            }
            if alpha_pixels >= PET_ATLAS_MIN_ALPHA_PIXELS {
                valid_frames.push(column as usize);
            }
        }
        rows.push(valid_frames);
    }

    if rows.iter().all(Vec::is_empty) {
        return Err("pet spritesheet has no visible atlas frames".into());
    }

    Ok(PetAtlasMetadata {
        columns: PET_ATLAS_COLUMNS,
        row_count: PET_ATLAS_ROWS,
        frame_width: PET_ATLAS_FRAME_WIDTH,
        frame_height: PET_ATLAS_FRAME_HEIGHT,
        rows,
    })
}

fn read_pet_profile_from_dir(dir: &Path) -> AppResult<PetProfile> {
    let manifest_path = dir.join("pet.json");
    if !manifest_path.is_file() {
        return Err("宠物文件夹缺少 pet.json。".into());
    }
    let manifest_text = fs::read_to_string(&manifest_path).map_err(to_string)?;
    let manifest: PetManifest = serde_json::from_str(&manifest_text)
        .map_err(|error| format!("pet.json 格式无效: {error}"))?;
    let id = sanitize_pet_id(&manifest.id)?;
    if id != manifest.id {
        return Err("pet.json 的 id 只能包含字母、数字、短横线和下划线。".into());
    }
    let spritesheet_path = if manifest.spritesheet_path.trim().is_empty() {
        PathBuf::new()
    } else {
        validate_pet_asset_path(dir, &manifest.spritesheet_path, "spritesheetPath")?
    };
    if manifest.sprites.is_empty() && spritesheet_path.as_os_str().is_empty() {
        return Err("pet.json 至少需要 spritesheetPath 或 sprites。".into());
    }
    let mut sprites = HashMap::new();
    for (emotion, relative_path) in &manifest.sprites {
        let emotion = normalize_emotion(emotion);
        let path = validate_pet_asset_path(dir, relative_path, "sprites")?;
        sprites.insert(emotion, path.to_string_lossy().to_string());
    }

    let atlas = if spritesheet_path.as_os_str().is_empty() {
        None
    } else {
        analyze_pet_atlas(&spritesheet_path).ok()
    };

    Ok(PetProfile {
        id,
        display_name: manifest.display_name,
        description: manifest.description,
        spritesheet_path: spritesheet_path.to_string_lossy().to_string(),
        sprites,
        atlas,
        persona: manifest.persona,
        sprite_scale: manifest.sprite_scale.clamp(0.2, 3.0),
        theme_color: manifest.theme_color,
        default_emotion: normalize_emotion(manifest.default_emotion.as_deref().unwrap_or("idle")),
        bubble_lines: read_bubble_lines(dir).unwrap_or_default(),
    })
}

fn read_bubble_lines(dir: &Path) -> AppResult<Vec<String>> {
    let path = dir.join("bubble-lines.json");
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(path).map_err(to_string)?;
    let manifest: BubbleLinesManifest = serde_json::from_str(&text)
        .map_err(|error| format!("bubble-lines.json 格式无效: {error}"))?;
    let lines = match manifest.lines {
        Some(BubbleLines::Flat(lines)) => lines,
        Some(BubbleLines::Grouped(groups)) => {
            groups.into_iter().flat_map(|(_, lines)| lines).collect()
        }
        None => Vec::new(),
    };
    Ok(lines
        .into_iter()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .take(48)
        .collect())
}

fn pet_prompt_from_bubble_lines(dir: &Path) -> AppResult<Option<String>> {
    let path = dir.join("bubble-lines.json");
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(path).map_err(to_string)?;
    let manifest: BubbleLinesManifest = serde_json::from_str(&text)
        .map_err(|error| format!("bubble-lines.json 格式无效: {error}"))?;
    let name = manifest.name.unwrap_or_else(|| "Aura".into());
    let personality = manifest
        .personality
        .unwrap_or_else(|| "温和、简短、有陪伴感".into());
    let style = manifest
        .bubble_style
        .unwrap_or_else(|| "简短、具体、不要太长".into());
    Ok(Some(format!(
        "你是 {name}，Aura Companion 的桌面 AI 伙伴。你的性格：{personality}。你的回复风格：{style}。你只能基于提供的行为摘要回应，不要编造；提醒用户时要克制、友好，不要羞辱用户；每次回复尽量控制在 80 字以内。"
    )))
}

fn sanitize_pet_id(id: &str) -> AppResult<String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("宠物 id 不能为空。".into());
    }
    if id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        Ok(id.to_string())
    } else {
        Err("宠物 id 只能包含字母、数字、短横线和下划线。".into())
    }
}

fn non_empty_or(value: String, fallback: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        fallback.to_string()
    } else {
        value.to_string()
    }
}

fn default_sprite_scale() -> f64 {
    1.0
}

fn validate_pet_asset_path(dir: &Path, relative_path: &str, field: &str) -> AppResult<PathBuf> {
    let relative_path = relative_path.trim();
    if relative_path.is_empty()
        || relative_path.contains("..")
        || Path::new(relative_path).is_absolute()
    {
        return Err(format!("pet.json 的 {field} 必须是文件夹内的相对路径。"));
    }
    let path = dir.join(relative_path);
    if !path.is_file() {
        return Err(format!("宠物文件夹缺少 {field} 指向的图片文件。"));
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if extension != "webp" && extension != "png" && extension != "jpg" && extension != "jpeg" {
        return Err(format!("{field} 只支持 webp、png、jpg 或 jpeg。"));
    }
    Ok(path)
}

fn copy_pet_asset(source_dir: &Path, target_dir: &Path, relative_path: &str) -> AppResult<()> {
    let source = validate_pet_asset_path(source_dir, relative_path, "图片资源")?;
    let target = target_dir.join(relative_path.trim());
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(to_string)?;
    }
    fs::copy(source, target).map_err(to_string)?;
    Ok(())
}

fn normalize_emotion(value: &str) -> String {
    match value.trim() {
        "studying" => "studying".into(),
        "thinking" => "thinking".into(),
        "happy" => "happy".into(),
        "nudge" => "nudge".into(),
        "ended" => "ended".into(),
        _ => "idle".into(),
    }
}

fn local_pet_nudge(event_type: &str, dashboard: &DashboardState) -> String {
    match event_type {
        "app_switch" => format!(
            "我看到你切到 {} 了，记得把节奏握在自己手里。",
            dashboard.current_app
        ),
        _ => format!(
            "你在 {} 停留了一阵子，要不要顺手确认一下现在的状态？",
            dashboard.current_app
        ),
    }
}

fn local_aura_chat_reply(message: &str, dashboard: &DashboardState) -> String {
    format!(
        r#"{{"message":"我看到了：{}。当前在 {}，今天专注分是 {}。我会先陪你把下一小步稳住。","emotion":"happy"}}"#,
        message.replace('"', "'"),
        dashboard.current_app.replace('"', "'"),
        dashboard.focus_score
    )
}

fn parse_aura_reply(raw: &str, fallback_emotion: &str) -> AuraReply {
    let trimmed = raw.trim();
    let json_text = trimmed
        .strip_prefix("```json")
        .and_then(|value| value.strip_suffix("```"))
        .or_else(|| {
            trimmed
                .strip_prefix("```")
                .and_then(|value| value.strip_suffix("```"))
        })
        .unwrap_or(trimmed)
        .trim();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(json_text) {
        let message = value
            .get("message")
            .and_then(|item| item.as_str())
            .or_else(|| value.get("content").and_then(|item| item.as_str()))
            .unwrap_or(trimmed)
            .trim()
            .to_string();
        let emotion = value
            .get("emotion")
            .and_then(|item| item.as_str())
            .map(normalize_emotion)
            .unwrap_or_else(|| normalize_emotion(fallback_emotion));
        if !message.is_empty() {
            return AuraReply {
                message,
                emotion,
                created_at: now(),
            };
        }
    }
    AuraReply {
        message: trimmed.to_string(),
        emotion: normalize_emotion(fallback_emotion),
        created_at: now(),
    }
}

fn proactive_pet_messages(
    preferences: &PetPreferences,
    dashboard: &DashboardState,
    event_type: &str,
) -> Vec<AiMessage> {
    vec![
        AiMessage {
            role: "system".into(),
            content: format!(
                "你是 Aura Companion 的 AI 桌面伙伴。请用中文、简短、克制地关心用户。角色设定如下：{}\n请只返回 JSON：{{\"message\":\"一句给用户看的话\",\"emotion\":\"idle|studying|thinking|happy|nudge|ended\"}}。",
                preferences.pet_persona_prompt
            ),
        },
        AiMessage {
            role: "user".into(),
            content: format!(
                "触发事件: {}\n当前应用: {}\n当前会话秒数: {}\n今日累计秒数: {}\n专注分: {}\n键盘计数: {}\n鼠标计数: {}\n要求：只基于这些摘要数据回复，不要提窗口标题，不要编造，message 不要超过 80 字。",
                event_type,
                dashboard.current_app,
                dashboard.current_session_seconds,
                dashboard.today_study_seconds,
                dashboard.focus_score,
                dashboard.keyboard_count,
                dashboard.mouse_count
            ),
        },
    ]
}

fn aura_chat_messages(
    history: &[AuraChatMessage],
    preferences: &PetPreferences,
    dashboard: &DashboardState,
) -> Vec<AiMessage> {
    let mut messages = vec![AiMessage {
        role: "system".into(),
        content: format!(
            "你是 Aura Companion 的桌面伙伴。角色设定：{}\n\
             你只能基于用户提供的信息和以下本地状态摘要回应，不要编造隐私或未提供的数据。\n\
             当前应用: {}\n当前会话秒数: {}\n今日累计秒数: {}\n专注分: {}\n\
             请只返回 JSON：{{\"message\":\"给用户看的中文回复\",\"emotion\":\"idle|studying|thinking|happy|nudge|ended\"}}。message 尽量 80 字以内。",
            preferences.pet_persona_prompt,
            dashboard.current_app,
            dashboard.current_session_seconds,
            dashboard.today_study_seconds,
            dashboard.focus_score,
        ),
    }];
    messages.extend(history.iter().map(|message| AiMessage {
        role: message.role.clone(),
        content: message.content.clone(),
    }));
    messages
}

fn render_report_export(report: &ReportContext, markdown: bool) -> AppResult<String> {
    let app_usage: Vec<AppUsage> = serde_json::from_str(&report.app_usage_json).unwrap_or_default();
    let activity: Vec<ActivityPoint> =
        serde_json::from_str(&report.activity_json).unwrap_or_default();
    let mut lines = Vec::new();

    if markdown {
        lines.push(format!("# Aura 日报 #{}", report.id));
        lines.push(String::new());
        lines.push(format!("- 会话 ID：{}", report.session_id));
        lines.push(format!("- 开始时间：{}", report.started_at));
        lines.push(format!("- 结束时间：{}", report.ended_at));
        lines.push(format!(
            "- 学习时长：{}",
            human_seconds(report.total_seconds)
        ));
        lines.push(format!("- 专注度：{}", report.focus_score));
        lines.push(format!("- 番茄钟完成数：{}", report.pomodoro_completed));
        lines.push(String::new());
        lines.push("## 应用排行".into());
        if app_usage.is_empty() {
            lines.push("- 暂无应用采样数据。".into());
        } else {
            for item in app_usage.iter().take(10) {
                lines.push(format!(
                    "- {}：{}",
                    item.app_name,
                    human_seconds(item.seconds)
                ));
            }
        }
        lines.push(String::new());
        lines.push("## 活跃度".into());
        if activity.is_empty() {
            lines.push("- 暂无键鼠活跃度趋势。".into());
        } else {
            for item in activity.iter().take(20) {
                lines.push(format!(
                    "- {}：键盘 {}，鼠标 {}",
                    item.label, item.keyboard, item.mouse
                ));
            }
        }
        lines.push(String::new());
        lines.push("## AI 总结".into());
        lines.push(
            report
                .ai_summary
                .clone()
                .unwrap_or_else(|| "尚未生成 AI 总结。".into()),
        );
    } else {
        lines.push(format!("Aura 日报 #{}", report.id));
        lines.push(format!("会话 ID：{}", report.session_id));
        lines.push(format!("开始时间：{}", report.started_at));
        lines.push(format!("结束时间：{}", report.ended_at));
        lines.push(format!("学习时长：{}", human_seconds(report.total_seconds)));
        lines.push(format!("专注度：{}", report.focus_score));
        lines.push(format!("番茄钟完成数：{}", report.pomodoro_completed));
        lines.push(String::new());
        lines.push("应用排行：".into());
        if app_usage.is_empty() {
            lines.push("暂无应用采样数据。".into());
        } else {
            for item in app_usage.iter().take(10) {
                lines.push(format!(
                    "{} - {}",
                    item.app_name,
                    human_seconds(item.seconds)
                ));
            }
        }
        lines.push(String::new());
        lines.push("活跃度：".into());
        if activity.is_empty() {
            lines.push("暂无键鼠活跃度趋势。".into());
        } else {
            for item in activity.iter().take(20) {
                lines.push(format!(
                    "{} - 键盘 {}，鼠标 {}",
                    item.label, item.keyboard, item.mouse
                ));
            }
        }
        lines.push(String::new());
        lines.push("AI 总结：".into());
        lines.push(
            report
                .ai_summary
                .clone()
                .unwrap_or_else(|| "尚未生成 AI 总结。".into()),
        );
    }

    Ok(lines.join("\n"))
}

fn db<'a>(state: &'a State<'_, AppState>) -> AppResult<MutexGuard<'a, Database>> {
    state.db.lock().map_err(|_| "database lock failed".into())
}

fn active_session<'a>(state: &'a State<'_, AppState>) -> AppResult<MutexGuard<'a, Option<i64>>> {
    state
        .active_session_id
        .lock()
        .map_err(|_| "session lock failed".into())
}

fn pomodoro<'a>(state: &'a State<'_, AppState>) -> AppResult<MutexGuard<'a, PomodoroMachine>> {
    state
        .pomodoro
        .lock()
        .map_err(|_| "pomodoro lock failed".into())
}

fn pomodoro_snapshot(state: &State<AppState>) -> PomodoroState {
    state
        .pomodoro
        .lock()
        .map(|machine| machine.snapshot())
        .unwrap_or_default()
}

fn current_session_id(state: &State<AppState>) -> AppResult<Option<i64>> {
    Ok(*active_session(state)?)
}

fn session_total_seconds(session: &Session) -> i64 {
    let Ok(started_at) = DateTime::parse_from_rfc3339(&session.started_at) else {
        return 0;
    };
    let ended_at = session
        .ended_at
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .unwrap_or(started_at);
    (ended_at - started_at).num_seconds().max(0)
}

fn session_elapsed_seconds(session: &Session, now: DateTime<Utc>) -> i64 {
    let Ok(started_at) = DateTime::parse_from_rfc3339(&session.started_at) else {
        return 0;
    };
    (now - started_at.with_timezone(&Utc)).num_seconds().max(0)
}

fn focus_score(total_seconds: i64, app_count: usize, pomodoro_completed: i64) -> i64 {
    let duration_bonus = (total_seconds / 900).min(8);
    let switch_penalty = (app_count.saturating_sub(3) as i64 * 4).min(24);
    let pomodoro_bonus = (pomodoro_completed * 4).min(12);
    (80 + duration_bonus + pomodoro_bonus - switch_penalty).clamp(0, 100)
}

fn today_start_utc(now: DateTime<Utc>) -> String {
    now.date_naive()
        .and_time(NaiveTime::MIN)
        .and_utc()
        .to_rfc3339()
}

fn mock_ai_summary(report: &ReportContext, pet_preferences: Option<&PetPreferences>) -> String {
    let prefix = if pet_preferences
        .map(|preferences| preferences.pet_enabled)
        .unwrap_or(false)
    {
        "Aura pet summary"
    } else {
        "Aura summary"
    };
    format!(
        "{prefix} for report #{}: studied for {}, focus score {}, pomodoros {}.",
        report.id,
        human_seconds(report.total_seconds),
        report.focus_score,
        report.pomodoro_completed
    )
}

fn canonical_ai_settings_input_clean(settings: &AiSettingsInput) -> AppResult<AiSettingsInput> {
    let provider = normalize_ai_provider(settings.provider.as_deref());
    match provider {
        "deepseek" => {
            let model = settings.model.trim();
            if !deepseek_models().contains(&model) {
                return Err("DeepSeek 模型只能选择 deepseek-v4-pro 或 deepseek-v4-flash。".into());
            }
            if settings.api_key.trim().is_empty() {
                return Err("请填写 DeepSeek API Key。".into());
            }
            Ok(AiSettingsInput {
                provider: Some("deepseek".into()),
                base_url: "https://api.deepseek.com".into(),
                api_key: settings.api_key.trim().into(),
                model: model.into(),
            })
        }
        "custom" => {
            if settings.base_url.trim().is_empty() {
                return Err("请填写自定义 API Base URL。".into());
            }
            if settings.model.trim().is_empty() {
                return Err("请填写自定义模型名称。".into());
            }
            if settings.api_key.trim().is_empty() {
                return Err("请填写自定义 API Key。".into());
            }
            Ok(AiSettingsInput {
                provider: Some("custom".into()),
                base_url: settings.base_url.trim().into(),
                api_key: settings.api_key.trim().into(),
                model: settings.model.trim().into(),
            })
        }
        _ => Err("未知的 API 供应商。".into()),
    }
}

#[allow(dead_code)]
fn canonical_ai_settings_input(settings: &AiSettingsInput) -> AppResult<AiSettingsInput> {
    canonical_ai_settings_input_clean(settings)
}

fn hydrate_saved_ai_key_if_needed(
    settings: AiSettingsInput,
    state: &State<'_, AppState>,
) -> AppResult<AiSettingsInput> {
    let provider = normalize_ai_provider(settings.provider.as_deref());
    if !settings.api_key.trim().is_empty() {
        return Ok(settings);
    }

    let masked = db(state)?.get_ai_settings_masked().map_err(to_string)?;
    let provider_state = masked
        .providers
        .iter()
        .find(|item| item.provider == provider);
    if !provider_state.map(|item| item.configured).unwrap_or(false) {
        return Ok(settings);
    }

    let Some(saved) = db(state)?
        .get_ai_settings_for_provider(provider)
        .map_err(to_string)?
    else {
        return Ok(settings);
    };

    Ok(AiSettingsInput {
        api_key: saved.api_key,
        ..settings
    })
}

fn resolve_ai_settings(settings: &AiSettingsInput) -> AppResult<AiSettings> {
    let canonical = canonical_ai_settings_input_clean(settings)?;
    Ok(AiSettings {
        base_url: canonical.base_url,
        api_key: canonical.api_key,
        model: canonical.model,
    })
}

fn resolve_ai_settings_for_models(settings: &AiSettingsInput) -> AppResult<AiSettings> {
    let provider = normalize_ai_provider(settings.provider.as_deref());
    let (base_url, api_key) = match provider {
        "deepseek" => (
            "https://api.deepseek.com".to_string(),
            settings.api_key.trim().to_string(),
        ),
        "custom" => {
            if settings.base_url.trim().is_empty() {
                return Err("请填写自定义 API Base URL。".into());
            }
            (
                settings.base_url.trim().to_string(),
                settings.api_key.trim().to_string(),
            )
        }
        _ => return Err("未知的 API 供应商。".into()),
    };
    if api_key.is_empty() {
        return Err("请先填写 API Key，或保存后使用已保存的 Key 检测。".into());
    }
    Ok(AiSettings {
        base_url,
        api_key,
        model: settings.model.trim().to_string(),
    })
}

fn normalize_ai_provider(provider: Option<&str>) -> &'static str {
    match provider.unwrap_or("deepseek") {
        "deepseek" => "deepseek",
        "custom" => "custom",
        _ => "unknown",
    }
}

fn deepseek_models() -> [&'static str; 2] {
    ["deepseek-v4-pro", "deepseek-v4-flash"]
}

fn summary_messages_clean(
    report: &ReportContext,
    tone: Option<&str>,
    pet_preferences: Option<&PetPreferences>,
) -> Vec<AiMessage> {
    let mut messages = vec![
        AiMessage {
            role: "system".into(),
            content: format!(
                "你是 Aura 的学习总结助手。请用中文输出，不要编造未提供的数据。总结语气：{}。",
                tone_instruction_clean(tone)
            ),
        },
        AiMessage {
            role: "user".into(),
            content: report_prompt_clean(report, tone),
        },
    ];
    messages[0].content = aura_system_prompt(
        pet_preferences,
        &format!(
            "请用中文输出，不要编造未提供的数据。总结语气：{}。",
            tone_instruction_clean(tone)
        ),
    );
    messages
}

fn chat_messages_clean(
    report: &ReportContext,
    history: &[ChatMessage],
    pet_preferences: Option<&PetPreferences>,
) -> Vec<AiMessage> {
    let mut messages = vec![
        AiMessage {
            role: "system".into(),
            content:
                "你是 Aura 的学习复盘聊天助手。请基于日报上下文回答，保持简短、具体、友好。"
                    .into(),
        },
        AiMessage {
            role: "user".into(),
            content: report_prompt_clean(report, None),
        },
        AiMessage {
            role: "assistant".into(),
            content: report
                .ai_summary
                .clone()
                .unwrap_or_else(|| "我已经看到这份学习日报，可以继续聊。".into()),
        },
    ];

    messages.extend(history.iter().map(|message| AiMessage {
        role: message.role.clone(),
        content: message.content.clone(),
    }));
    messages[0].content = aura_system_prompt(
        pet_preferences,
        "请基于日报上下文回答，保持简短、具体、友好，不要编造未提供的数据。",
    );
    messages
}

fn aura_system_prompt(pet_preferences: Option<&PetPreferences>, instruction: &str) -> String {
    if let Some(preferences) = pet_preferences {
        if preferences.pet_enabled {
            return format!(
                "你是 Aura Companion 的 AI 桌面伙伴，会基于用户本地学习/工作记录进行陪伴、提醒和复盘。角色设定如下：{}\n{}",
                preferences.pet_persona_prompt,
                instruction
            );
        }
    }
    format!(
        "你是 Aura Companion 的学习/工作复盘助手。你会基于用户本地记录进行总结和聊天。{}",
        instruction
    )
}

fn report_prompt_clean(report: &ReportContext, tone: Option<&str>) -> String {
    format!(
        "请根据以下本地学习日报生成总结：\n\
         report_id: {}\n\
         session_id: {}\n\
         started_at: {}\n\
         ended_at: {}\n\
         total_seconds: {}\n\
         focus_score: {}\n\
         pomodoro_completed: {}\n\
         app_usage_json: {}\n\
         activity_json: {}\n\
         总结语气: {}\n\
         要求：先用一句话概括，再给 2-3 条具体观察，最后给一句符合语气的建议或鼓励。",
        report.id,
        report.session_id,
        report.started_at,
        report.ended_at,
        report.total_seconds,
        report.focus_score,
        report.pomodoro_completed,
        report.app_usage_json,
        report.activity_json,
        tone_label_clean(tone)
    )
}

fn tone_label_clean(tone: Option<&str>) -> &'static str {
    match normalize_tone(tone.unwrap_or("witty")) {
        "gentle" => "温和鼓励",
        "normal" => "正常复盘",
        "strict" => "严格监督",
        _ => "轻微吐槽",
    }
}

fn tone_instruction_clean(tone: Option<&str>) -> &'static str {
    match normalize_tone(tone.unwrap_or("witty")) {
        "gentle" => "温和鼓励，重点肯定今天做得好的地方，少批评",
        "normal" => "正常复盘，客观指出表现、问题和下一步建议",
        "strict" => "严格监督，直说拖延和分心问题，但不要羞辱用户",
        _ => "轻微吐槽，语气可以有一点幽默，但要友好和有帮助",
    }
}

#[allow(dead_code)]
fn summary_messages(report: &ReportContext, tone: Option<&str>) -> Vec<AiMessage> {
    vec![
        AiMessage {
            role: "system".into(),
            content: format!(
                "你是 Aura 的学习总结助手。请用中文输出，不要编造未提供的数据。总结语气：{}。",
                tone_instruction(tone)
            ),
        },
        AiMessage {
            role: "user".into(),
            content: report_prompt(report, tone),
        },
    ]
}

#[allow(dead_code)]
fn chat_messages(report: &ReportContext, history: &[ChatMessage]) -> Vec<AiMessage> {
    let mut messages = vec![
        AiMessage {
            role: "system".into(),
            content:
                "你是 Aura 的学习复盘聊天助手。请基于日报上下文回答，保持简短、具体、友好。"
                    .into(),
        },
        AiMessage {
            role: "user".into(),
            content: report_prompt(report, None),
        },
        AiMessage {
            role: "assistant".into(),
            content: report
                .ai_summary
                .clone()
                .unwrap_or_else(|| "我已经看到这份学习日报，可以继续聊。".into()),
        },
    ];

    messages.extend(history.iter().map(|message| AiMessage {
        role: message.role.clone(),
        content: message.content.clone(),
    }));
    messages
}

#[allow(dead_code)]
fn report_prompt(report: &ReportContext, tone: Option<&str>) -> String {
    format!(
        "请根据以下本地学习日报生成总结：\n\
         report_id: {}\n\
         session_id: {}\n\
         started_at: {}\n\
         ended_at: {}\n\
         total_seconds: {}\n\
         focus_score: {}\n\
         pomodoro_completed: {}\n\
         app_usage_json: {}\n\
         activity_json: {}\n\
         总结语气: {}\n\
         要求：先一句话概括，再给 2-3 条具体观察，最后给一句符合语气的建议或鼓励。",
        report.id,
        report.session_id,
        report.started_at,
        report.ended_at,
        report.total_seconds,
        report.focus_score,
        report.pomodoro_completed,
        report.app_usage_json,
        report.activity_json,
        tone_label(tone)
    )
}

fn normalize_tone(tone: &str) -> &str {
    match tone {
        "gentle" | "normal" | "witty" | "strict" => tone,
        _ => "witty",
    }
}

#[allow(dead_code)]
fn tone_label(tone: Option<&str>) -> &'static str {
    match normalize_tone(tone.unwrap_or("witty")) {
        "gentle" => "温和鼓励",
        "normal" => "正常复盘",
        "strict" => "严格监督",
        _ => "轻微吐槽",
    }
}

#[allow(dead_code)]
fn tone_instruction(tone: Option<&str>) -> &'static str {
    match normalize_tone(tone.unwrap_or("witty")) {
        "gentle" => "温和鼓励，重点肯定今天做得好的地方，少批评",
        "normal" => "正常复盘，客观指出表现、问题和下一步建议",
        "strict" => "严格监督，直说拖延和分心问题，但不要羞辱用户",
        _ => "轻微吐槽，语气可以有一点幽默，但要友好和有帮助",
    }
}

fn human_seconds(seconds: i64) -> String {
    let minutes = seconds / 60;
    let remaining_seconds = seconds % 60;
    format!("{minutes}m {remaining_seconds}s")
}

fn start_sampler_if_needed(state: &State<AppState>, session_id: i64) -> AppResult<()> {
    let mut sampler = state
        .sampler
        .lock()
        .map_err(|_| "sampler lock failed".to_string())?;

    if sampler.is_some() {
        println!("[Aura collector] sampler already running");
        return Ok(());
    }

    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let thread_db = Arc::clone(&state.db);

    println!("[Aura collector] starting sampler for session {session_id}");
    let handle = thread::spawn(move || {
        while !thread_stop.load(Ordering::SeqCst) {
            match sample_foreground_window() {
                Ok(sample) => {
                    println!(
                        "[Aura collector] sample app='{}' title='{}'",
                        sample.app_name, sample.window_title
                    );
                    if let Ok(database) = thread_db.lock() {
                        if let Err(error) = database.add_window_sample(session_id, &sample) {
                            eprintln!("[Aura collector] failed to save sample: {error}");
                        }
                    } else {
                        eprintln!("[Aura collector] database lock failed");
                    }
                }
                Err(error) => {
                    eprintln!("[Aura collector] sample failed: {error}");
                }
            }

            thread::sleep(Duration::from_secs(1));
        }

        println!("[Aura collector] sampler stopped for session {session_id}");
    });

    *sampler = Some(SamplerHandle { stop, handle });
    Ok(())
}

fn stop_sampler(state: &State<AppState>) {
    let sampler = state.sampler.lock().ok().and_then(|mut value| value.take());
    if let Some(sampler) = sampler {
        println!("[Aura collector] stopping sampler");
        sampler.stop.store(true, Ordering::SeqCst);
        if sampler.handle.join().is_err() {
            eprintln!("[Aura collector] sampler thread panicked while stopping");
        }
    }
}

fn start_activity_if_needed(state: &State<AppState>, session_id: i64) -> AppResult<()> {
    if !db(state)?
        .get_app_preferences()
        .map_err(to_string)?
        .activity_capture_enabled
    {
        println!("[Aura activity] activity capture disabled by preferences");
        return Ok(());
    }

    let mut activity = state
        .activity
        .lock()
        .map_err(|_| "activity lock failed".to_string())?;

    if activity.is_some() {
        println!("[Aura activity] activity capture already running");
        return Ok(());
    }

    match start_activity_capture(session_id, Arc::clone(&state.db)) {
        Ok(handle) => {
            println!("[Aura activity] starting activity capture for session {session_id}");
            *activity = Some(handle);
        }
        Err(error) => {
            eprintln!("[Aura activity] activity capture unavailable: {error}");
        }
    }

    Ok(())
}

fn stop_activity(state: &State<AppState>) {
    let activity = state
        .activity
        .lock()
        .ok()
        .and_then(|mut value| value.take());
    if let Some(activity) = activity {
        println!("[Aura activity] stopping activity capture");
        activity.stop();
    }
}

fn pending_activity_counts(state: &State<AppState>) -> (i64, i64) {
    state
        .activity
        .lock()
        .ok()
        .and_then(|activity| activity.as_ref().map(|handle| handle.pending_counts()))
        .unwrap_or((0, 0))
}

fn spawn_pomodoro_timer(
    pomodoro: Arc<Mutex<PomodoroMachine>>,
    db: Arc<Mutex<Database>>,
    token: u64,
) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(1));

        let tick = match pomodoro.lock() {
            Ok(mut machine) => machine.tick_one_second(token),
            Err(_) => break,
        };

        match tick {
            TickResult::Completed(_) => {
                if let Ok(db) = db.lock() {
                    let _ = db.add_pomodoro_event("completed");
                }
                break;
            }
            TickResult::Cancelled => break,
            TickResult::Running | TickResult::Waiting => {}
        }
    });
}

fn app_data_dir(handle: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let dir = handle.path().app_data_dir()?;
    let legacy_dir = dir
        .parent()
        .map(|parent| parent.join(LEGACY_IDENTIFIER))
        .unwrap_or_else(|| dir.with_file_name(LEGACY_IDENTIFIER));
    ensure_aura_data_dir(&dir, &legacy_dir)?;
    Ok(dir)
}

fn ensure_aura_data_dir(
    aura_dir: &Path,
    legacy_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    if has_directory_files(aura_dir)? {
        return Ok(());
    }

    if legacy_dir.is_dir() {
        copy_dir_contents(legacy_dir, aura_dir)?;
        let legacy_db = aura_dir.join(LEGACY_DB_FILE);
        let aura_db = aura_dir.join(AURA_DB_FILE);
        if legacy_db.is_file() && !aura_db.exists() {
            fs::copy(&legacy_db, &aura_db)?;
        }
    } else {
        fs::create_dir_all(aura_dir)?;
    }
    Ok(())
}

fn has_directory_files(path: &Path) -> Result<bool, Box<dyn std::error::Error>> {
    if !path.is_dir() {
        return Ok(false);
    }
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() || (path.is_dir() && has_directory_files(&path)?) {
            return Ok(true);
        }
    }
    Ok(false)
}

fn copy_dir_contents(source: &Path, target: &Path) -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if source_path.is_dir() {
            copy_dir_contents(&source_path, &target_path)?;
        } else if source_path.is_file() && !target_path.exists() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&source_path, &target_path)?;
        }
    }
    Ok(())
}

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app_data_dir(app.handle())?;
            let db_path = data_dir.join(AURA_DB_FILE);
            let database = Database::open(&db_path)?;
            database.close_stale_studying_sessions()?;
            app.manage(AppState {
                db: Arc::new(Mutex::new(database)),
                data_dir,
                active_session_id: Mutex::new(None),
                pomodoro: Arc::new(Mutex::new(PomodoroMachine::new())),
                sampler: Mutex::new(None),
                activity: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_session,
            stop_session,
            get_current_status,
            get_today_dashboard,
            start_pomodoro,
            pause_pomodoro,
            reset_pomodoro,
            save_ai_settings,
            get_ai_settings_masked,
            test_ai_connection,
            list_ai_models,
            generate_ai_summary,
            chat_with_ai,
            chat_with_aura,
            get_aura_chat_history,
            clear_aura_chat_history,
            get_recent_reports,
            delete_daily_report,
            get_data_dir,
            open_data_dir,
            clear_local_data,
            export_daily_report,
            get_app_preferences,
            save_app_preferences,
            get_pet_preferences,
            save_pet_preferences,
            show_pet_window,
            hide_pet_window,
            drag_pet_window,
            get_pet_library_dir,
            open_pet_library_dir,
            import_pet_profile,
            get_pet_profiles,
            rescan_pet_profiles,
            send_proactive_pet_nudge
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aura");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_pet_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "aura-pet-test-{}-{}",
            name,
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&dir).expect("temp dir should be created");
        dir
    }

    #[test]
    fn migrates_legacy_studypulse_data_without_deleting_source() {
        let root = temp_pet_dir("migration");
        let legacy = root.join(LEGACY_IDENTIFIER);
        let aura = root.join("com.aura.app");
        fs::create_dir_all(legacy.join("pets/xinhua")).expect("legacy pets should exist");
        fs::write(legacy.join(LEGACY_DB_FILE), "legacy-db").expect("legacy db should exist");
        fs::write(legacy.join("pets/xinhua/pet.json"), "{}").expect("legacy pet should exist");

        ensure_aura_data_dir(&aura, &legacy).expect("legacy data should migrate");

        assert_eq!(
            fs::read_to_string(aura.join(AURA_DB_FILE)).expect("aura db copy should exist"),
            "legacy-db"
        );
        assert!(aura.join(LEGACY_DB_FILE).is_file());
        assert!(aura.join("pets/xinhua/pet.json").is_file());
        assert!(legacy.join(LEGACY_DB_FILE).is_file());
    }

    #[test]
    fn keeps_existing_aura_data_when_migrating() {
        let root = temp_pet_dir("migration-existing");
        let legacy = root.join(LEGACY_IDENTIFIER);
        let aura = root.join("com.aura.app");
        fs::create_dir_all(&legacy).expect("legacy dir should exist");
        fs::create_dir_all(&aura).expect("aura dir should exist");
        fs::write(legacy.join(LEGACY_DB_FILE), "legacy-db").expect("legacy db should exist");
        fs::write(aura.join(AURA_DB_FILE), "new-db").expect("new db should exist");

        ensure_aura_data_dir(&aura, &legacy).expect("existing aura data should be preserved");

        assert_eq!(
            fs::read_to_string(aura.join(AURA_DB_FILE)).expect("aura db should remain"),
            "new-db"
        );
        assert!(!aura.join(LEGACY_DB_FILE).exists());
    }

    #[test]
    fn atlas_metadata_skips_transparent_frames() {
        let dir = temp_pet_dir("atlas");
        let path = dir.join("spritesheet.png");
        let mut image = image::RgbaImage::new(
            PET_ATLAS_COLUMNS * PET_ATLAS_FRAME_WIDTH,
            PET_ATLAS_ROWS * PET_ATLAS_FRAME_HEIGHT,
        );
        for column in 0..6 {
            let start_x = column * PET_ATLAS_FRAME_WIDTH;
            for y in 0..PET_ATLAS_FRAME_HEIGHT {
                for x in start_x..start_x + PET_ATLAS_FRAME_WIDTH {
                    image.put_pixel(x, y, image::Rgba([255, 255, 255, 255]));
                }
            }
        }
        image.save(&path).expect("test atlas should save");

        let metadata = analyze_pet_atlas(&path).expect("atlas should be analyzed");

        assert_eq!(metadata.rows[0], vec![0, 1, 2, 3, 4, 5]);
        assert!(metadata.rows[1].is_empty());
    }

    #[test]
    fn calculates_session_total_seconds_from_timestamps() {
        let session = Session {
            id: 1,
            started_at: "2026-05-22T08:00:00+00:00".into(),
            ended_at: Some("2026-05-22T08:01:30+00:00".into()),
            status: "ended".into(),
        };

        assert_eq!(session_total_seconds(&session), 90);
    }

    #[test]
    fn calculates_current_session_elapsed_from_system_time() {
        let session = Session {
            id: 1,
            started_at: "2026-05-22T08:00:00+00:00".into(),
            ended_at: None,
            status: "studying".into(),
        };
        let now = DateTime::parse_from_rfc3339("2026-05-22T08:00:05+00:00")
            .expect("date should parse")
            .with_timezone(&Utc);

        assert_eq!(session_elapsed_seconds(&session, now), 5);
    }

    #[test]
    fn focus_score_stays_in_range() {
        assert_eq!(focus_score(0, 100, 0), 56);
        assert_eq!(focus_score(10 * 3600, 0, 10), 100);
    }

    #[test]
    fn report_prompt_contains_local_report_context() {
        let report = ReportContext {
            id: 7,
            session_id: 3,
            started_at: "2026-05-22T08:00:00+00:00".into(),
            ended_at: "2026-05-22T08:30:00+00:00".into(),
            total_seconds: 1800,
            focus_score: 86,
            app_usage_json: r#"[{"app_name":"Code","seconds":1200}]"#.into(),
            activity_json: "[]".into(),
            pomodoro_completed: 1,
            ai_summary: None,
        };

        let prompt = report_prompt(&report, Some("witty"));
        assert!(prompt.contains("report_id: 7"));
        assert!(prompt.contains("Code"));
        assert!(prompt.contains("focus_score: 86"));
        assert!(prompt.contains("轻微吐槽"));
    }

    #[test]
    fn renders_daily_report_markdown_export() {
        let report = ReportContext {
            id: 7,
            session_id: 3,
            started_at: "2026-05-22T08:00:00+00:00".into(),
            ended_at: "2026-05-22T08:30:00+00:00".into(),
            total_seconds: 1800,
            focus_score: 86,
            app_usage_json: r#"[{"app_name":"Code","seconds":1200}]"#.into(),
            activity_json: r#"[{"label":"08:05","keyboard":12,"mouse":3}]"#.into(),
            pomodoro_completed: 1,
            ai_summary: Some("状态不错，继续保持。".into()),
        };

        let content = render_report_export(&report, true).expect("report should render");

        assert!(content.contains("# Aura 日报 #7"));
        assert!(content.contains("Code"));
        assert!(content.contains("状态不错"));
    }

    #[test]
    fn tone_values_are_normalized() {
        assert_eq!(tone_label(Some("gentle")), "温和鼓励");
        assert_eq!(tone_label(Some("normal")), "正常复盘");
        assert_eq!(tone_label(Some("strict")), "严格监督");
        assert_eq!(tone_label(Some("unknown")), "轻微吐槽");
    }

    #[test]
    fn reads_legacy_pet_manifest() {
        let dir = temp_pet_dir("legacy");
        fs::write(dir.join("pet.png"), b"fake").expect("sprite should write");
        fs::write(
            dir.join("pet.json"),
            r#"{
              "id": "legacy",
              "displayName": "Legacy",
              "description": "old format",
              "spritesheetPath": "pet.png"
            }"#,
        )
        .expect("manifest should write");

        let profile = read_pet_profile_from_dir(&dir).expect("legacy profile should load");
        assert_eq!(profile.id, "legacy");
        assert!(profile.spritesheet_path.ends_with("pet.png"));
        assert!(profile.sprites.is_empty());
    }

    #[test]
    fn reads_multi_sprite_pet_manifest() {
        let dir = temp_pet_dir("sprites");
        fs::write(dir.join("idle.png"), b"fake").expect("idle should write");
        fs::write(dir.join("happy.webp"), b"fake").expect("happy should write");
        fs::write(
            dir.join("pet.json"),
            r#"{
              "id": "multi",
              "displayName": "Multi",
              "description": "new format",
              "spritesheetPath": "",
              "sprites": {
                "idle": "idle.png",
                "happy": "happy.webp"
              },
              "persona": "short and warm",
              "spriteScale": 1.25,
              "defaultEmotion": "happy"
            }"#,
        )
        .expect("manifest should write");

        let profile = read_pet_profile_from_dir(&dir).expect("multi profile should load");
        assert_eq!(profile.sprites.len(), 2);
        assert_eq!(profile.default_emotion, "happy");
        assert_eq!(profile.sprite_scale, 1.25);
    }

    #[test]
    fn rejects_pet_sprite_path_traversal() {
        let dir = temp_pet_dir("bad-path");
        fs::write(
            dir.join("pet.json"),
            r#"{
              "id": "bad",
              "displayName": "Bad",
              "description": "bad path",
              "spritesheetPath": "",
              "sprites": {
                "idle": "../idle.png"
              }
            }"#,
        )
        .expect("manifest should write");

        assert!(read_pet_profile_from_dir(&dir).is_err());
    }

    #[test]
    fn parses_structured_aura_reply_with_fallback() {
        let reply = parse_aura_reply(r#"{"message":"继续保持。","emotion":"happy"}"#, "idle");
        assert_eq!(reply.message, "继续保持。");
        assert_eq!(reply.emotion, "happy");

        let fallback = parse_aura_reply("普通文本", "nudge");
        assert_eq!(fallback.message, "普通文本");
        assert_eq!(fallback.emotion, "nudge");
    }
}
