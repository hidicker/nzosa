/**
 * Writes run one at a time, in the order they were asked for.
 *
 * Each write to the books says which version it was built on, and the server
 * refuses one built on a version it no longer holds. Two writes started
 * together both claim the same version, and the second is refused as if
 * somebody else had changed the books. Queued, each starts once the one
 * before has finished -- however that ended, since one failing must not stop
 * the rest -- and reads the version it left.
 *
 * It also counts what is still queued or under way, so a page that no longer
 * waits for its saves can warn before it is closed with one outstanding.
 */
export interface WriteQueue {
  run<T>(work: () => Promise<T>): Promise<T>;
  pending(): number;
}

export function writeQueue(): WriteQueue {
  let last: Promise<unknown> = Promise.resolve();
  let pending = 0;
  return {
    run<T>(work: () => Promise<T>): Promise<T> {
      pending += 1;
      const run = last.then(work, work);
      const done = (): void => {
        pending -= 1;
      };
      run.then(done, done);
      last = run.catch(() => undefined);
      return run;
    },
    pending: () => pending,
  };
}
