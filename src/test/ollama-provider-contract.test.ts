import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("Ollama AI provider contract", () => {
  it("adds Ollama as an image extraction provider without hardcoded secrets", () => {
    const page = read("src/pages/settings/AiKeysSettingsPage.tsx");
    expect(page).toContain("Ollama Vision");
    expect(page).toContain("Use for Image Data Extraction");
    expect(page).toContain("connectionType");
    expect(page).not.toContain("Ollama API Key =");
  });

  it("routes Ollama through Edge Functions and keeps text provider separate", () => {
    const save = read("supabase/functions/save-ai-provider/index.ts");
    const status = read("supabase/functions/ai-provider-status/index.ts");
    const extract = read("supabase/functions/ai-extract-data/index.ts");

    expect(save).toContain('"ollama"');
    expect(save).toContain("use_for_image_extraction");
    expect(save).toContain("provider !== \"ollama\"");
    expect(status).toContain("activeImageExtractionProvider");
    expect(extract).toContain("provider: \"ollama\"");
    expect(extract).toContain("Do not diagnose damage");
  });
});
