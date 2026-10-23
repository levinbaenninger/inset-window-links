import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const FILE = "app-state.json";

const AppStateSchema = z.object({ welcomed: z.boolean() });

export type AppState = z.infer<typeof AppStateSchema>;

const firstRun: AppState = { welcomed: false };

/** Small app facts that are not captures. A missing or unreadable file reads as a first run. */
export const loadAppState = async (dir: string): Promise<AppState> => {
  try {
    const parsed = AppStateSchema.safeParse(
      JSON.parse(await readFile(path.join(dir, FILE), "utf-8"))
    );

    return parsed.success ? parsed.data : firstRun;
  } catch {
    return firstRun;
  }
};

export const saveAppState = async (
  dir: string,
  state: AppState
): Promise<void> => {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, FILE), JSON.stringify(state, null, 2));
};
