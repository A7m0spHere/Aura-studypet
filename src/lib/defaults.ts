import type { AppPreferences, PetPreferences } from "./types";

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  privacy_notice_accepted: false,
  default_pomodoro_minutes: 25,
  ai_summary_tone: "witty",
  activity_capture_enabled: true,
};

export const DEFAULT_PET_PREFERENCES: PetPreferences = {
  pet_enabled: false,
  pet_name: "",
  pet_persona_prompt: "",
  pet_bubble_enabled: true,
  proactive_ai_enabled: false,
  idle_nudge_minutes: 30,
  app_switch_nudge_enabled: true,
  active_pet_id: "",
  first_pet_enable_seen: false,
  pet_always_on_top: true,
  pet_scale: 1,
};
