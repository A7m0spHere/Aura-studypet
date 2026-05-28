mod activity;
mod ai;
mod collector;
mod commands;
mod db;
mod pomodoro;
mod types;

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard,
    },
    thread,
    time::Duration,
};

use activity::start_activity_capture;
use ai::{AiMessage, AiSettings};
use chrono::{DateTime, Datelike, Local, TimeZone, Timelike, Utc};
use collector::sample_foreground_window;
use db::Database;
use pomodoro::{PomodoroMachine, PomodoroState, TickResult};
use tauri::{LogicalSize, Manager, State};

pub(crate) use types::*;

use commands as cmd;

/* -------------------------------------------------------------------------- */
/*  helper functions                                                          */
/* -------------------------------------------------------------------------- */

pub(crate) fn dashboard_state(state: &State<AppState>) -> AppResult<DashboardState> {
    let now = Utc::now();
    let active_id = current_session_id(state)?;
    let latest_sample = if active_id.is_some() {
        db(state)?.latest_window_sample().map_err(to_string)?
    } else {
        None
    };
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
            .app_usage_from_samples_since(&local_day_start_utc(now))
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
    let focus_score_val = focus_score(
        today_study_seconds,
        app_usage.len(),
        pomodoro_snapshot(state).completed_count,
    );
    let active_report_id = if active_id.is_some() {
        None
    } else {
        db(state)?.latest_report_id().map_err(to_string)?
    };

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
        focus_score: focus_score_val,
        app_usage,
        activity,
        pomodoro: pomodoro_snapshot(state),
        active_report_id,
        ai_summary: None,
    })
}

pub(crate) fn empty_dashboard(pomodoro_state: PomodoroState) -> DashboardState {
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
        pomodoro: pomodoro_state,
        active_report_id: None,
        ai_summary: None,
    }
}

pub(crate) fn report_for_session(
    id: i64,
    session: Session,
    total_seconds: i64,
    focus_score_val: i64,
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
        focus_score: focus_score_val,
        app_usage,
        activity,
        pomodoro_completed,
        ai_summary,
    }
}

pub(crate) fn pet_library_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("pets")
}

pub(crate) fn analyze_pet_atlas(path: &Path) -> AppResult<PetAtlasMetadata> {
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

pub(crate) fn read_pet_profile_from_dir(dir: &Path) -> AppResult<PetProfile> {
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
        let emotion = db::normalize_emotion(emotion).to_string();
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
        default_emotion: db::normalize_emotion(manifest.default_emotion.as_deref().unwrap_or("idle"))
            .to_string(),
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

pub(crate) fn pet_prompt_from_bubble_lines(dir: &Path) -> AppResult<Option<String>> {
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

pub(crate) fn non_empty_or(value: String, fallback: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        fallback.to_string()
    } else {
        value.to_string()
    }
}

pub(crate) fn validate_pet_asset_path(
    dir: &Path,
    relative_path: &str,
    field: &str,
) -> AppResult<PathBuf> {
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

pub(crate) fn copy_pet_asset(
    source_dir: &Path,
    target_dir: &Path,
    relative_path: &str,
) -> AppResult<()> {
    let source = validate_pet_asset_path(source_dir, relative_path, "图片资源")?;
    let target = target_dir.join(relative_path.trim());
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(to_string)?;
    }
    fs::copy(source, target).map_err(to_string)?;
    Ok(())
}

pub(crate) fn local_pet_nudge(event_type: &str, dashboard: &DashboardState) -> String {
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

pub(crate) fn local_aura_chat_reply(message: &str, dashboard: &DashboardState) -> String {
    format!(
        r#"{{"message":"我看到了：{}。当前在 {}，今天专注分是 {}。我会先陪你把下一小步稳住。","emotion":"happy"}}"#,
        message.replace('"', "'"),
        dashboard.current_app.replace('"', "'"),
        dashboard.focus_score
    )
}

pub(crate) fn parse_aura_reply(raw: &str, fallback_emotion: &str) -> AuraReply {
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
            .map(db::normalize_emotion)
            .unwrap_or_else(|| db::normalize_emotion(fallback_emotion))
            .to_string();
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
        emotion: db::normalize_emotion(fallback_emotion).to_string(),
        created_at: now(),
    }
}

pub(crate) fn proactive_pet_messages(
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

pub(crate) fn aura_chat_messages(
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

pub(crate) fn render_report_export(report: &ReportContext, markdown: bool) -> AppResult<String> {
    let app_usage: Vec<AppUsage> =
        serde_json::from_str(&report.app_usage_json).unwrap_or_default();
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
        lines.push(format!(
            "学习时长：{}",
            human_seconds(report.total_seconds)
        ));
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

/* -------------------------------------------------------------------------- */
/*  state accessors                                                           */
/* -------------------------------------------------------------------------- */

pub(crate) fn db<'a>(state: &'a State<'_, AppState>) -> AppResult<MutexGuard<'a, Database>> {
    state.db.lock().map_err(|_| "database lock failed".into())
}

pub(crate) fn active_session<'a>(
    state: &'a State<'_, AppState>,
) -> AppResult<MutexGuard<'a, Option<i64>>> {
    state
        .active_session_id
        .lock()
        .map_err(|_| "session lock failed".into())
}

pub(crate) fn pomodoro<'a>(
    state: &'a State<'_, AppState>,
) -> AppResult<MutexGuard<'a, PomodoroMachine>> {
    state
        .pomodoro
        .lock()
        .map_err(|_| "pomodoro lock failed".into())
}

pub(crate) fn pomodoro_snapshot(state: &State<AppState>) -> PomodoroState {
    state
        .pomodoro
        .lock()
        .map(|machine| machine.snapshot())
        .unwrap_or_default()
}

pub(crate) fn current_session_id(state: &State<AppState>) -> AppResult<Option<i64>> {
    Ok(*active_session(state)?)
}

/* -------------------------------------------------------------------------- */
/*  time / score helpers                                                      */
/* -------------------------------------------------------------------------- */

pub(crate) fn session_total_seconds(session: &Session) -> i64 {
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
    (now - started_at.with_timezone(&Utc))
        .num_seconds()
        .max(0)
}

pub(crate) fn focus_score(
    total_seconds: i64,
    app_count: usize,
    pomodoro_completed: i64,
) -> i64 {
    let duration_bonus = (total_seconds / 900).min(8);
    let switch_penalty = (app_count.saturating_sub(3) as i64 * 4).min(24);
    let pomodoro_bonus = (pomodoro_completed * 4).min(12);
    (80 + duration_bonus + pomodoro_bonus - switch_penalty).clamp(0, 100)
}

fn local_day_start_utc(now: DateTime<Utc>) -> String {
    let local_now = now.with_timezone(&Local);
    let date = local_now.date_naive();
    Local
        .with_ymd_and_hms(date.year(), date.month(), date.day(), 0, 0, 0)
        .single()
        .unwrap_or(local_now)
        .with_timezone(&Utc)
        .to_rfc3339()
}

/* -------------------------------------------------------------------------- */
/*  AI prompt helpers                                                         */
/* -------------------------------------------------------------------------- */

pub(crate) fn mock_ai_summary(
    report: &ReportContext,
    pet_preferences: Option<&PetPreferences>,
) -> String {
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

pub(crate) fn canonical_ai_settings_input_clean(
    settings: &AiSettingsInput,
) -> AppResult<AiSettingsInput> {
    let provider = normalize_ai_provider(settings.provider.as_deref());
    match provider.as_str() {
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
        value if db::is_custom_provider(value) => {
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
                provider: Some(provider),
                base_url: settings.base_url.trim().into(),
                api_key: settings.api_key.trim().into(),
                model: settings.model.trim().into(),
            })
        }
        _ => Err("未知的 API 供应商。".into()),
    }
}

pub(crate) fn hydrate_saved_ai_key_if_needed(
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
    if !provider_state
        .map(|item| item.configured)
        .unwrap_or(false)
    {
        return Ok(settings);
    }

    let Some(saved) = db(state)?
        .get_ai_settings_for_provider(&provider)
        .map_err(to_string)?
    else {
        return Ok(settings);
    };

    Ok(AiSettingsInput {
        api_key: saved.api_key,
        ..settings
    })
}

pub(crate) fn resolve_ai_settings(settings: &AiSettingsInput) -> AppResult<AiSettings> {
    let canonical = canonical_ai_settings_input_clean(settings)?;
    Ok(AiSettings {
        base_url: canonical.base_url,
        api_key: canonical.api_key,
        model: canonical.model,
    })
}

pub(crate) fn resolve_ai_settings_for_models(
    settings: &AiSettingsInput,
) -> AppResult<AiSettings> {
    let provider = normalize_ai_provider(settings.provider.as_deref());
    let (base_url, api_key) = match provider.as_str() {
        "deepseek" => (
            "https://api.deepseek.com".to_string(),
            settings.api_key.trim().to_string(),
        ),
        value if db::is_custom_provider(value) => {
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

fn normalize_ai_provider(provider: Option<&str>) -> String {
    match provider.map(str::trim).filter(|value| !value.is_empty()) {
        Some("deepseek") => "deepseek".into(),
        Some(value) if db::is_custom_provider(value) => value.into(),
        _ => "unknown".into(),
    }
}

fn deepseek_models() -> [&'static str; 2] {
    ["deepseek-v4-pro", "deepseek-v4-flash"]
}

pub(crate) fn summary_messages_clean(
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

pub(crate) fn chat_messages_clean(
    report: &ReportContext,
    history: &[ChatMessage],
    pet_preferences: Option<&PetPreferences>,
) -> Vec<AiMessage> {
    let mut messages = vec![
        AiMessage {
            role: "system".into(),
            content: "你是 Aura 的学习复盘聊天助手。请基于日报上下文回答，保持简短、具体、友好。"
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
            let persona = format!(
                "当前桌宠心情：{}\n{}",
                daily_pet_mood(),
                preferences.pet_persona_prompt
            );
            return format!(
                "你是 Aura Companion 的 AI 桌面伙伴，会基于用户本地学习/工作记录进行陪伴、提醒和复盘。角色设定如下：{}\n{}",
                persona,
                instruction
            );
        }
    }
    format!(
        "你是 Aura Companion 的学习/工作复盘助手。你会基于用户本地记录进行总结和聊天。{}",
        instruction
    )
}

fn daily_pet_mood() -> &'static str {
    let now = Local::now();
    let bucket = match now.hour() {
        5..=10 => 0,
        11..=16 => 1,
        17..=21 => 2,
        _ => 3,
    };
    match (now.ordinal() as usize + bucket) % 5 {
        0 => "安静专注",
        1 => "轻快好奇",
        2 => "温柔鼓励",
        3 => "有点俏皮",
        _ => "认真陪伴",
    }
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

pub(crate) fn tone_label_clean(tone: Option<&str>) -> &'static str {
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

pub(crate) fn normalize_tone(tone: &str) -> &str {
    match tone {
        "gentle" | "normal" | "witty" | "strict" => tone,
        _ => "witty",
    }
}

fn human_seconds(seconds: i64) -> String {
    let minutes = seconds / 60;
    let remaining_seconds = seconds % 60;
    format!("{minutes}m {remaining_seconds}s")
}

/* -------------------------------------------------------------------------- */
/*  sampler / activity lifecycle                                              */
/* -------------------------------------------------------------------------- */

pub(crate) fn start_sampler_if_needed(
    state: &State<AppState>,
    session_id: i64,
) -> AppResult<()> {
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

pub(crate) fn stop_sampler(state: &State<AppState>) {
    let sampler = state
        .sampler
        .lock()
        .ok()
        .and_then(|mut value| value.take());
    if let Some(sampler) = sampler {
        println!("[Aura collector] stopping sampler");
        sampler.stop.store(true, Ordering::SeqCst);
        if sampler.handle.join().is_err() {
            eprintln!("[Aura collector] sampler thread panicked while stopping");
        }
    }
}

pub(crate) fn start_activity_if_needed(
    state: &State<AppState>,
    session_id: i64,
) -> AppResult<()> {
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

pub(crate) fn stop_activity(state: &State<AppState>) {
    let activity = state
        .activity
        .lock()
        .ok()
        .and_then(|mut value| value.take());
    if let Some(activity) = activity {
        println!("[Aura activity] stopping activity capture");
        let session_id = current_session_id(state).unwrap_or(None).unwrap_or(0);
        activity.stop(session_id, &state.db);
    }
}

/* -------------------------------------------------------------------------- */
/*  window helpers                                                            */
/* -------------------------------------------------------------------------- */

pub(crate) fn apply_pet_window_preferences_to_app(
    app: &tauri::AppHandle,
    preferences: &PetPreferences,
) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("pet") {
        apply_pet_window_preferences_to_window(&window, preferences)?;
    }
    Ok(())
}

pub(crate) fn apply_pet_window_preferences_to_window(
    window: &tauri::WebviewWindow,
    preferences: &PetPreferences,
) -> AppResult<()> {
    window
        .set_always_on_top(preferences.pet_always_on_top)
        .map_err(to_string)?;
    let scale = preferences.pet_scale.clamp(0.8, 1.4);
    window
        .set_size(LogicalSize::new(300.0 * scale, 380.0 * scale))
        .map_err(to_string)?;
    Ok(())
}

fn pending_activity_counts(state: &State<AppState>) -> (i64, i64) {
    state
        .activity
        .lock()
        .ok()
        .and_then(|activity| activity.as_ref().map(|handle| handle.pending_counts()))
        .unwrap_or((0, 0))
}

pub(crate) fn spawn_pomodoro_timer(
    pomodoro_machine: Arc<Mutex<PomodoroMachine>>,
    db_arc: Arc<Mutex<Database>>,
    token: u64,
) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(1));

        let tick = match pomodoro_machine.lock() {
            Ok(mut machine) => machine.tick_one_second(token),
            Err(_) => break,
        };

        match tick {
            TickResult::Completed(_) => {
                if let Ok(database) = db_arc.lock() {
                    let _ = database.add_pomodoro_event("completed");
                }
                break;
            }
            TickResult::Cancelled => break,
            TickResult::Running | TickResult::Waiting => {}
        }
    });
}

/* -------------------------------------------------------------------------- */
/*  migration                                                                 */
/* -------------------------------------------------------------------------- */

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

fn copy_dir_contents(
    source: &Path,
    target: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
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

/* -------------------------------------------------------------------------- */
/*  utilities                                                                 */
/* -------------------------------------------------------------------------- */

pub(crate) fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

pub(crate) fn now() -> String {
    Utc::now().to_rfc3339()
}

pub(crate) fn aura_chat_request_context(
    database: &Database,
    message: &str,
) -> AppResult<(Option<AiSettings>, Vec<AuraChatMessage>, PetPreferences)> {
    let settings = database.get_ai_settings().map_err(to_string)?;
    database
        .add_aura_chat_message("user", message, "idle")
        .map_err(to_string)?;
    let history = database.aura_chat_messages(40).map_err(to_string)?;
    let pet_preferences = database.get_pet_preferences().map_err(to_string)?;
    Ok((settings, history, pet_preferences))
}

/* -------------------------------------------------------------------------- */
/*  main                                                                      */
/* -------------------------------------------------------------------------- */

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
            cmd::start_session,
            cmd::stop_session,
            cmd::get_current_status,
            cmd::get_today_dashboard,
            cmd::start_pomodoro,
            cmd::pause_pomodoro,
            cmd::reset_pomodoro,
            cmd::save_ai_settings,
            cmd::get_ai_settings_masked,
            cmd::delete_ai_settings_provider,
            cmd::test_ai_connection,
            cmd::list_ai_models,
            cmd::generate_ai_summary,
            cmd::chat_with_ai,
            cmd::chat_with_aura,
            cmd::get_aura_chat_history,
            cmd::clear_aura_chat_history,
            cmd::get_recent_reports,
            cmd::delete_daily_report,
            cmd::get_data_dir,
            cmd::open_data_dir,
            cmd::clear_local_data,
            cmd::export_daily_report,
            cmd::get_app_preferences,
            cmd::save_app_preferences,
            cmd::get_pet_preferences,
            cmd::save_pet_preferences,
            cmd::show_pet_window,
            cmd::hide_pet_window,
            cmd::drag_pet_window,
            cmd::show_pet_menu,
            cmd::hide_pet_menu,
            cmd::show_main_window,
            cmd::apply_pet_window_preferences,
            cmd::get_pet_library_dir,
            cmd::open_pet_library_dir,
            cmd::import_pet_profile,
            cmd::get_pet_profiles,
            cmd::rescan_pet_profiles,
            cmd::send_proactive_pet_nudge
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aura");
}

/* -------------------------------------------------------------------------- */
/*  tests                                                                     */
/* -------------------------------------------------------------------------- */

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
    fn aura_chat_context_loads_without_dashboard_reentry() {
        let database = Database::memory().expect("database should initialize");

        let (settings, history, preferences) =
            aura_chat_request_context(&database, "hello").expect("context should load");

        assert!(settings.is_none());
        assert!(!preferences.pet_enabled);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].role, "user");
        assert_eq!(history[0].content, "hello");
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

        let prompt = report_prompt_clean(&report, Some("witty"));
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
        assert_eq!(tone_label_clean(Some("gentle")), "温和鼓励");
        assert_eq!(tone_label_clean(Some("normal")), "正常复盘");
        assert_eq!(tone_label_clean(Some("strict")), "严格监督");
        assert_eq!(tone_label_clean(Some("unknown")), "轻微吐槽");
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
