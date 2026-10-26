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
  PendingSource,
} from "../session/state";
import type { Acquisition, ViewOrigin } from "../store/schema";
import type { Size } from "../windows/placement";
import { canReadOrigins, readOrigin } from "./origin";
import type { WindowKey } from "./window-key";
import {
  matchWindowSource,
  nativeWindowKey,
  parseWindowSourceId,
} from "./window-key";
import { windowsOrigins } from "./windows-origin";

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
  /** From the start of the probe to the window being identified, before sources are listed. */
  identifiedMs: number;
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

type ListedWindow = Awaited<ReturnType<typeof openWindows>>[number];

/** The helper's window list by window key, for sizes, app names and origins. Empty when it fails. */
const listedWindows = async (): Promise<Map<WindowKey, ListedWindow>> => {
  try {
    const windows = await openWindows({
      accessibilityPermission: false,
      screenRecordingPermission: true,
    });

    return new Map(
      windows.flatMap((item) => {
        const key = nativeWindowKey(capturePlatform, item.id);

        return key === null ? [] : [[key, item] as const];
      })
    );
  } catch {
    return new Map();
  }
};

/** One box that fits every chosen window at full resolution, so the batch lists sources once. */
const batchPixels = (sizes: readonly Size[]): Size =>
  sizes.length === 0
    ? cursorDisplayPixels()
    : {
        height: Math.max(...sizes.map((size) => size.height)),
        width: Math.max(...sizes.map((size) => size.width)),
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
    origin: ViewOrigin | null;
    /** The window's own pixels, when the source was listed at a larger, shared size. */
    fit?: Size | undefined;
  }
): CapturedView | null => {
  if (source.thumbnail.isEmpty()) {
    return null;
  }

  const capturedAt = new Date();
  const listed = source.thumbnail.getSize();

  const scale =
    extra.fit === undefined
      ? 1
      : Math.min(
          extra.fit.width / listed.width,
          extra.fit.height / listed.height
        );

  // Resizing by width alone keeps the aspect ratio.
  const image =
    scale < 1
      ? source.thumbnail.resize({
          quality: "best",
          width: Math.max(1, Math.round(listed.width * scale)),
        })
      : source.thumbnail;

  const size = image.getSize();

  return {
    acquisition,
    appName: extra.appName,
    boundsDip: extra.boundsDip,
    capturedAt,
    height: size.height,
    id: newViewId(),
    origin: extra.origin,
    png: image.toPNG(),
    sampledAt,
    title: nonEmpty(source.name) ?? extra.fallbackTitle,
    width: size.width,
  };
};

/**
 * The page or file of the window the probe found. Browsers' addresses come from a second probe
 * that may read them; it counts only if the same window is still in front. On Windows the
 * browser's address bar is read by window handle, when readPages allows it.
 */
const foregroundOrigin = async (
  probed: NonNullable<Awaited<ReturnType<typeof activeWindow>>>,
  readPages: boolean
): Promise<ViewOrigin | null> => {
  if (capturePlatform === "windows") {
    const [origin] = await windowsOrigins(
      [
        {
          bounds: geometry(probed.bounds).dip,
          hwnd: probed.id,
          ownerPath: probed.owner.path,
        },
      ],
      readPages
    );

    return origin ?? null;
  }

  let knownUrl: string | undefined;

  if (canReadOrigins()) {
    try {
      const again = await activeWindow({
        accessibilityPermission: true,
        screenRecordingPermission: true,
      });

      knownUrl =
        again?.id === probed.id && "url" in again ? again.url : undefined;
    } catch {
      knownUrl = undefined;
    }
  }

  return readOrigin({
    bounds: geometry(probed.bounds).dip,
    knownUrl,
    ownerPath: probed.owner.path,
    pid: probed.owner.processId,
    strict: false,
    title: nonEmpty(probed.title),
  });
};

export class WindowCapturer {
  readonly #ownSourceIds: () => ReadonlySet<string>;
  readonly #readPages: () => boolean;
  #diagnostics: ProbeDiagnostics | null = null;

  /** readPages: whether browser addresses may be read (Windows; macOS asks Accessibility instead). */
  constructor(
    ownSourceIds: () => ReadonlySet<string>,
    readPages: () => boolean
  ) {
    this.#ownSourceIds = ownSourceIds;
    this.#readPages = readPages;
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

  /**
   * Samples the foreground window before anything is shown, then captures exactly that window.
   * onIdentified runs between the two, once the window is known and before the slow source listing.
   * Listing blocks the main process, so whatever onIdentified shows must have painted when it resolves.
   */
  async captureForeground(
    onIdentified?: (source: PendingSource, near: Rectangle) => Promise<void>
  ): Promise<CaptureOutcome> {
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
        identifiedMs: 0,
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
    let identifiedMs = 0;

    const record = (
      probe: string,
      windowSources: number,
      matchedSourceId: string | null,
      sourcesMs: number
    ) => {
      this.#diagnostics = {
        identifiedMs,
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

    identifiedMs = performance.now() - started;
    await onIdentified?.(
      {
        appName: nonEmpty(probed.owner.name),
        title: nonEmpty(probed.title),
      },
      dip
    );

    const listed = performance.now();
    let sources: DesktopCapturerSource[];

    // Read while the sources are listed, so remembering the page or file adds no wait.
    const origin = foregroundOrigin(probed, this.#readPages());

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
              origin: await origin,
            }
          );

    if (view === null) {
      return capturePlatform === "macos"
        ? { kind: "permissionDenied" }
        : { kind: "needsChoice", near: dip, reason: "vanished" };
    }

    return { kind: "captured", view };
  }

  /** Where each picked window came from; null where the helper did not list the window. */
  async #chosenOrigins(
    listed: readonly (ListedWindow | undefined)[]
  ): Promise<(ViewOrigin | null)[]> {
    if (capturePlatform === "windows") {
      const known = listed.flatMap((item) =>
        item === undefined ? [] : [item]
      );

      const origins = await windowsOrigins(
        known.map((item) => ({
          bounds: geometry(item.bounds).dip,
          hwnd: item.id,
          ownerPath: item.owner.path,
        })),
        this.#readPages()
      );

      return listed.map((item) =>
        item === undefined ? null : (origins[known.indexOf(item)] ?? null)
      );
    }

    return Promise.all(
      listed.map((item) =>
        item === undefined
          ? null
          : readOrigin({
              bounds: geometry(item.bounds).dip,
              ownerPath: item.owner.path,
              pid: item.owner.processId,
              strict: true,
              title: nonEmpty(item.title),
            })
      )
    );
  }

  /** Low-resolution previews for the window list, with each window's app. Never persisted. */
  async listCandidates(): Promise<readonly FallbackCandidate[]> {
    const [sources, windows] = await Promise.all([
      this.#windowSources(CANDIDATE_THUMB),
      listedWindows(),
    ]);

    return sources
      .filter((source) => !source.thumbnail.isEmpty())
      .map((source) => {
        const key = parseWindowSourceId(capturePlatform, source.id);
        const listed = key === null ? undefined : windows.get(key);

        return {
          appName: nonEmpty(listed?.owner.name),
          id: newCandidateId(),
          sourceId: source.id,
          thumb: source.thumbnail.toPNG(),
          title: nonEmpty(source.name),
        };
      });
  }

  /**
   * Captures the chosen windows together: one listing of sources, at a size that fits the
   * largest, then each image scaled back to its own window. A window whose exact id is gone
   * counts as missing.
   */
  async captureChosen(
    candidates: readonly FallbackCandidate[],
    reason: FallbackReason
  ): Promise<CaptureOutcome> {
    const sampledAt = new Date();
    const windows = await listedWindows();

    const chosen = candidates.map((candidate) => {
      const key = parseWindowSourceId(capturePlatform, candidate.sourceId);
      const listed = key === null ? undefined : windows.get(key);

      return {
        candidate,
        key,
        listed,
        pixels:
          listed === undefined ? undefined : geometry(listed.bounds).pixels,
      };
    });

    const [sources, origins] = await Promise.all([
      this.#windowSources(
        batchPixels(chosen.flatMap((item) => item.pixels ?? []))
      ),
      this.#chosenOrigins(chosen.map((item) => item.listed)),
    ]);

    const views = chosen.flatMap((item, index) => {
      const source = sources.find(
        (found) => found.id === item.candidate.sourceId
      );

      const view =
        source === undefined
          ? null
          : toView(
              source,
              sampledAt,
              { kind: "fallback", reason, windowKeyAtCapture: item.key },
              {
                appName:
                  nonEmpty(item.listed?.owner.name) ?? item.candidate.appName,
                boundsDip: null,
                fallbackTitle: item.candidate.title,
                fit: item.pixels,
                origin: origins[index] ?? null,
              }
            );

      return view === null ? [] : [view];
    });

    return {
      kind: "capturedMany",
      missing: candidates.length - views.length,
      views,
    };
  }
}
