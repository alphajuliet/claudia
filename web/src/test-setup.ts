import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { resetCollapsed } from "./ui/collapsed";
import { resetShowCompleted } from "./ui/showCompleted";

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetCollapsed();
  resetShowCompleted();
  vi.unstubAllGlobals();
});
