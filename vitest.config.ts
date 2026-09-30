import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Many suites compile and run Java or spawn bash; on Windows each launch
    // costs about a second, so the 5s default trips whenever suites overlap.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
