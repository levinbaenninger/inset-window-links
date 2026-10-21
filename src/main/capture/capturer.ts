import type { DesktopCapturerSource, Rectangle } from "electron";
import {
  app,
  desktopCapturer,
  screen,
  shell,
  systemPreferences,
} from "electron";
import { activeWindow, openWindows } from "get-windows";

import type { CapturePlatform, FallbackReason } from "../../shared/dto";
import { newCandidateId, newViewId } from "../../shared/ids";
import type {
  CapturedView,
  CaptureOutcome,
  FallbackCandidate,
} from "../session/state";
import type { Acquisition } from "../store/schema";
import type { Size } from "../windows/placement";
import type { WindowKey } from "./window-key";
import {
  matchWindowSource,
  nativeWindowKey,
  parseWindowSourceId,
} from "./window-key";

export const capturePlatform: CapturePlatform =
  process.platform === "win32" ? "windows" : "macos";

const MAX_EDGE = 8192;
const CANDIDATE_THUMB = { height: 200, width: 320 };

const SCREEN_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

/** What the last probe saw. Read only by the INSET_E2E harness. */
export interface ProbeDiagnostics {
  screenAccess: string;
  probe: string;
  windowSources: number;
  matchedSourceId: string | null;
  probeMs: number;
  sourcesMs: number;
}

export const screenAccess = (): string =>
  capturePlatform === "macos"
    ? systemPreferences.getMediaAccessStatus("screen")
    : "granted";

const screenBlocked = () => {
  const status = screenAccess();

  return status === "denied" || status === "restricted";
};

export const openScreenSettings = (): Promise<void> =>
  shell.openExternal(SCREEN_SETTINGS_URL);

const clampEdge = (value: number) =>
  Math.max(1, Math.min(MAX_EDGE, Math.round(value)));

/**
 * macOS reports points, so pixels are bounds times the display scale. Windows reports a
 * physical, DPI-virtualised rect (untested), so it is converted to DIP for placement only.
 */
const geometry = (bounds: Rectangle) => {
  if (capturePlatform === "windows") {
    const dip = screen.screenToDipRect(null, bounds);

    return {
      dip,
      pixels: {
        height: clampEdge(bounds.height),
        width: clampEdge(bounds.width),
      },
    };
  }

  const { scaleFactor } = screen.getDisplayMatching(bounds);

  return {
    dip: bounds,
    pixels: {
      height: clampEdge(bounds.height * scaleFactor),
      width: clampEdge(bounds.width * scaleFactor),
    },
  };
};

const cursorDisplayPixels = (): Size => {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

  return {
    height: clampEdge(display.size.height * display.scaleFactor),
    width: clampEdge(display.size.width * display.scaleFactor),
  };
};

/** Sizes a chosen window from the helper's window list, so small windows are not upscaled. */
const chosenPixels = async (key: WindowKey): Promise<Size> => {
  try {
    const windows = await openWindows({
      accessibilityPermission: false,
      screenRecordingPermission: true,
    });

    const found = windows.find(
      (item) => nativeWindowKey(capturePlatform, item.id) === key
    );

    return found === undefined
      ? cursorDisplayPixels()
      : geometry(found.bounds).pixels;
  } catch {
    return cursorDisplayPixels();
  }
};

const nonEmpty = (value: string | undefined) =>
  value === undefined || value.trim() === "" ? null : value;

const ownPids = () => new Set(app.getAppMetrics().map((metric) => metric.pid));

const toView = (
  source: DesktopCapturerSource,
  sampledAt: Date,
  acquisition: Acquisition,
  extra: {
    appName: string | null;
    boundsDip: Rectangle | null;
    fallbackTitle: string | null;
  }
): CapturedView | null => {
  if (source.thumbnail.isEmpty()) {
    return null;
  }

  const capturedAt = new Date();
  const size = source.thumbnail.getSize();

  return {
    acquisition,
    appName: extra.appName,
    boundsDip: extra.boundsDip,
    capturedAt,
    height: size.height,
    id: newViewId(),
    png: source.thumbnail.toPNG(),
    sampledAt,
    title: nonEmpty(source.name) ?? extra.fallbackTitle,
    width: size.width,
  };
};

export class WindowCapturer {
  readonly #ownSourceIds: () => ReadonlySet<string>;
  #diagnostics: ProbeDiagnostics | null = null;

  constructor(ownSourceIds: () => ReadonlySet<string>) {
    this.#ownSourceIds = ownSourceIds;
  }

  get diagnostics(): ProbeDiagnostics | null {
    return this.#diagnostics;
  }

  async #windowSources(size: Size) {
    const sources = await desktopCapturer.getSources({
      fetchWindowIcons: false,
      thumbnailSize: size,
      types: ["window"],
    });

    const own = this.#ownSourceIds();

    return sources.filter((source) => !own.has(source.id));
  }

  #isOwnKey(key: WindowKey) {
    return [...this.#ownSourceIds()].some(
      (id) => parseWindowSourceId(capturePlatform, id) === key
    );
  }

  /** Samples the foreground window before anything is shown, then captures exactly that window. */
  async captureForeground(): Promise<CaptureOutcome> {
    const sampledAt = new Date();
    const access = screenAccess();
    const started = performance.now();
    let probed: Awaited<ReturnType<typeof activeWindow>>;

    try {
      probed = await activeWindow({
        accessibilityPermission: false,
        screenRecordingPermission: true,
      });
    } catch (error) {
      this.#diagnostics = {
        matchedSourceId: null,
        probe: `threw: ${String(error)}`,
        probeMs: performance.now() - started,
        screenAccess: access,
        sourcesMs: 0,
        windowSources: 0,
      };

      return access === "granted"
        ? { kind: "needsChoice", near: null, reason: "probeUnavailable" }
        : { kind: "permissionDenied" };
    }

    const probeMs = performance.now() - started;

    const record = (
      probe: string,
      windowSources: number,
      matchedSourceId: string | null,
      sourcesMs: number
    ) => {
      this.#diagnostics = {
        matchedSourceId,
        probe,
        probeMs,
        screenAccess: access,
        sourcesMs,
        windowSources,
      };
    };

    // The helper resolves null, not the typed undefined, when no window is frontmost.
    if (!probed) {
      record("no foreground window", 0, null, 0);

      return { kind: "needsChoice", near: null, reason: "probeUnavailable" };
    }

    const summary = `id=${probed.id} owner=${probed.owner.name} titleLength=${probed.title.length}`;
    const key = nativeWindowKey(capturePlatform, probed.id);

    if (
      ownPids().has(probed.owner.processId) ||
      (key !== null && this.#isOwnKey(key))
    ) {
      record(`self ${summary}`, 0, null, 0);

      return { kind: "self" };
    }

    const { dip, pixels } = geometry(probed.bounds);

    if (key === null) {
      record(`invalid ${summary}`, 0, null, 0);

      return { kind: "needsChoice", near: dip, reason: "invalidId" };
    }

    if (screenBlocked()) {
      record(`blocked ${summary}`, 0, null, 0);

      return { kind: "permissionDenied" };
    }

    const listed = performance.now();
    let sources: DesktopCapturerSource[];

    try {
      sources = await this.#windowSources(pixels);
    } catch (error) {
      record(
        `getSources threw ${String(error)}`,
        0,
        null,
        performance.now() - listed
      );

      return { kind: "needsChoice", near: dip, reason: "captureFailed" };
    }

    const sourcesMs = performance.now() - listed;

    const match = matchWindowSource(
      capturePlatform,
      key,
      sources.map((source) => source.id)
    );

    record(
      summary,
      sources.length,
      match.kind === "exact" ? match.sourceId : null,
      sourcesMs
    );

    if (match.kind !== "exact") {
      if (sources.length === 0 && capturePlatform === "macos") {
        return { kind: "permissionDenied" };
      }

      return {
        kind: "needsChoice",
        near: dip,
        reason: match.kind === "none" ? "noMatch" : "ambiguous",
      };
    }

    const source = sources.find((item) => item.id === match.sourceId);

    const view =
      source === undefined
        ? null
        : toView(
            source,
            sampledAt,
            { kind: "direct", windowKeyAtCapture: key },
            {
              appName: nonEmpty(probed.owner.name),
              boundsDip: dip,
              fallbackTitle: nonEmpty(probed.title),
            }
          );

    if (view === null) {
      return capturePlatform === "macos"
        ? { kind: "permissionDenied" }
        : { kind: "needsChoice", near: dip, reason: "vanished" };
    }

    return { kind: "captured", view };
  }

  /** Low-resolution previews for the explicit chooser. Never persisted. */
  async listCandidates(): Promise<readonly FallbackCandidate[]> {
    const sources = await this.#windowSources(CANDIDATE_THUMB);

    return sources
      .filter((source) => !source.thumbnail.isEmpty())
      .map((source) => ({
        id: newCandidateId(),
        sourceId: source.id,
        thumb: source.thumbnail.toPNG(),
        title: nonEmpty(source.name),
      }));
  }

  /** Re-lists sources and captures the chosen one only if its exact id still exists. */
  async captureChosen(
    candidate: FallbackCandidate,
    reason: FallbackReason
  ): Promise<CaptureOutcome> {
    const sampledAt = new Date();
    const key = parseWindowSourceId(capturePlatform, candidate.sourceId);

    const sources = await this.#windowSources(
      key === null ? cursorDisplayPixels() : await chosenPixels(key)
    );

    const source = sources.find((item) => item.id === candidate.sourceId);

    const acquisition: Acquisition = {
      kind: "fallback",
      reason,
      windowKeyAtCapture: key,
    };

    const view =
      source === undefined
        ? null
        : toView(source, sampledAt, acquisition, {
            appName: null,
            boundsDip: null,
            fallbackTitle: candidate.title,
          });

    return view === null
      ? { kind: "needsChoice", near: null, reason: "vanished" }
      : { kind: "captured", view };
  }
}
