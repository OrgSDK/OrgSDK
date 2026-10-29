"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
interface ConfirmationOptions {
  title: string;
  description: string;
  actionLabel: string;
  cancelLabel?: string;
}
const defaultOptions: ConfirmationOptions = {
  title: "Discard unsaved changes?",
  description:
    "You have changes that have not been saved. Keep editing to save them.",
  actionLabel: "Discard changes",
  cancelLabel: "Keep editing",
};
const DiscardContext = createContext<
  (options?: ConfirmationOptions) => Promise<boolean>
>(() => Promise.resolve(false));
export function useDiscardConfirmation(): (
  options?: ConfirmationOptions,
) => Promise<boolean> {
  return useContext(DiscardContext);
}
export function DiscardConfirmation({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState(defaultOptions);
  const resolve = useRef<((shouldDiscard: boolean) => void) | undefined>(
    undefined,
  );
  useEffect(
    () => () => {
      resolve.current?.(false);
    },
    [],
  );
  const canDiscardChanges = useCallback(
    (nextOptions = defaultOptions): Promise<boolean> => {
      if (resolve.current) return Promise.resolve(false);
      return new Promise((accept) => {
        setOptions(nextOptions);
        resolve.current = accept;
        setOpen(true);
      });
    },
    [],
  );
  const finish = (shouldDiscard: boolean): void => {
    resolve.current?.(shouldDiscard);
    resolve.current = undefined;
    setOpen(false);
  };
  return (
    <DiscardContext value={canDiscardChanges}>
      {children}
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) finish(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{options.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {options.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                finish(false);
              }}
            >
              {options.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                finish(true);
              }}
            >
              {options.actionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DiscardContext>
  );
}
