/**
 * Lending a live part of one page to another.
 *
 * The bank feed and the bank file import are wired once, at startup, to the
 * elements the page was built with. The guided start wants to show those same
 * two things inside a step rather than send somebody off to another page and
 * hope they come back -- and a second copy of either would be a second thing
 * to keep in step with the first, which is how two drop zones end up behaving
 * differently.
 *
 * So the element itself moves, and a marker stays behind in its place. Putting
 * it back is exact: it goes where the marker is, which is where it was, rather
 * than on the end of whichever page claimed it last.
 */

function markerFor(id: string): string {
  return `${id}-was-here`;
}

/** Take an element out of its page. Null when this build has no such element. */
export function borrow(id: string): HTMLElement | null {
  const element = document.getElementById(id);
  if (element === null) return null;
  if (document.getElementById(markerFor(id)) === null) {
    const marker = document.createElement("div");
    marker.id = markerFor(id);
    marker.hidden = true;
    element.parentElement?.insertBefore(marker, element);
  }
  return element;
}

/** Put everything borrowed back where it came from. Safe to call at any time. */
export function returnBorrowed(): void {
  for (const marker of document.querySelectorAll<HTMLElement>('[id$="-was-here"]')) {
    const id = marker.id.slice(0, -"-was-here".length);
    const element = document.getElementById(id);
    if (element !== null && element.previousElementSibling !== marker) marker.after(element);
  }
}
