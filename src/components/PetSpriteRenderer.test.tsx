// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PetProfile } from "../lib/types";
import { PetSpriteRenderer } from "./PetSpriteRenderer";

vi.mock("../lib/api", () => ({
  petAssetUrl: (path: string) => `asset://${path}`,
}));

const profile: PetProfile = {
  id: "aura",
  display_name: "Aura",
  description: "test",
  spritesheet_path: "fallback.webp",
  sprites: {
    idle: "idle.png",
    happy: "happy.png",
  },
  persona: null,
  sprite_scale: 1,
  theme_color: null,
  default_emotion: "idle",
  bubble_lines: [],
};

const atlasProfile: PetProfile = {
  ...profile,
  spritesheet_path: "atlas.webp",
  sprites: {},
  atlas: {
    columns: 8,
    row_count: 9,
    frame_width: 192,
    frame_height: 208,
    rows: [[0, 1, 2, 3, 4, 5], [], [], [], [], [], [], [], []],
  },
};

describe("PetSpriteRenderer", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("keeps structured sprites ahead of legacy spritesheets", () => {
    render(<PetSpriteRenderer animation="happy" petName="Aura" profile={profile} />);

    const image = screen.getByRole("img", { name: "Aura" });

    expect(image).toHaveStyle({ backgroundImage: 'url("asset://happy.png")' });
    expect(image).not.toHaveStyle({ backgroundImage: 'url("asset://fallback.webp")' });
  });

  it("falls back to idle structured sprite for missing transient animation", () => {
    render(<PetSpriteRenderer animation="dragging" petName="Aura" profile={profile} />);

    expect(screen.getByRole("img", { name: "Aura" })).toHaveStyle({
      backgroundImage: 'url("asset://idle.png")',
    });
  });

  it("animates legacy atlas frames without pixel overflow", async () => {
    vi.useFakeTimers();
    render(<PetSpriteRenderer animation="idle" petName="Aura" profile={atlasProfile} />);

    const image = screen.getByRole("img", { name: "Aura" });

    expect(image).toHaveStyle({ backgroundImage: 'url("asset://atlas.webp")' });
    expect(image).toHaveStyle({ backgroundPosition: "0px 0px" });
    expect(image).toHaveStyle({ backgroundSize: "1536px 1872px" });

    await act(async () => {
      vi.advanceTimersByTime(140);
    });

    expect(image).toHaveStyle({ backgroundPosition: "-192px 0px" });
    expect(image.getAttribute("style")).not.toContain("-1536px");

    await act(async () => {
      vi.advanceTimersByTime(140 * 4);
    });
    expect(image).toHaveStyle({ backgroundPosition: "-960px 0px" });

    await act(async () => {
      vi.advanceTimersByTime(140);
    });
    expect(image).toHaveStyle({ backgroundPosition: "0px 0px" });
    expect(image.getAttribute("style")).not.toContain("-1152px");
  });
});
