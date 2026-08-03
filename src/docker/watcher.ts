import type { Reconciler } from "../core/reconciler";
import type { DockerClient } from "./client";

const EVENT_STREAM_RETRY_MS = 5_000;

/**
 * Drives the reconcile loop: once at startup, on every container
 * lifecycle event, and on a periodic resync as a safety net.
 */
export class Watcher {
  private timer?: ReturnType<typeof setInterval>;
  private abort = new AbortController();

  constructor(
    private docker: DockerClient,
    private reconciler: Reconciler,
    private resyncSeconds: number,
    private retryMs = EVENT_STREAM_RETRY_MS,
  ) {}

  async start(): Promise<void> {
    await this.reconciler.reconcile();

    this.timer = setInterval(() => {
      void this.reconciler.reconcile();
    }, this.resyncSeconds * 1000);

    void this.watchEvents();
  }

  stop(): void {
    this.abort.abort();
    clearInterval(this.timer);
  }

  private async watchEvents(): Promise<void> {
    let catchUp = false;
    while (!this.abort.signal.aborted) {
      try {
        if (catchUp) {
          catchUp = false;
          await this.reconciler.reconcile();
        }
        for await (const _ of this.docker.containerEvents(this.abort.signal)) {
          await this.reconciler.reconcile();
        }
      } catch (err) {
        if (this.abort.signal.aborted) return;
        catchUp = true;
        // Bun's fetch aborts response streams after ~5 idle minutes and the
        // Docker events endpoint is silent while nothing changes, so a
        // TimeoutError is routine: resubscribe right away without logging.
        if (err instanceof Error && err.name === "TimeoutError") continue;
        const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        console.error(`[watcher] event stream lost, retrying in ${this.retryMs}ms: ${detail}`);
        await Bun.sleep(this.retryMs);
      }
    }
  }
}
