// Vendored subset of @vibebreak/shared — only the constants + zod schemas
// that this plugin actually uses. Keeps the plugin standalone (no
// monorepo workspace dep).
//
// When the API's wire format changes, update this file + bump the plugin
// version. Everything here MUST stay byte-for-byte identical to the API's
// contract or the plugin will reject valid responses.

import { z } from "zod";

// ── Constants ────────────────────────────────────────────────────────────
export const TOKEN_THRESHOLD_DEFAULT = 250_000;
export const IDLE_PAUSE_MS = 2 * 60 * 1000;
export const PAIR_CODE_LENGTH = 10;

export const EXERCISES = ["push_up", "squat", "jumping_jack", "plank", "breathing"] as const;
export type ExerciseKind = (typeof EXERCISES)[number];

export const EXERCISE_DEFAULT_TARGET: Record<ExerciseKind, number> = {
  push_up: 10,
  squat: 15,
  jumping_jack: 30,
  plank: 30,
  breathing: 60,
};

// ── Gate ─────────────────────────────────────────────────────────────────
export const ExerciseKindSchema = z.enum(EXERCISES);

export const GateCreateInputSchema = z.object({
  thresholdTokens: z.number().int().positive(),
  sessionId: z.string().uuid().optional(),
});
export type GateCreateInput = z.infer<typeof GateCreateInputSchema>;

export const GateResponseSchema = z.object({
  id: z.string().uuid(),
  exerciseKind: ExerciseKindSchema,
  repsTarget: z.number().int().positive(),
  triggeredAt: z.string().datetime(),
  thresholdTokens: z.number().int().nonnegative(),
});
export type GateResponse = z.infer<typeof GateResponseSchema>;

// ── Pair ─────────────────────────────────────────────────────────────────
export const PairInitInputSchema = z.object({
  label: z.string().min(1).max(80),
  platform: z.string().min(1).max(40),
  pluginVersion: z.string().min(1).max(20),
});
export type PairInitInput = z.infer<typeof PairInitInputSchema>;

export const PairInitResponseSchema = z.object({
  deviceId: z.string().uuid(),
  pairCode: z.string().length(PAIR_CODE_LENGTH),
  expiresAt: z.string().datetime(),
});
export type PairInitResponse = z.infer<typeof PairInitResponseSchema>;

export const PairStatusResponseSchema = z.object({
  status: z.enum(["pending", "completed", "expired"]),
  deviceJwt: z.string().min(1).nullable(),
});
export type PairStatusResponse = z.infer<typeof PairStatusResponseSchema>;

// ── Meter ────────────────────────────────────────────────────────────────
export const MeterHeartbeatInputSchema = z.object({
  current: z.number().int().nonnegative(),
  threshold: z.number().int().positive(),
});
export type MeterHeartbeatInput = z.infer<typeof MeterHeartbeatInputSchema>;

export const MeterHeartbeatResponseSchema = z.object({
  ok: z.literal(true),
  threshold: z.number().int().positive(),
});
export type MeterHeartbeatResponse = z.infer<typeof MeterHeartbeatResponseSchema>;

// ── Me (user profile) ────────────────────────────────────────────────────
export const MeProfileResponseSchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  thresholdTokens: z.number().int().positive(),
  publicProfile: z.boolean(),
});
export type MeProfileResponse = z.infer<typeof MeProfileResponseSchema>;

// ── WebSocket server → plugin messages ───────────────────────────────────
const WsServerHelloSchema = z.object({
  type: z.literal("hello"),
  deviceId: z.string().uuid(),
});
const WsServerGateUnlockSchema = z.object({
  type: z.literal("gate_unlock"),
  gateId: z.string().uuid(),
});
const WsServerPingSchema = z.object({
  type: z.literal("ping"),
});
export const WsServerMessageSchema = z.discriminatedUnion("type", [
  WsServerHelloSchema,
  WsServerGateUnlockSchema,
  WsServerPingSchema,
]);
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;
