import { describe, expect, test } from "bun:test";
import type { SearchBackend } from "./backend.ts";
import { pickResolution } from "./websearch.ts";

const backend = { id: "test" } as SearchBackend;

describe("websearch model selection", () => {
  test("prefers locked, active, then fallback models", () => {
    const resolutions = [
      { backend, providerID: "openai", fallbackModel: "fallback" },
      { backend, providerID: "other", lockedModel: "locked" },
    ];

    expect(pickResolution(resolutions, { providerID: "openai", modelID: "active" })?.model).toBe("locked");
    delete resolutions[1]!.lockedModel;
    expect(pickResolution(resolutions, { providerID: "openai", modelID: "active" })?.model).toBe("active");
    expect(pickResolution(resolutions, { providerID: "unsupported", modelID: "active" })?.model).toBe("fallback");
  });

  test("returns no selection without a supported active or configured model", () => {
    expect(pickResolution([{ backend, providerID: "openai" }], { providerID: "other", modelID: "model" })).toBeUndefined();
  });
});
