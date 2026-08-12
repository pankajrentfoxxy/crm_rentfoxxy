/**
 * Open a tab synchronously on user click, then navigate after async work.
 * Safari/macOS blocks window.open() called after await; do not use noopener here
 * (it returns null and prevents setting location later).
 */
export function openBlankTab() {
  return window.open('about:blank', '_blank');
}

export function navigateTab(tab, url) {
  if (tab && !tab.closed) {
    tab.location.assign(url);
    return true;
  }
  return false;
}

export function closeTab(tab) {
  if (tab && !tab.closed) {
    tab.close();
  }
}
