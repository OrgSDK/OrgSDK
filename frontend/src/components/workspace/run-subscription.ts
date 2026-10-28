import { trpc } from "../../api/trpc";

export function subscribeToRunUpdates(
  id: string,
  refresh: () => Promise<void>,
  subscribe: typeof trpc.runs.stream.subscribe = trpc.runs.stream.subscribe,
): () => void {
  let isActive = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = (): void => {
    if (!isActive || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (isActive) void refresh();
    }, 400);
  };
  const subscription = subscribe(
    { id },
    {
      onData: update,
      onComplete() {
        if (!isActive) return;
        clearTimeout(timer);
        timer = undefined;
        void refresh();
      },
      onError: update,
    },
  );
  return () => {
    isActive = false;
    clearTimeout(timer);
    subscription.unsubscribe();
  };
}
