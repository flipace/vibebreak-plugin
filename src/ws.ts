import WebSocket from "ws";
import { WsServerMessageSchema, type WsServerMessage } from "./shared.js";
import { log } from "./log.js";

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export type WsEventMap = {
  open: () => void;
  close: () => void;
  hello: (deviceId: string) => void;
  unlock: (gateId: string) => void;
  ping: () => void;
  message: (msg: WsServerMessage) => void;
  error: (err: Error) => void;
};

type Listener<E extends keyof WsEventMap> = WsEventMap[E];

export interface WsClient {
  on<E extends keyof WsEventMap>(event: E, cb: Listener<E>): void;
  off<E extends keyof WsEventMap>(event: E, cb: Listener<E>): void;
  close(): void;
  /** True after close() has been called - reconnect loop will not restart. */
  readonly closed: boolean;
}

function buildUrl(baseUrl: string, deviceJwt: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const sep = trimmed.includes("?") ? "&" : "?";
  return `${trimmed}/v1/ws${sep}token=${encodeURIComponent(deviceJwt)}`;
}

export function connectWs(baseUrl: string, deviceJwt: string): WsClient {
  const url = buildUrl(baseUrl, deviceJwt);
  const listeners: { [E in keyof WsEventMap]: Set<Listener<E>> } = {
    open: new Set(),
    close: new Set(),
    hello: new Set(),
    unlock: new Set(),
    ping: new Set(),
    message: new Set(),
    error: new Set(),
  };

  let ws: WebSocket | null = null;
  let backoff = MIN_BACKOFF_MS;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let closedByUser = false;

  function emit<E extends keyof WsEventMap>(event: E, ...args: Parameters<Listener<E>>): void {
    const set = listeners[event];
    for (const cb of set) {
      try {
        // The any cast keeps the per-event tuple type when forwarding through the generic.
        (cb as (...a: unknown[]) => void)(...(args as unknown[]));
      } catch (err) {
        log.warn(`WS listener for ${event} threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  function scheduleReconnect(): void {
    if (closedByUser) return;
    if (reconnectTimer) return;
    const wait = backoff;
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    log.warn(`WS disconnected. Reconnecting in ${(wait / 1000).toFixed(0)}s...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, wait);
  }

  function open(): void {
    if (closedByUser) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      emit("error", e);
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.on("open", () => {
      backoff = MIN_BACKOFF_MS;
      log.ok(`WS connected to ${baseUrl}`);
      emit("open");
    });

    socket.on("message", (data) => {
      let raw: string;
      if (typeof data === "string") {
        raw = data;
      } else if (Buffer.isBuffer(data)) {
        raw = data.toString("utf8");
      } else if (Array.isArray(data)) {
        raw = Buffer.concat(data).toString("utf8");
      } else {
        raw = Buffer.from(data as ArrayBuffer).toString("utf8");
      }
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        log.warn(`WS got non-JSON frame, ignoring: ${raw.slice(0, 80)}`);
        return;
      }
      const result = WsServerMessageSchema.safeParse(parsedJson);
      if (!result.success) {
        log.warn(`WS got message that failed schema validation: ${result.error.message}`);
        return;
      }
      const msg = result.data;
      emit("message", msg);
      switch (msg.type) {
        case "hello":
          emit("hello", msg.deviceId);
          break;
        case "gate_unlock":
          emit("unlock", msg.gateId);
          break;
        case "ping":
          emit("ping");
          // Best-effort pong - server's WsClientPongSchema accepts {type:"pong"}.
          try {
            socket.send(JSON.stringify({ type: "pong" }));
          } catch {
            // ignore - if send fails the close handler will fire shortly.
          }
          break;
      }
    });

    socket.on("error", (err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      // Surface a short, useful message; the actual reconnect happens via 'close'.
      log.warn(`WS error: ${e.message}`);
      emit("error", e);
    });

    socket.on("close", () => {
      ws = null;
      emit("close");
      scheduleReconnect();
    });
  }

  open();

  return {
    on(event, cb) {
      (listeners[event] as Set<typeof cb>).add(cb);
    },
    off(event, cb) {
      (listeners[event] as Set<typeof cb>).delete(cb);
    },
    close() {
      closedByUser = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }
    },
    get closed(): boolean {
      return closedByUser;
    },
  };
}
