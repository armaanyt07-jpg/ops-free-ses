import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

import { Redis } from "ioredis";

/**
 * Throwaway Redis server for integration tests.
 *
 * A real `redis-server` on a random port, with persistence disabled and its own
 * temp directory. Nothing is mocked: BullMQ ships Lua scripts and relies on
 * blocking reads and atomic semantics, none of which a fake reproduces. The
 * rate limiter is itself a Lua script whose whole purpose is atomicity — a mock
 * would test nothing that matters.
 *
 * Each test file gets its own server, so files cannot interfere with each other
 * and any test may safely flush.
 */
export interface TestRedis {
  url: string;
  port: number;
  client: Redis;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

/** Asks the OS for an unused ephemeral port by briefly binding one. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (typeof address !== "object" || address === null) {
        probe.close();
        reject(new Error("Could not determine a free port"));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForPing(client: Redis, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await client.ping();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

export async function startTestRedis(): Promise<TestRedis> {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "ops-redis-"));

  const proc: ChildProcess = spawn(
    "redis-server",
    [
      "--port",
      String(port),
      "--bind",
      "127.0.0.1",
      "--dir",
      dir,
      // No persistence: this data is disposable and fsync would only slow
      // the suite down.
      "--save",
      "",
      "--appendonly",
      "no",
      "--daemonize",
      "no",
    ],
    { stdio: "ignore" },
  );

  proc.unref();

  const url = `redis://127.0.0.1:${port}`;
  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  });
  client.on("error", () => {
    /* expected while the server is still starting */
  });

  await waitForPing(client);

  return {
    url,
    port,
    client,
    async flush() {
      await client.flushall();
    },
    async stop() {
      await client.quit().catch(() => undefined);
      proc.kill("SIGKILL");
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}
