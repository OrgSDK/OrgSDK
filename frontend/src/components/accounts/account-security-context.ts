"use client";
import { createContext } from "react";
export const AccountSecurityContext = createContext<(() => void) | undefined>(
  undefined,
);
