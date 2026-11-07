const CAPTURE_PAGE = /^#\/captures\/[^/?]+(?:\?(?!.*\bview=).*)?$/u;

/**
 * Whether Recent Captures' address is a capture's page, which the Capture menu's Mark as Done,
 * Copy as Text and Reopen Windows act on. The image view of a capture does not count, and neither
 * does a page still loading, whose address is empty.
 */
export const routeShowsCapture = (url: string): boolean =>
  URL.canParse(url) && CAPTURE_PAGE.test(new URL(url).hash);
