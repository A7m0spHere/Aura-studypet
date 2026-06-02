use std::{
    fs,
    path::PathBuf,
    process::Command,
    sync::Arc,
};

use tauri::{Emitter, Manager, PhysicalPosition, State};

use crate::{
    ai,
    pomodoro::PomodoroState,
    types::*,
    aura_chat_messages, aura_chat_request_context,
    canonical_ai_settings_input_clean, chat_messages_clean,
    copy_pet_asset, dashboard_state, db as db_access, empty_dashboard,
    hydrate_saved_ai_key_if_needed, local_aura_chat_reply, local_pet_nudge,
    mock_ai_summary, now, parse_aura_reply, pet_library_dir, pet_prompt_from_bubble_lines,
    pomodoro as pomodoro_access, pomodoro_snapshot,
    proactive_pet_messages, read_pet_profile_from_dir, render_report_export,
    resolve_ai_settings, resolve_ai_settings_for_models,
    spawn_pomodoro_timer, start_activity_if_needed, start_sampler_if_needed,
    stop_activity, stop_sampler,
    summary_messages_clean, to_string,
    active_session, current_session_id,
    apply_pet_window_preferences_to_app, apply_pet_window_preferences_to_window,
    focus_score, non_empty_or, normalize_tone,
    report_for_session, session_total_seconds,
};

#[tauri::command]
pub(crate) fn start_session(state: State<AppState>) -> AppResult<Session> {
    if let Some(session_id) = *active_session(&state)? {
        return db_access(&state)?.get_session(session_id).map_err(to_string);
    }

    db_access(&state)?
        .close_stale_studying_sessions()
        .map_err(to_string)?;

    let session = db_access(&state)?.start_session().map_err(to_string)?;
    *active_session(&state)? = Some(session.id);
    start_sampler_if_needed(&state, session.id)?;
    start_activity_if_needed(&state, session.id)?;
    Ok(session)
}

#[tauri::command]
pub(crate) fn stop_session(state: State<AppState>) -> AppResult<DailyReport> {
    let session_id =
        current_session_id(&state)?.ok_or_else(|| "no active study session".to_string())?;

    stop_sampler(&state);
    stop_activity(&state);
    let session = db_access(&state)?.stop_session(session_id).map_err(to_string)?;
    db_access(&state)?
        .aggregate_app_usage(session_id)
        .map_err(to_string)?;
    let app_usage = db_access(&state)?
        .app_usage_for_session(session_id)
        .map_err(to_string)?;
    let pomodoro_completed = pomodoro_snapshot(&state).completed_count;
    let total_seconds = session_total_seconds(&session);
    let focus_score = focus_score(total_seconds, app_usage.len(), pomodoro_completed);
    let activity = db_access(&state)?
        .activity_points_for_session(session_id)
        .map_err(to_string)?;
    let app_usage_json = serde_json::to_string(&app_usage).map_err(to_string)?;
    let activity_json = serde_json::to_string(&activity).map_err(to_string)?;
    let report_id = db_access(&state)?
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

    let report = report_for_session(
        report_id,
        session,
        total_seconds,
        focus_score,
        app_usage,
        activity,
        pomodoro_completed,
        None,
    );
    *active_session(&state)? = None;
    Ok(report)
}

#[tauri::command]
pub(crate) fn get_current_status(state: State<AppState>) -> DashboardState {
    dashboard_state(&state).unwrap_or_else(|error| {
        eprintln!("[Aura dashboard] failed to load dashboard: {error}");
        empty_dashboard(pomodoro_snapshot(&state))
    })
}

#[tauri::command]
pub(crate) fn get_today_dashboard(state: State<AppState>) -> DashboardState {
    get_current_status(state)
}

#[tauri::command]
pub(crate) fn start_pomodoro(minutes: i64, state: State<AppState>) -> AppResult<PomodoroState> {
    let (snapshot, token) = {
        let mut machine = pomodoro_access(&state)?;
        machine.start(minutes)
    };

    spawn_pomodoro_timer(Arc::clone(&state.pomodoro), Arc::clone(&state.db), token);
    Ok(snapshot)
}

#[tauri::command]
pub(crate) fn pause_pomodoro(state: State<AppState>) -> AppResult<PomodoroState> {
    Ok(pomodoro_access(&state)?.pause())
}

#[tauri::command]
pub(crate) fn reset_pomodoro(state: State<AppState>) -> AppResult<PomodoroState> {
    Ok(pomodoro_access(&state)?.reset())
}

#[tauri::command]
pub(crate) fn save_ai_settings(settings: AiSettingsInput, state: State<AppState>) -> AppResult<()> {
    let settings = hydrate_saved_ai_key_if_needed(settings, &state)?;
    let canonical = canonical_ai_settings_input_clean(&settings)?;
    db_access(&state)?.save_ai_settings(&canonical).map_err(to_string)
}

#[tauri::command]
pub(crate) fn get_ai_settings_masked(state: State<AppState>) -> AppResult<AiSettingsMasked> {
    db_access(&state)?.get_ai_settings_masked().map_err(to_string)
}

#[tauri::command]
pub(crate) fn delete_ai_settings_provider(provider: String, state: State<AppState>) -> AppResult<()> {
    db_access(&state)?
        .delete_ai_settings_provider(&provider)
        .map_err(to_string)
}

#[tauri::command]
pub(crate) async fn test_ai_connection(
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
pub(crate) async fn list_ai_models(
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
pub(crate) async fn generate_ai_summary(
    report_id: i64,
    tone: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let (settings, report, pet_preferences) = {
        let database = db_access(&state)?;
        (
            database.get_ai_settings().map_err(to_string)?,
            database.get_report_context(report_id).map_err(to_string)?,
            database.get_pet_preferences().map_err(to_string)?,
        )
    };

    let Some(settings) = settings else {
        let summary = mock_ai_summary(&report, Some(&pet_preferences));
        db_access(&state)?
            .update_report_summary(report_id, &summary)
            .map_err(to_string)?;
        return Ok(summary);
    };
    if settings.api_key.trim().is_empty() {
        let summary = mock_ai_summary(&report, Some(&pet_preferences));
        db_access(&state)?
            .update_report_summary(report_id, &summary)
            .map_err(to_string)?;
        return Ok(summary);
    }

    let summary = ai::chat_completion(
        &settings,
        summary_messages_clean(&report, tone.as_deref(), Some(&pet_preferences)),
    )
    .await?;
    db_access(&state)?
        .update_report_summary(report_id, &summary)
        .map_err(to_string)?;
    Ok(summary)
}

#[tauri::command]
pub(crate) fn get_recent_reports(limit: Option<i64>, state: State<AppState>) -> AppResult<Vec<DailyReport>> {
    db_access(&state)?
        .recent_daily_reports(limit.unwrap_or(30))
        .map_err(to_string)
}

#[tauri::command(rename_all = "snake_case")]
pub(crate) fn delete_daily_report(report_id: i64, state: State<AppState>) -> AppResult<()> {
    db_access(&state)?
        .delete_daily_report(report_id)
        .map_err(to_string)
}

#[tauri::command]
pub(crate) fn get_data_dir(state: State<AppState>) -> String {
    state.data_dir.to_string_lossy().to_string()
}

#[tauri::command]
pub(crate) fn open_data_dir(state: State<AppState>) -> AppResult<()> {
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
pub(crate) fn clear_local_data(state: State<AppState>) -> AppResult<()> {
    if current_session_id(&state)?.is_some() {
        return Err("请先结束当前学习会话，再清空本地学习数据。".into());
    }
    stop_sampler(&state);
    stop_activity(&state);
    db_access(&state)?.clear_local_data().map_err(to_string)
}

#[tauri::command(rename_all = "snake_case")]
pub(crate) fn export_daily_report(
    report_id: i64,
    format: String,
    state: State<AppState>,
) -> AppResult<String> {
    let report = db_access(&state)?
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
pub(crate) fn get_app_preferences(state: State<AppState>) -> AppResult<AppPreferences> {
    db_access(&state)?.get_app_preferences().map_err(to_string)
}

#[tauri::command]
pub(crate) fn save_app_preferences(
    preferences: AppPreferencesInput,
    state: State<AppState>,
) -> AppResult<AppPreferences> {
    let minutes = preferences.default_pomodoro_minutes.clamp(1, 180);
    let tone = normalize_tone(&preferences.ai_summary_tone).to_string();
    db_access(&state)?
        .save_app_preferences(
            preferences.privacy_notice_accepted,
            minutes,
            &tone,
            preferences.activity_capture_enabled,
        )
        .map_err(to_string)?;
    db_access(&state)?.get_app_preferences().map_err(to_string)
}

#[tauri::command]
pub(crate) fn get_pet_preferences(state: State<AppState>) -> AppResult<PetPreferences> {
    db_access(&state)?.get_pet_preferences().map_err(to_string)
}

#[tauri::command]
pub(crate) fn save_pet_preferences(
    preferences: PetPreferencesInput,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> AppResult<PetPreferences> {
    let current = db_access(&state)?.get_pet_preferences().map_err(to_string)?;
    let pet_name = non_empty_or(preferences.pet_name, &current.pet_name);
    let pet_persona_prompt =
        non_empty_or(preferences.pet_persona_prompt, DEFAULT_PET_PERSONA_PROMPT);
    let active_pet_id = non_empty_or(preferences.active_pet_id, &current.active_pet_id);
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
        pet_always_on_top: preferences.pet_always_on_top,
        pet_scale: preferences.pet_scale.clamp(0.8, 1.4),
    };
    db_access(&state)?
        .save_pet_preferences(&normalized)
        .map_err(to_string)?;
    apply_pet_window_preferences_to_app(&app, &normalized)?;
    db_access(&state)?.get_pet_preferences().map_err(to_string)
}

#[tauri::command]
pub(crate) fn show_pet_window(app: tauri::AppHandle, state: State<AppState>) -> AppResult<()> {
    let preferences = db_access(&state)?.get_pet_preferences().map_err(to_string)?;
    if !preferences.pet_enabled {
        return Err("桌宠模式尚未启用。".into());
    }
    let Some(window) = app.get_webview_window("pet") else {
        return Err("pet window is not available".into());
    };
    let _ = window.set_shadow(false);
    apply_pet_window_preferences_to_window(&window, &preferences)?;
    window.show().map_err(to_string)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn hide_pet_window(app: tauri::AppHandle) -> AppResult<()> {
    let Some(window) = app.get_webview_window("pet") else {
        return Ok(());
    };
    window.hide().map_err(to_string)
}

#[tauri::command]
pub(crate) fn drag_pet_window(app: tauri::AppHandle) -> AppResult<()> {
    let Some(window) = app.get_webview_window("pet") else {
        return Err("pet window is not available".into());
    };
    window.start_dragging().map_err(to_string)
}

#[tauri::command(rename_all = "snake_case")]
pub(crate) fn show_pet_menu(app: tauri::AppHandle, x: i32, y: i32) -> AppResult<()> {
    let Some(window) = app.get_webview_window("pet-menu") else {
        return Err("pet menu window is not available".into());
    };
    let _ = window.set_shadow(false);
    let (x, y) = match (
        window.current_monitor().map_err(to_string)?,
        window.outer_size(),
    ) {
        (Some(monitor), Ok(size)) => {
            let area = monitor.work_area();
            let min_x = area.position.x;
            let min_y = area.position.y;
            let max_x = area.position.x + area.size.width as i32 - size.width as i32;
            let max_y = area.position.y + area.size.height as i32 - size.height as i32;
            (
                x.clamp(min_x, max_x.max(min_x)),
                y.clamp(min_y, max_y.max(min_y)),
            )
        }
        _ => (x, y),
    };
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(to_string)?;
    window.show().map_err(to_string)?;
    window.set_focus().map_err(to_string)?;
    window
        .emit("pet-menu-opened", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn hide_pet_menu(app: tauri::AppHandle) -> AppResult<()> {
    let Some(window) = app.get_webview_window("pet-menu") else {
        return Ok(());
    };
    window.hide().map_err(to_string)
}

#[tauri::command(rename_all = "snake_case")]
pub(crate) fn show_main_window(app: tauri::AppHandle, settings_tab: Option<String>) -> AppResult<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("main window is not available".into());
    };
    window.show().map_err(to_string)?;
    window.unminimize().map_err(to_string)?;
    window.set_focus().map_err(to_string)?;
    if let Some(tab) = settings_tab {
        window
            .emit("open-settings", tab)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn apply_pet_window_preferences(app: tauri::AppHandle, state: State<AppState>) -> AppResult<()> {
    let preferences = db_access(&state)?.get_pet_preferences().map_err(to_string)?;
    apply_pet_window_preferences_to_app(&app, &preferences)
}

#[tauri::command]
pub(crate) fn get_pet_library_dir(state: State<AppState>) -> AppResult<String> {
    let pet_root = pet_library_dir(&state.data_dir);
    fs::create_dir_all(&pet_root).map_err(to_string)?;
    Ok(pet_root.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn open_pet_library_dir(state: State<AppState>) -> AppResult<()> {
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
pub(crate) fn import_pet_profile(folder_path: String, state: State<AppState>) -> AppResult<PetProfile> {
    let source_dir = PathBuf::from(folder_path.trim());
    if !source_dir.is_dir() {
        return Err("请选择一个包含 pet.json 的宠物文件夹。".into());
    }
    let profile = read_pet_profile_from_dir(&source_dir)?;
    if profile.id == "default-aura" {
        return Err("default-aura 是历史保留 id，请换一个 id。".into());
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
    let mut preferences = db_access(&state)?.get_pet_preferences().map_err(to_string)?;
    preferences.active_pet_id = imported.id.clone();
    preferences.pet_name = imported.display_name.clone();
    if let Some(prompt) = imported.persona.clone() {
        preferences.pet_persona_prompt = prompt;
    } else if let Some(prompt) = pet_prompt_from_bubble_lines(&target_dir)? {
        preferences.pet_persona_prompt = prompt;
    }
    db_access(&state)?
        .save_pet_preferences(&preferences)
        .map_err(to_string)?;
    Ok(imported)
}

#[tauri::command]
pub(crate) fn get_pet_profiles(state: State<AppState>) -> AppResult<Vec<PetProfile>> {
    Ok(scan_pet_profiles(&state)?.profiles)
}

#[tauri::command]
pub(crate) fn rescan_pet_profiles(state: State<AppState>) -> AppResult<PetProfileScanResult> {
    scan_pet_profiles(&state)
}

fn scan_pet_profiles(state: &State<AppState>) -> AppResult<PetProfileScanResult> {
    let mut profiles = Vec::new();
    let mut messages = Vec::new();
    let pet_root = pet_library_dir(&state.data_dir);
    fs::create_dir_all(&pet_root).map_err(to_string)?;
    if !pet_root.is_dir() {
        return Ok(PetProfileScanResult { profiles, messages });
    }
    for entry in fs::read_dir(&pet_root).map_err(to_string)? {
        let entry = entry.map_err(to_string)?;
        let path = entry.path();
        if path.is_dir() {
            let folder_name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("未知目录")
                .to_string();
            let inferred_default_spritesheet = pet_uses_implicit_default_spritesheet(&path);
            match read_pet_profile_from_dir(&path) {
                Ok(profile) => {
                    if inferred_default_spritesheet {
                        messages.push(format!(
                            "{folder_name}：pet.json 未声明 spritesheetPath，已自动使用 spritesheet.webp。"
                        ));
                    }
                    profiles.push(profile);
                }
                Err(error) => {
                    let message = format!("{folder_name}：{error}");
                    eprintln!("[Aura Companion pet] ignored invalid pet: {message}");
                    messages.push(message);
                }
            }
        }
    }
    profiles.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    profiles.dedup_by(|a, b| a.id == b.id);
    Ok(PetProfileScanResult { profiles, messages })
}

fn pet_uses_implicit_default_spritesheet(dir: &std::path::Path) -> bool {
    if !dir.join("spritesheet.webp").is_file() {
        return false;
    }
    let Ok(text) = fs::read_to_string(dir.join("pet.json")) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return false;
    };
    let spritesheet_path_empty = value
        .get("spritesheetPath")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .unwrap_or("")
        .is_empty();
    let sprites_empty = value
        .get("sprites")
        .and_then(|item| item.as_object())
        .map(|items| items.is_empty())
        .unwrap_or(true);
    spritesheet_path_empty && sprites_empty
}

#[tauri::command(rename_all = "snake_case")]
pub(crate) async fn send_proactive_pet_nudge(
    event_type: String,
    state: State<'_, AppState>,
) -> AppResult<ProactivePetNudge> {
    let event_type = match event_type.as_str() {
        "idle_app" | "app_switch" => event_type,
        _ => return Err("unknown proactive pet event".into()),
    };
    let (preferences, settings, dashboard) = {
        let preferences = db_access(&state)?.get_pet_preferences().map_err(to_string)?;
        if !preferences.pet_enabled || !preferences.proactive_ai_enabled {
            return Err("主动 AI 关心尚未启用。".into());
        }
        let settings = db_access(&state)?.get_ai_settings().map_err(to_string)?;
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
pub(crate) async fn chat_with_aura(message: String, state: State<'_, AppState>) -> AppResult<AuraChatMessage> {
    let message = message.trim().to_string();
    if message.is_empty() {
        return Err("message cannot be empty".into());
    }

    let (settings, history, pet_preferences) = {
        let database = db_access(&state)?;
        aura_chat_request_context(&database, &message)?
    };
    let dashboard = dashboard_state(&state)?;

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

    db_access(&state)?
        .add_aura_chat_message("assistant", &reply.message, &reply.emotion)
        .map_err(to_string)
}

#[tauri::command]
pub(crate) fn get_aura_chat_history(state: State<AppState>) -> AppResult<Vec<AuraChatMessage>> {
    db_access(&state)?.aura_chat_messages(80).map_err(to_string)
}

#[tauri::command]
pub(crate) fn clear_aura_chat_history(state: State<AppState>) -> AppResult<()> {
    db_access(&state)?.clear_aura_chat_messages().map_err(to_string)
}

#[tauri::command(rename_all = "snake_case")]
pub(crate) async fn chat_with_ai(
    report_id: i64,
    message: String,
    state: State<'_, AppState>,
) -> AppResult<ChatMessage> {
    let message = message.trim().to_string();
    if message.is_empty() {
        return Err("message cannot be empty".into());
    }

    let (settings, report, history, pet_preferences) = {
        let database = db_access(&state)?;
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

    db_access(&state)?
        .add_chat_message(report_id, "assistant", &reply)
        .map_err(to_string)
}
