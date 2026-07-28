import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    if (key === "--keep-data") {
      result.set(key, true);
      continue;
    }
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    result.set(key, value);
  }
  return result;
}

function adb(args, { allowFailure = false, timeout = 60_000 } = {}) {
  const result = spawnSync("adb", args, { encoding: "utf8", timeout });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`adb ${args.join(" ")} failed${output ? `:\n${output}` : ""}`);
  }
  return output;
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function assertSingleDevice() {
  const devices = adb(["devices"])
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => /\tdevice$/.test(line));
  if (devices.length !== 1) {
    throw new Error(`Expected exactly one ready Android device, found ${devices.length}`);
  }
}

function launch(component) {
  const output = adb(["shell", "am", "start", "-W", "-n", component]);
  if (!output.includes("Status: ok")) throw new Error(`Activity did not start successfully:\n${output}`);
  sleep(3_000);
}

function assertHealthy(packageName, stage) {
  if (!adb(["shell", "pidof", packageName], { allowFailure: true })) {
    throw new Error(`${stage}: ${packageName} is not running`);
  }
  const logs = adb(["logcat", "-d", "-v", "brief"]);
  if (logs.includes(`Process: ${packageName}`) || logs.includes(`ANR in ${packageName}`)) {
    throw new Error(`${stage}: crash or ANR found in logcat`);
  }
}

function dumpUi() {
  for (let attempt = 0; attempt < 3; attempt++) {
    adb(["shell", "uiautomator", "dump", "/sdcard/crossgram-window.xml"], { allowFailure: true });
    const xml = adb(["shell", "cat", "/sdcard/crossgram-window.xml"], { allowFailure: true });
    if (xml.includes("<hierarchy")) return xml;
    sleep(1_000);
  }
  throw new Error("Could not dump the Android UI hierarchy");
}

const options = parseArgs(process.argv.slice(2));
const packageName = options.get("--package");
const activity = options.get("--activity") ?? "org.telegram.ui.LaunchActivity";
const apk = options.get("--apk");
const expectedText = options.get("--expected-text") ?? "Start Messaging";

if (!packageName) {
  throw new Error("Usage: yarn e2e:android --package <id> [--apk <file>] [--activity <class>] [--expected-text <text>] [--keep-data]");
}

assertSingleDevice();
if (apk) adb(["install", "-r", apk], { timeout: 180_000 });
if (!options.has("--keep-data")) adb(["shell", "pm", "clear", packageName]);

const component = `${packageName}/${activity}`;
adb(["logcat", "-c"]);

try {
  launch(component);
  assertHealthy(packageName, "cold launch");
  const xml = dumpUi();
  if (!xml.includes(expectedText)) {
    throw new Error(`cold launch: UI does not contain expected text ${JSON.stringify(expectedText)}`);
  }

  adb(["shell", "input", "keyevent", "KEYCODE_HOME"]);
  sleep(1_000);
  launch(component);
  assertHealthy(packageName, "background restore");

  adb(["shell", "settings", "put", "system", "accelerometer_rotation", "0"]);
  adb(["shell", "settings", "put", "system", "user_rotation", "1"]);
  sleep(2_000);
  assertHealthy(packageName, "landscape rotation");
  adb(["shell", "settings", "put", "system", "user_rotation", "0"]);

  adb(["shell", "cmd", "connectivity", "airplane-mode", "enable"]);
  adb(["shell", "am", "force-stop", packageName]);
  launch(component);
  assertHealthy(packageName, "offline cold launch");
} finally {
  adb(["shell", "cmd", "connectivity", "airplane-mode", "disable"], { allowFailure: true });
  adb(["shell", "settings", "put", "system", "user_rotation", "0"], { allowFailure: true });
}

console.log(`Android smoke E2E passed for ${packageName}`);
