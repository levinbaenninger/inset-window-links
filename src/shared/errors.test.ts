import { describe, expect, it } from "vitest";

import { copyProblem, couldNotSave, saveProblem } from "./errors";

const failure = (code: string) =>
  Object.assign(new Error(`${code}: something, write '/x/record.json.tmp'`), {
    code,
  });

describe(saveProblem, () => {
  it("names the common disk errors in plain words", () => {
    expect(
      ["ENOSPC", "EACCES", "EPERM", "EROFS"].map((code) =>
        saveProblem(failure(code))
      )
    ).toStrictEqual([
      "The disk is full.",
      "Inset can’t write to its data folder.",
      "Inset can’t write to its data folder.",
      "The disk is read-only.",
    ]);
  });

  it("gives any other error its code, and never the raw message", () => {
    expect([
      saveProblem(failure("EIO")),
      saveProblem(new Error("Error invoking remote method")),
      saveProblem("ENOSPC"),
      saveProblem(null),
      saveProblem({ code: 28 }),
    ]).toStrictEqual([
      "Couldn’t save (EIO).",
      "Couldn’t save.",
      "Couldn’t save.",
      "Couldn’t save.",
      "Couldn’t save.",
    ]);
  });
});

describe(couldNotSave, () => {
  it("leads with Couldn’t save once, and not before a reason that says what couldn’t be done", () => {
    expect([
      couldNotSave("The disk is full."),
      couldNotSave("Couldn’t save (EIO)."),
      couldNotSave("Couldn’t save."),
      couldNotSave("Couldn’t discard the changes. The disk is read-only."),
    ]).toStrictEqual([
      "Couldn’t save. The disk is full.",
      "Couldn’t save (EIO).",
      "Couldn’t save.",
      "Couldn’t discard the changes. The disk is read-only.",
    ]);
  });
});

describe(copyProblem, () => {
  it("says the copy failed, with the code when there is one", () => {
    expect([
      copyProblem(failure("ENOENT")),
      copyProblem(new Error("clipboard")),
    ]).toStrictEqual(["Couldn’t copy (ENOENT).", "Couldn’t copy."]);
  });
});
