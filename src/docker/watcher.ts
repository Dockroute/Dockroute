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
    while (!this.abort.signal.aborted) {
      try {
        for await (const _ of this.docker.containerEvents(this.abort.signal)) {
          await this.reconciler.reconcile();
        }
      } catch (err) {
        if (this.abort.signal.aborted) return;
        console.error(`[watcher] event stream lost, retrying in ${EVENT_STREAM_RETRY_MS}ms:`, err);
        await Bun.sleep(EVENT_STREAM_RETRY_MS);
      }
    }
  }
}
