import { describe, expect, it } from "vitest";
import { createIngestPayload, createSocketLineAuthorizer } from "./ingest-protocol.js";

describe("createIngestPayload", () => {
  it("sends an auth line before tokens when a secret is configured", () => {
    expect(createIngestPayload(42, "secret-token")).toBe("auth:secret-token\ntokens:42\n");
  });

  it("sends only the token line when no secret is configured", () => {
    expect(createIngestPayload(42, null)).toBe("tokens:42\n");
  });
});

describe("createSocketLineAuthorizer", () => {
  it("rejects token lines until the client authenticates", () => {
    const authorize = createSocketLineAuthorizer("secret-token");

    expect(authorize("tokens:42")).toEqual({ type: "reject" });
  });

  it("accepts token lines after a matching auth line", () => {
    const authorize = createSocketLineAuthorizer("secret-token");

    expect(authorize("auth:secret-token")).toEqual({ type: "authorized" });
    expect(authorize("tokens:42")).toEqual({ type: "data", line: "tokens:42" });
  });

  it("allows direct token lines when auth is disabled", () => {
    const authorize = createSocketLineAuthorizer(null);

    expect(authorize("tokens:42")).toEqual({ type: "data", line: "tokens:42" });
  });
});
