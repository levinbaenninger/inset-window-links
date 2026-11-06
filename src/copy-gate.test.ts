import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = import.meta.dirname;

/** Every source file under src, tests left out, as paths relative to the repository. */
const sources = async (): Promise<Map<string, string>> => {
  const entries = await readdir(SRC, { recursive: true, withFileTypes: true });

  const files = entries.filter(
    (entry) =>
      entry.isFile() &&
      /\.tsx?$/u.test(entry.name) &&
      !/\.test\.tsx?$/u.test(entry.name)
  );

  return new Map(
    await Promise.all(
      files.map(async (entry) => {
        const file = path.join(entry.parentPath, entry.name);

        return [
          path.relative(path.dirname(SRC), file),
          await readFile(file, "utf-8"),
        ] as const;
      })
    )
  );
};

/** The files whose code matches `pattern`, sorted. */
const filesMatching = async (pattern: RegExp): Promise<string[]> =>
  [...(await sources())]
    .flatMap(([file, code]) => (pattern.test(code) ? [file] : []))
    .toSorted();

/** Any way to put something on the clipboard, in main or in a page. */
const CLIPBOARD_WRITE = new RegExp(
  [
    String.raw`\bclipboard\s*\.\s*write`,
    String.raw`navigator\s*\.\s*clipboard`,
    String.raw`\bClipboardItem\b`,
    String.raw`execCommand\s*\(\s*["'](?:copy|cut)`,
    String.raw`clipboardData\s*\.\s*setData`,
    String.raw`import\s*\{[^}]*\bclipboard\b[^}]*\}\s*from\s*["']electron["']`,
  ].join("|"),
  "u"
);

describe("the copy gate", () => {
  it("is the only way to the clipboard: one file in main writes it", async () => {
    await expect(filesMatching(CLIPBOARD_WRITE)).resolves.toStrictEqual([
      "src/main/clipboard.ts",
    ]);
  });

  it("is reached only from main's copy channel", async () => {
    await expect(filesMatching(/\bwriteClip\b/u)).resolves.toStrictEqual([
      "src/main/clipboard.ts",
      "src/main/ipc/register.ts",
    ]);
  });

  it("is the only caller of that channel in the pages, so every copy saves first", async () => {
    const callers = await filesMatching(/\.copy\s*\(/u);

    expect(
      callers.filter((file) => file.startsWith("src/renderer"))
    ).toStrictEqual(["src/renderer/src/library/copy-gate.ts"]);
  });
});
