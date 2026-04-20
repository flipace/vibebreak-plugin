import { describe, expect, it } from "vitest";
import { buildWsRequest } from "./ws.js";

describe("buildWsRequest", () => {
  it("passes the token via query string AND authorization header", () => {
    // The API reads `?token=` at upgrade time. The header is a belt-and-
    // braces fallback for proxies that log the upgrade URL only.
    expect(buildWsRequest("wss://api.vibebreak.app/", "jwt-token")).toEqual({
      url: "wss://api.vibebreak.app/v1/ws?token=jwt-token",
      headers: {
        authorization: "Bearer jwt-token",
      },
    });
  });

  it("preserves an existing base path while appending the websocket route", () => {
    expect(buildWsRequest("wss://api.vibebreak.app/socket", "jwt-token")).toEqual({
      url: "wss://api.vibebreak.app/socket/v1/ws?token=jwt-token",
      headers: {
        authorization: "Bearer jwt-token",
      },
    });
  });
});
