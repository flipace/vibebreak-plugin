import { describe, expect, it } from "vitest";
import { redactConfig, type PluginConfig } from "./config.js";

describe("redactConfig", () => {
  it("hides stored secrets while preserving other fields", () => {
    const cfg: PluginConfig = {
      apiBaseUrl: "https://api.vibebreak.app",
      wsBaseUrl: "wss://api.vibebreak.app",
      deviceJwt: "jwt-secret",
      deviceId: "device-123",
      thresholdTokens: 250_000,
      ingestPort: 4321,
      ingestSecret: "local-secret",
    };

    expect(redactConfig(cfg)).toEqual({
      apiBaseUrl: "https://api.vibebreak.app",
      wsBaseUrl: "wss://api.vibebreak.app",
      deviceJwt: "[redacted]",
      deviceId: "device-123",
      thresholdTokens: 250_000,
      ingestPort: 4321,
      ingestSecret: "[redacted]",
    });
  });

  it("leaves null or absent secrets unchanged", () => {
    const cfg: PluginConfig = {
      apiBaseUrl: "https://api.vibebreak.app",
      wsBaseUrl: "wss://api.vibebreak.app",
      deviceJwt: null,
      deviceId: null,
      thresholdTokens: 250_000,
    };

    expect(redactConfig(cfg)).toEqual(cfg);
  });
});
