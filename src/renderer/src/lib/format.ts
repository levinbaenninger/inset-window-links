export const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export const viewTitle = (title: string | null): string =>
  title ?? "Untitled window";
