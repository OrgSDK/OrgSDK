import type { ReactNode } from "react";
import { Button } from "../ui/button";
export function ResourceState({
  isLoading,
  error,
  refresh,
}: {
  isLoading: boolean;
  error: string;
  refresh: () => Promise<void>;
}): ReactNode {
  return (
    <>
      {isLoading ? <p role="status">Loading workspace data…</p> : undefined}
      {error ? (
        <div className="error" role="alert">
          <p>{error}</p>
          <Button
            variant="outline"
            onClick={() => {
              void refresh();
            }}
          >
            Try again
          </Button>
        </div>
      ) : undefined}
    </>
  );
}
