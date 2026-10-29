"use client";
import { createContext, useContext } from "react";
import {
  identityConfirmationMessage,
  isReauthenticationRequired,
} from "../../api/auth";
import { errorMessage } from "../../api/result";

export const AccountSecurityContext = createContext<(() => void) | undefined>(
  undefined,
);

export function useAccountError(): (
  error: unknown,
  fallback: string,
) => string {
  const requestIdentity = useContext(AccountSecurityContext);
  return (error, fallback) => {
    if (requestIdentity && isReauthenticationRequired(error)) {
      requestIdentity();
      return identityConfirmationMessage;
    }
    return errorMessage(error, fallback);
  };
}
