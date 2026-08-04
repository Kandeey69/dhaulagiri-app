export function scrollToPageTop(behavior: ScrollBehavior = "auto") {
  if (typeof window === "undefined") {
    return;
  }

  window.requestAnimationFrame(() => {
    const scrollOptions: ScrollToOptions = { top: 0, left: 0, behavior };
    document.scrollingElement?.scrollTo(scrollOptions);
    window.scrollTo(scrollOptions);

    document
      .querySelectorAll<HTMLElement>(
        ".main-content, .main, .stock-main, .module-picker-page, .suite-settings-page, .maskebari-page",
      )
      .forEach((element) => {
        element.scrollTop = 0;
        element.scrollLeft = 0;
      });
  });
}
