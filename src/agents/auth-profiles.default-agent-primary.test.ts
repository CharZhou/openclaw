import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../config/config.js";
import { resolveAuthStorePath } from "./auth-profiles/paths.js";
import {
  clearRuntimeAuthProfileStoreSnapshots,
  ensureAuthProfileStore,
} from "./auth-profiles/store.js";

vi.mock("./auth-profiles/external-auth.js", () => ({
  overlayExternalAuthProfiles: <T>(store: T) => store,
  shouldPersistExternalAuthProfile: () => true,
}));

vi.mock("./auth-profiles/external-cli-sync.js", () => ({
  syncExternalCliCredentials: () => false,
}));

describe("auth-profiles default-agent primary store", () => {
  const originalEnv = { ...process.env };

  afterEach(async () => {
    clearRuntimeAuthProfileStoreSnapshots();
    clearRuntimeConfigSnapshot();
    clearConfigCache();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("inherits auth from the configured default agent instead of hardcoded main", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-auth-default-"));
    const defaultAgentDir = path.join(stateDir, "agents", "default", "agent");
    const workerAgentDir = path.join(stateDir, "agents", "worker", "agent");
    const mainAgentDir = path.join(stateDir, "agents", "main", "agent");

    try {
      await fs.mkdir(defaultAgentDir, { recursive: true });
      await fs.mkdir(workerAgentDir, { recursive: true });
      await fs.mkdir(mainAgentDir, { recursive: true });

      await fs.writeFile(
        path.join(stateDir, "openclaw.json"),
        JSON.stringify({
          agents: {
            list: [{ id: "default", default: true }, { id: "worker" }],
          },
        }),
        "utf8",
      );

      await fs.writeFile(
        resolveAuthStorePath(defaultAgentDir),
        JSON.stringify({
          version: 1,
          profiles: {
            "sub2api-openai:default": {
              type: "api_key",
              provider: "sub2api-openai",
              key: "sk-sub2api-default",
            },
          },
        }),
        "utf8",
      );

      await fs.writeFile(
        resolveAuthStorePath(mainAgentDir),
        JSON.stringify({
          version: 1,
          profiles: {
            "google:default": {
              type: "api_key",
              provider: "google",
              key: "google-main-only",
            },
          },
        }),
        "utf8",
      );

      process.env.OPENCLAW_STATE_DIR = stateDir;
      delete process.env.OPENCLAW_AGENT_DIR;
      delete process.env.PI_CODING_AGENT_DIR;

      clearRuntimeAuthProfileStoreSnapshots();
      clearRuntimeConfigSnapshot();
      clearConfigCache();

      const store = ensureAuthProfileStore(workerAgentDir);

      expect(store.profiles["sub2api-openai:default"]).toMatchObject({
        provider: "sub2api-openai",
        key: "sk-sub2api-default",
      });
      expect(store.profiles["google:default"]).toBeUndefined();

      const inheritedWorkerStore = JSON.parse(
        await fs.readFile(resolveAuthStorePath(workerAgentDir), "utf8"),
      ) as {
        profiles: Record<string, unknown>;
      };
      expect(inheritedWorkerStore.profiles["sub2api-openai:default"]).toBeDefined();
      expect(inheritedWorkerStore.profiles["google:default"]).toBeUndefined();
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
