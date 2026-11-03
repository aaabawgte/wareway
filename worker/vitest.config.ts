import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const directory = path.dirname(fileURLToPath(import.meta.url));
const testApiToken = "test-token-at-least-16-characters";
process.env.API_TOKEN = testApiToken;

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: path.join(directory, "wrangler.jsonc") },
      miniflare: {
        bindings: {
          API_TOKEN: testApiToken,
          TEST_MIGRATIONS: await readD1Migrations(path.join(directory, "migrations"))
        }
      }
    }))
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"]
  }
});

