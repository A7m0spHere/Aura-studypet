// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PetActionPreviewPanel } from "./PetActionPreviewWindow";

const apiMock = vi.hoisted(() => ({
  getPetPreferences: vi.fn(),
  getPetProfiles: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: apiMock,
  petAssetUrl: (path: string) => `asset://${path}`,
}));

vi.mock("./PetSpriteRenderer", () => ({
  PetSpriteRenderer: ({ animation, petName }: { animation: string; petName: string }) => (
    <div aria-label={petName} data-animation={animation} role="img" />
  ),
}));

const preferences = {
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

describe("PetActionPreviewPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getPetPreferences.mockResolvedValue(preferences);
    apiMock.getPetProfiles.mockResolvedValue([xinhuaProfile]);
  });

  afterEach(() => cleanup());

  it("loads the active pet and previews idle by default", async () => {
    render(<PetActionPreviewPanel />);

    expect(await screen.findByText("心华")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Aura" })).toHaveAttribute("data-animation", "idle");
    expect(screen.getByRole("button", { name: /待机/ })).toHaveClass("pet-preview-action-active");
  });

  it("switches the preview animation when an action is clicked", async () => {
    render(<PetActionPreviewPanel />);

    await screen.findByRole("img", { name: "Aura" });
    fireEvent.click(screen.getByRole("button", { name: /跳跃/ }));

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Aura" })).toHaveAttribute("data-animation", "jump"),
    );
    expect(screen.getByRole("button", { name: /跳跃/ })).toHaveClass("pet-preview-action-active");
  });

  it("remounts the sprite when the same action is clicked again", async () => {
    render(<PetActionPreviewPanel />);

    const firstSprite = await screen.findByRole("img", { name: "Aura" });
    fireEvent.click(screen.getByRole("button", { name: /待机/ }));

    await waitFor(() => expect(screen.getByRole("img", { name: "Aura" })).not.toBe(firstSprite));
    expect(screen.getByRole("img", { name: "Aura" })).toHaveAttribute("data-animation", "idle");
  });

  it("reloads the active pet whenever the inline preview is mounted", async () => {
    const first = render(<PetActionPreviewPanel />);

    expect(await screen.findByText("心华")).toBeInTheDocument();
    first.unmount();

    apiMock.getPetPreferences.mockResolvedValueOnce({
      ...preferences,
      pet_name: "Elaina",
      active_pet_id: "elaina-2",
    });
    apiMock.getPetProfiles.mockResolvedValueOnce([xinhuaProfile, elainaProfile]);

    render(<PetActionPreviewPanel />);

    expect(await screen.findByText("Elaina")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Elaina" })).toHaveAttribute("data-animation", "idle");
  });

  it("shows an empty state when there is no imported pet", async () => {
    apiMock.getPetProfiles.mockResolvedValue([]);
    render(<PetActionPreviewPanel />);

    expect(await screen.findByText("还没有可预览的桌宠")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Aura" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /跳跃/ })).toBeDisabled();
  });
});
