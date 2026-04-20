import { timingSafeEqual } from "node:crypto";

const AUTH_PREFIX = "auth:";

export type SocketLineAuthorizerEvent =
  | { type: "ignore" }
  | { type: "authorized" }
  | { type: "data"; line: string }
  | { type: "reject" };

function secureEquals(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(aa, bb);
}

export function createIngestPayload(tokens: number, secret: string | null | undefined): string {
  if (!Number.isFinite(tokens) || !Number.isInteger(tokens) || tokens <= 0) {
    throw new Error(`tokens must be a positive integer, got: ${tokens}`);
  }
  const lines: string[] = [];
  if (secret) {
    lines.push(`${AUTH_PREFIX}${secret}`);
  }
  lines.push(`tokens:${tokens}`);
  return `${lines.join("\n")}\n`;
}

export function createSocketLineAuthorizer(
  secret: string | null | undefined,
): (rawLine: string) => SocketLineAuthorizerEvent {
  const expectedAuthLine = secret ? `${AUTH_PREFIX}${secret}` : null;
  let authorized = expectedAuthLine === null;

  return (rawLine: string): SocketLineAuthorizerEvent => {
    const line = rawLine.trim();
    if (!line) {
      return { type: "ignore" };
    }
    if (!authorized && expectedAuthLine !== null) {
      if (secureEquals(line, expectedAuthLine)) {
        authorized = true;
        return { type: "authorized" };
      }
      return { type: "reject" };
    }
    return { type: "data", line };
  };
}
