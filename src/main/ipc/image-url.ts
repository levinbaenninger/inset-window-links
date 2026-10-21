import {
  CandidateIdSchema,
  DraftIdSchema,
  ViewIdSchema,
} from "../../shared/ids";

/** Opaque image addresses. They carry ids only, never paths, and resolve only for known ids. */
export type ImageRef =
  | { kind: "saved"; captureId: string; viewId: string }
  | { kind: "draft"; viewId: string }
  | { kind: "candidate"; candidateId: string };

export const IMAGE_SCHEME = "inset";

export const imageUrl = (ref: ImageRef): string => {
  switch (ref.kind) {
    case "saved": {
      return `${IMAGE_SCHEME}://image/saved/${ref.captureId}/${ref.viewId}`;
    }

    case "draft": {
      return `${IMAGE_SCHEME}://image/draft/${ref.viewId}`;
    }

    default: {
      return `${IMAGE_SCHEME}://image/candidate/${ref.candidateId}`;
    }
  }
};

const isId = (
  value: string | undefined,
  schema: typeof DraftIdSchema | typeof ViewIdSchema | typeof CandidateIdSchema
) => value !== undefined && schema.safeParse(value).success;

export const parseImageUrl = (url: string): ImageRef | null => {
  if (!URL.canParse(url)) {
    return null;
  }

  const parsed = new URL(url);

  if (
    parsed.protocol !== `${IMAGE_SCHEME}:` ||
    parsed.host !== "image" ||
    parsed.search !== ""
  ) {
    return null;
  }

  const [kind, first, second, ...rest] = parsed.pathname.split("/").slice(1);

  if (rest.length > 0) {
    return null;
  }

  if (
    kind === "saved" &&
    isId(first, DraftIdSchema) &&
    isId(second, ViewIdSchema)
  ) {
    return { captureId: first ?? "", kind, viewId: second ?? "" };
  }

  if (second !== undefined) {
    return null;
  }

  if (kind === "draft" && isId(first, ViewIdSchema)) {
    return { kind, viewId: first ?? "" };
  }

  return kind === "candidate" && isId(first, CandidateIdSchema)
    ? { candidateId: first ?? "", kind }
    : null;
};
