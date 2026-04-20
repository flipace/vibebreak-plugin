import {
  GateResponseSchema,
  MeProfileResponseSchema,
  MeterHeartbeatResponseSchema,
  PairInitResponseSchema,
  PairStatusResponseSchema,
  type GateCreateInput,
  type GateResponse,
  type MeProfileResponse,
  type MeterHeartbeatInput,
  type MeterHeartbeatResponse,
  type PairInitInput,
  type PairInitResponse,
  type PairStatusResponse,
} from "./shared.js";
import type { ZodSchema } from "zod";

export class ApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message?: string) {
    super(message ?? `API error ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export class Api {
  baseUrl: string;
  deviceJwt: string | null;

  constructor(baseUrl: string, deviceJwt: string | null = null) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.deviceJwt = deviceJwt;
  }

  setDeviceJwt(jwt: string | null): void {
    this.deviceJwt = jwt;
  }

  private async request<T>(
    path: string,
    schema: ZodSchema<T>,
    init: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(init.headers);
    if (!headers.has("content-type") && init.body !== undefined && init.body !== null) {
      headers.set("content-type", "application/json");
    }
    if (this.deviceJwt && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${this.deviceJwt}`);
    }
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers });
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new ApiError(0, "", `Network error calling ${url}: ${cause}`);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new ApiError(res.status, text, `${res.status} ${res.statusText} from ${path}`);
    }
    if (text.length === 0) {
      throw new ApiError(res.status, "", `Empty response from ${path}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, text, `Invalid JSON from ${path}`);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      // Almost always means we hit a different service on the same port.
      // Surface a hint so the user knows to check VIBEBREAK_API.
      throw new ApiError(
        res.status,
        text,
        `Unexpected response from ${url}. Is this really the VibeBreak API? ` +
          `(Set VIBEBREAK_API to override the host. First validation issue: ${
            result.error.issues[0]?.message ?? "unknown"
          })`,
      );
    }
    return result.data;
  }

  pairInit(input: PairInitInput): Promise<PairInitResponse> {
    return this.request("/v1/pair/init", PairInitResponseSchema, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  pairStatus(code: string): Promise<PairStatusResponse> {
    const q = new URLSearchParams({ code });
    return this.request(`/v1/pair/status?${q.toString()}`, PairStatusResponseSchema, {
      method: "GET",
    });
  }

  createGate(input: GateCreateInput): Promise<GateResponse> {
    return this.request("/v1/gates", GateResponseSchema, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  meterHeartbeat(input: MeterHeartbeatInput): Promise<MeterHeartbeatResponse> {
    return this.request("/v1/meter/heartbeat", MeterHeartbeatResponseSchema, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  me(): Promise<MeProfileResponse> {
    return this.request("/v1/me", MeProfileResponseSchema, { method: "GET" });
  }
}
