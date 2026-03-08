export function createSerialTaskRunner(
  task: () => Promise<void>,
  onError: (error: unknown) => void
): () => Promise<void> {
  let tail = Promise.resolve();

  return () => {
    tail = tail
      .catch(() => undefined)
      .then(task)
      .catch(error => {
        onError(error);
      });

    return tail;
  };
}
