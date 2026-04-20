import { describe, expect, it } from "vitest";
import { buildWsRequest } from "./ws.js";

describe("buildWsRequest", () => {
  it("uses an authorization header instead of a query-string token", () => {
    expect(buildWsRequest("wss://api.vibebreak.app/", "jwt-token")).toEqual({
      url: "wss://api.vibebreak.app/v1/ws",
      headers: {
        authorization: "Bearer jwt-token",
      },
    });
  });

  it("preserves an existing base path while appending the websocket route", () => {
    expect(buildWsRequest("wss://api.vibebreak.app/socket", "jwt-token")).toEqual({
      url: "wss://api.vibebreak.app/socket/v1/ws",
      headers: {
        authorization: "Bearer jwt-token",
      },
    });
  });
});
