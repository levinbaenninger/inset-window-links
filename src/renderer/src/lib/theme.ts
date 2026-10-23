/** Follows the OS appearance, since the preset ships both light and dark tokens. */
export const followSystemTheme = (): void => {
  const query = window.matchMedia("(prefers-color-scheme: dark)");

  const apply = () =>
    document.documentElement.classList.toggle("dark", query.matches);

  apply();
  query.addEventListener("change", apply);
};
