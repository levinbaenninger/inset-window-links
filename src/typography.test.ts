import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parseSync } from "vite";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const SRC = import.meta.dirname;

/**
 * Straight quotes where a sentence has typographic ones: an apostrophe inside or at the end of a
 * word, a quote that opens a word, or a quote written as an HTML entity in JSX. Code inside
 * strings, such as a selector’s `[data-x='y']`, never has a letter on both sides of its quote
 * or a space before it.
 */
const STRAIGHT = [
  /\p{L}'(?:\p{L}|\s|$)/u,
  /(?:^|\s)["']\p{L}/u,
  /&(?:apos|quot|#39|#34);/u,
];

/** JXA and PowerShell sent to the OS as code: their lines end in semicolons, a sentence’s don’t. */
const isScript = (text: string): boolean => /;\s*\n/u.test(text);

/** The syntax nodes that hold text, as that text: a string, a template’s part, or JSX text. */
const TextNodeSchema = z.union([
  z
    .object({
      start: z.number(),
      type: z.literal("Literal"),
      value: z.string(),
    })
    .transform(({ start, value }) => ({ start, text: value })),
  z
    .object({ raw: z.string(), start: z.number(), type: z.literal("JSXText") })
    .transform(({ raw, start }) => ({ start, text: raw })),
  z
    .object({
      start: z.number(),
      type: z.literal("TemplateElement"),
      value: z.object({ cooked: z.string() }),
    })
    .transform(({ start, value }) => ({ start, text: value.cooked })),
]);

/** Every string, template part and JSX text in a file, with its line. */
const texts = (file: string, code: string) => {
  const found: { line: number; text: string }[] = [];

  // Serializing the syntax tree visits every node in it.
  JSON.stringify(parseSync(file, code).program, (_key: string, node) => {
    const parsed = TextNodeSchema.safeParse(node);

    if (parsed.success) {
      found.push({
        line: code.slice(0, parsed.data.start).split("\n").length,
        text: parsed.data.text,
      });
    }

    // A BigInt literal’s value can’t be serialized; it holds no text anyway.
    return z.bigint().safeParse(node).success ? null : node;
  });

  return found;
};

describe("typography", () => {
  it("uses typographic apostrophes and quotes in every string the app shows", async () => {
    const entries = await readdir(SRC, {
      recursive: true,
      withFileTypes: true,
    });

    const files = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          /\.tsx?$/u.test(entry.name) &&
          !/\.test\.tsx?$/u.test(entry.name)
      )
      .map((entry) => path.join(entry.parentPath, entry.name))
      .toSorted();

    const straight = await Promise.all(
      files.map(async (file) =>
        texts(file, await readFile(file, "utf-8"))
          .filter(
            ({ text }) =>
              !isScript(text) && STRAIGHT.some((pattern) => pattern.test(text))
          )
          .map(
            ({ line, text }) =>
              `${path.relative(SRC, file)}:${String(line)} ${text.trim()}`
          )
      )
    );

    expect(straight.flat()).toStrictEqual([]);
  });
});
