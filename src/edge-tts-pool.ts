// LexiRead · © 2026 LSJKANA · AGPL-3.0
/**
 * Persistent-connection Edge TTS client.
 *
 * The `node-edge-tts` package opens a brand-new WebSocket for every request,
 * which costs ~1.2s of TLS/handshake overhead — for a 10-character word the
 * total was ~1.8s, almost all of it connection setup.
 *
 * This keeps one WebSocket alive and pipelines requests over it, which brings
 * a single word down to ~0.5s. Requests are serialised (reading aloud never
 * needs concurrency), the socket is closed when idle, and any failure resets
 * the connection so the next caller gets a fresh one.
 */
import WebSocket from "ws";
import { randomBytes } from "node:crypto";
// The DRM helpers live inside the package; reusing them keeps the signature
// algorithm in one place (Microsoft rotates it periodically).
import {
  TRUSTED_CLIENT_TOKEN,
  CHROMIUM_FULL_VERSION,
  generateSecMsGecToken,
} from "node-edge-tts/dist/drm";

const WS_HOST = "speech.platform.bing.com";
const AUDIO_SEPARATOR = Buffer.from("Path:audio\r\n");
/** Close the socket after this much idle time; reconnecting is cheap enough. */
const IDLE_CLOSE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** Small settle delay so trailing audio chunks arrive before we resolve. */
const TAIL_SETTLE_MS = 120;

export interface SynthesisRequest {
  text: string;
  voice: string;
  lang: string;
  format: string;
  /** Edge prosody value: "default" or "+10%"/"-10%". */
  rate: string;
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface Job {
  request: SynthesisRequest;
  resolve: (audio: Buffer) => void;
  reject: (error: Error) => void;
}

export class EdgeTtsPool {
  private socket: WebSocket | null = null;
  private connecting: Promise<WebSocket> | null = null;
  private queue: Job[] = [];
  private active: Job | null = null;
  private chunks: Buffer[] = [];
  private settleTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private requestTimer: NodeJS.Timeout | null = null;

  /** Synthesises one utterance, reusing the live connection when possible. */
  synthesize(request: SynthesisRequest): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      void this.pump();
    });
  }

  /** Closes the socket; safe to call on shutdown. */
  dispose() {
    this.clearIdleTimer();
    this.teardownSocket();
    const pending = this.queue.splice(0);
    for (const job of pending) job.reject(new Error("TTS 服务已关闭"));
    if (this.active) {
      this.active.reject(new Error("TTS 服务已关闭"));
      this.active = null;
    }
  }

  // ---- internals ----------------------------------------------------------

  private async pump() {
    if (this.active || !this.queue.length) return;
    const job = this.queue.shift();
    if (!job) return;
    this.active = job;

    try {
      const socket = await this.ensureSocket();
      this.chunks = [];
      this.sendRequest(socket, job.request);

      this.requestTimer = setTimeout(() => {
        this.finishActive(new Error("语音合成超时"));
        // A hung request usually means the socket is unusable.
        this.teardownSocket();
      }, REQUEST_TIMEOUT_MS);
    } catch (err: any) {
      this.finishActive(new Error(err?.message || "连接语音服务失败"));
    }
  }

  private ensureSocket(): Promise<WebSocket> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.socket);
    }
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<WebSocket>((resolve, reject) => {
      const url =
        `wss://${WS_HOST}/consumer/speech/synthesize/readaloud/edge/v1` +
        `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
        `&Sec-MS-GEC=${generateSecMsGecToken()}` +
        `&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`;

      const socket = new WebSocket(url, {
        host: WS_HOST,
        origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        headers: {
          Pragma: "no-cache",
          "Cache-Control": "no-cache",
          "User-Agent":
            `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
            `(KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION.split(".")[0]}.0.0.0 ` +
            `Safari/537.36 Edg/${CHROMIUM_FULL_VERSION.split(".")[0]}.0.0.0`,
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      let settled = false;
      const failConnect = (err: Error) => {
        if (settled) return;
        settled = true;
        this.connecting = null;
        this.socket = null;
        try {
          socket.close();
        } catch {
          /* already closing */
        }
        reject(err);
      };

      socket.on("open", () => {
        if (settled) return;
        settled = true;
        this.connecting = null;
        this.socket = socket;
        socket.send(
          "Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" +
            JSON.stringify({
              context: {
                synthesis: {
                  audio: {
                    metadataoptions: {
                      sentenceBoundaryEnabled: "false",
                      wordBoundaryEnabled: "false",
                    },
                    outputFormat: this.active?.request.format || "audio-24khz-48kbitrate-mono-mp3",
                  },
                },
              },
            })
        );
        resolve(socket);
      });

      socket.on("message", (data: Buffer, isBinary: boolean) => this.onMessage(data, isBinary));
      socket.on("error", (err: Error) => {
        if (!settled) failConnect(err);
        else this.handleSocketLoss(err);
      });
      socket.on("close", () => this.handleSocketLoss(new Error("连接已关闭")));
    });

    return this.connecting;
  }

  private onMessage(data: Buffer, isBinary: boolean) {
    if (isBinary) {
      const index = data.indexOf(AUDIO_SEPARATOR);
      // Some frames carry only metadata; only keep real audio payloads.
      if (index !== -1) this.chunks.push(Buffer.from(data.subarray(index + AUDIO_SEPARATOR.length)));
      return;
    }

    if (data.toString().includes("Path:turn.end")) {
      // Trailing audio can arrive just after turn.end — settle briefly first.
      if (this.settleTimer) clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => {
        const audio = Buffer.concat(this.chunks);
        this.chunks = [];
        if (!audio.length) this.finishActive(new Error("合成结果为空"));
        else this.finishActive(null, audio);
      }, TAIL_SETTLE_MS);
    }
  }

  private sendRequest(socket: WebSocket, request: SynthesisRequest) {
    const requestId = randomBytes(16).toString("hex");
    socket.send(
      `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n` +
        `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
        `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${request.lang}">` +
        `<voice name="${request.voice}">` +
        `<prosody rate="${request.rate}" pitch="default" volume="default">` +
        `${escapeXml(request.text)}</prosody></voice></speak>`
    );
  }

  private finishActive(error: Error | null, audio?: Buffer) {
    if (this.requestTimer) {
      clearTimeout(this.requestTimer);
      this.requestTimer = null;
    }
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    const job = this.active;
    this.active = null;
    if (job) {
      if (error) job.reject(error);
      else job.resolve(audio || Buffer.alloc(0));
    }
    if (this.socket && this.socket.readyState === WebSocket.OPEN) this.scheduleIdleClose();
    void this.pump();
  }

  private handleSocketLoss(err: Error) {
    this.teardownSocket();
    if (this.active) this.finishActive(err);
  }

  private teardownSocket() {
    const socket = this.socket;
    this.socket = null;
    this.connecting = null;
    if (socket) {
      socket.removeAllListeners("message");
      socket.removeAllListeners("close");
      socket.removeAllListeners("error");
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    }
  }

  private scheduleIdleClose() {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      // Only drop the socket when nothing is in flight; otherwise the next
      // request would pay the handshake again for no reason.
      if (!this.active && !this.queue.length) this.teardownSocket();
    }, IDLE_CLOSE_MS);
  }

  private clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

/** Process-wide instance: one warm socket shared by every request. */
export const edgeTtsPool = new EdgeTtsPool();
