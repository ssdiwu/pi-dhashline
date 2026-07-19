import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("package contract", () => {
  it("has no runtime dependencies and exposes the extension entry", async () => {
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as Record<string, unknown>;
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.pi).toEqual({ extensions: ["./index.ts"] });
    expect(manifest.engines).toEqual({ node: ">=22.19.0" });
    expect(manifest.peerDependencies).toMatchObject({
      "@earendil-works/pi-coding-agent": "^0.80.10",
      "@earendil-works/pi-tui": "^0.80.10",
      typebox: "^1.1.38",
    });
  });
});
