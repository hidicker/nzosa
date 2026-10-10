/**
 * Saying, at once, when the same books are open in another tab.
 *
 * Two tabs on one set of books each hold their own copy. The second to save is
 * refused ("These books changed somewhere else") and its change is lost until
 * made again, which nobody expects when the other tab was forgotten. Tabs of
 * one browser can hear each other on a BroadcastChannel, so each announces
 * itself on opening, answers the others, and says goodbye on leaving; while
 * any other is there, a banner says so. Another device cannot be heard this
 * way: the refused save stays the backstop for that.
 */

type Message = { kind: "hello" | "here" | "bye"; id: string };

/**
 * Listen for other tabs with the same books, by a key naming them (where they
 * are kept and which set), and call `show` whenever that changes.
 */
export function watchOtherTabs(key: string, show: (othersOpen: boolean) => void): void {
  if (typeof BroadcastChannel === "undefined" || key === "") return;
  const me = Math.random().toString(36).slice(2);
  // Each other tab, by when it was last heard from.
  const others = new Map<string, number>();
  const channel = new BroadcastChannel(`nzosa-books:${key}`);
  const say = (kind: Message["kind"]): void => channel.postMessage({ kind, id: me } satisfies Message);
  let showing = false;
  const update = (): void => {
    const now = others.size > 0;
    if (now !== showing) show(now);
    showing = now;
  };

  channel.addEventListener("message", (event: MessageEvent<Message>) => {
    const { kind, id } = event.data ?? ({} as Message);
    if (typeof id !== "string" || id === me) return;
    if (kind === "bye") others.delete(id);
    else others.set(id, Date.now());
    // A tab that has just opened is answered, so it learns this one is here.
    if (kind === "hello") say("here");
    update();
  });
  window.addEventListener("pagehide", () => say("bye"));
  // A tab closed abruptly may not get its goodbye out, so each also says it
  // is still here every few seconds, and one not heard from for a while is
  // taken to have gone.
  setInterval(() => {
    say("here");
    const stale = Date.now() - 12_000;
    for (const [id, seen] of others) if (seen < stale) others.delete(id);
    update();
  }, 4_000);
  say("hello");
}

/** The banner, shown while another tab has the same books open. */
export function showOtherTabs(othersOpen: boolean): void {
  const banner = document.getElementById("tabs-banner");
  if (banner !== null) banner.hidden = !othersOpen;
}
