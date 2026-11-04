import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { _electron } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 8703;
const FROM = "0.1.900";
const TO = "0.1.901";
const BUNDLE_ID = "ch.inset.prototype.windowlinks";
const SHIPIT_JOB = `${BUNDLE_ID}.ShipIt`;

/** A name of its own, so the app Squirrel relaunches without the harness's env keeps its own data. */
const TEST_NAME = "Inset Window Links Update Test";

const HOME = homedir();

const TEST_DIR = path.join(
  HOME,
  "Library/Caches/inset-update-test/inset-window-links"
);

const INSTALL_DIR = path.join(TEST_DIR, "installed");
const INSTALLED = path.join(INSTALL_DIR, "Inset Window Links.app");

const INSTALLED_EXE = path.join(INSTALLED, "Contents/MacOS/Inset Window Links");

const LOG_DIR = path.join(HOME, "Library/Logs", TEST_NAME);
const SHIPIT_DIR = path.join(HOME, "Library/Caches", SHIPIT_JOB);

/** State this run can create outside TEST_DIR. Only what was absent before the run is removed. */
const SIDE_EFFECTS = [
  LOG_DIR,
  SHIPIT_DIR,
  path.join(HOME, "Library/Caches/inset-window-links-updater"),
  path.join(HOME, "Library/Application Support", TEST_NAME),
];

const run = (command: string, args: string[]) =>
  execFileSync(command, args, { cwd: ROOT, encoding: "utf-8" });

const build = (version: string) => {
  const output = path.join(TEST_DIR, `build-${version}`);

  execFileSync(
    "pnpm",
    [
      "exec",
      "electron-builder",
      "--mac",
      "zip",
      "--arm64",
      "--publish",
      "never",
      `-c.extraMetadata.version=${version}`,
      `-c.extraMetadata.productName=${TEST_NAME}`,
      `-c.directories.output=${output}`,
    ],
    { cwd: ROOT, stdio: "inherit" }
  );

  return output;
};

const bundleVersion = () =>
  run("/usr/libexec/PlistBuddy", [
    "-c",
    "Print CFBundleShortVersionString",
    path.join(INSTALLED, "Contents/Info.plist"),
  ]).trim();

const requirement = () =>
  execFileSync("codesign", ["-dr", "-", INSTALLED], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const installedPids = () => {
  try {
    return run("pgrep", ["-f", INSTALLED_EXE])
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
};

const shipItJob = () => run("launchctl", ["list"]).includes(SHIPIT_JOB);

const waitFor = async <T>(
  read: () => Promise<T> | T,
  done: (value: T) => boolean,
  deadline: number
): Promise<T> => {
  const value = await read();

  if (done(value) || Date.now() >= deadline) {
    return value;
  }

  await sleep(250);

  return waitFor(read, done, deadline);
};

const results: [string, boolean, string][] = [];

const record = (name: string, ok: boolean, observed: string) => {
  results.push([name, ok, observed]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${observed}`);
};

const requests: string[] = [];

const server = createServer((request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://127.0.0.1");

  const file = path.join(
    TEST_DIR,
    `build-${TO}`,
    path.basename(decodeURIComponent(pathname))
  );

  const found = existsSync(file);

  requests.push(`${request.method} ${request.url} ${found ? 200 : 404}`);
  console.log(`server: ${requests.at(-1)}`);
  response.writeHead(found ? 200 : 404).end(found ? readFileSync(file) : "");
});

const printFile = async (file: string) => {
  if (existsSync(file)) {
    console.log(`--- ${file}\n${await readFile(file, "utf-8")}`);
  }
};

const existedBefore = new Set(SIDE_EFFECTS.filter((dir) => existsSync(dir)));
const shipItJobBefore = shipItJob();

try {
  if (installedPids().length > 0) {
    throw new Error(`An app from ${INSTALLED} is already running.`);
  }

  await rm(TEST_DIR, { force: true, recursive: true });
  await mkdir(INSTALL_DIR, { recursive: true });
  run("pnpm", ["build"]);

  const fromDir = build(FROM);
  const toDir = build(TO);

  run("ditto", [
    "-x",
    "-k",
    path.join(fromDir, `inset-window-links-${FROM}-mac-arm64.zip`),
    INSTALL_DIR,
  ]);

  const requirementBefore = requirement();
  const versionBefore = bundleVersion();

  await printFile(path.join(toDir, "latest-mac.yml"));
  console.log(`before: CFBundleShortVersionString=${versionBefore}`);
  console.log(`before: ${requirementBefore}`);

  server.listen(PORT, "127.0.0.1");
  await once(server, "listening");

  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => key !== "ELECTRON_RUN_AS_NODE"
    )
  );

  const launched = await _electron.launch({
    args: [],
    env: {
      ...env,
      INSET_E2E: "1",
      INSET_E2E_USER_DATA: path.join(TEST_DIR, "user-data"),
      INSET_UPDATE_FEED_URL: `http://127.0.0.1:${PORT}`,
    },
    executablePath: INSTALLED_EXE,
  });

  await waitFor(
    () => launched.evaluate(() => "__insetE2E" in globalThis),
    Boolean,
    Date.now() + 30_000
  );

  const seen: string[] = [];

  const settled = await waitFor(
    async () => {
      const state = await launched.evaluate(() =>
        globalThis.__insetE2E.updateState()
      );

      if (seen.at(-1) !== state.kind) {
        seen.push(state.kind);
      }

      return state;
    },
    (state) => state.kind === "ready" || state.kind === "error",
    Date.now() + 180_000
  );

  record(
    "the running app downloads the newer build",
    settled.kind === "ready" && settled.version === TO,
    `${seen.join(" -> ")} ${JSON.stringify(settled)}`
  );

  const oldPid = await launched.evaluate(() => process.pid);
  const closed = launched.waitForEvent("close", { timeout: 60_000 });

  await launched.evaluate(() => globalThis.__insetE2E.restartToUpdate());
  await closed;

  const relaunched = await waitFor(
    () => installedPids().filter((pid) => pid !== String(oldPid)),
    (pids) => pids.length > 0,
    Date.now() + 90_000
  );

  record(
    "Restart to Update relaunches the app",
    relaunched.length > 0,
    `old pid ${oldPid}, new pids ${relaunched.join(",") || "none"}`
  );

  const versionAfter = await waitFor(
    bundleVersion,
    (version) => version === TO,
    Date.now() + 10_000
  );

  record(
    "the installed bundle is the new version",
    versionBefore === FROM && versionAfter === TO,
    `CFBundleShortVersionString ${versionBefore} -> ${versionAfter}`
  );

  const requirementAfter = requirement();

  console.log(`after: ${requirementAfter}`);
  record(
    "the designated requirement is unchanged",
    requirementAfter === requirementBefore,
    requirementAfter
  );
  record(
    "the feed served latest-mac.yml and the zip",
    requests.some(
      (line) => line.startsWith("GET /latest-mac.yml") && line.endsWith(" 200")
    ) &&
      requests.some(
        (line) => line.includes(`${TO}-mac-arm64.zip`) && line.endsWith(" 200")
      ),
    requests.join(" | ")
  );

  const logs = existsSync(LOG_DIR) ? await readdir(LOG_DIR) : [];

  await Promise.all(logs.map((name) => printFile(path.join(LOG_DIR, name))));
  await printFile(path.join(SHIPIT_DIR, "ShipIt_stderr.log"));
} finally {
  // Kills by bundle path rather than close(), which waits on a quit the app may still hold up.
  for (const pid of installedPids()) {
    process.kill(Number(pid), "SIGKILL");
  }

  server.close();

  if (!shipItJobBefore && shipItJob()) {
    run("launchctl", ["remove", SHIPIT_JOB]);
  }

  await Promise.all(
    [
      TEST_DIR,
      ...SIDE_EFFECTS.filter((entry) => !existedBefore.has(entry)),
    ].map((dir) => rm(dir, { force: true, recursive: true }))
  );
}

const failed = results.filter(([, ok]) => !ok);

console.log(
  `${results.length - failed.length}/${results.length} checks passed`
);

process.exitCode = failed.length === 0 && results.length === 5 ? 0 : 1;
