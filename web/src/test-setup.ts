import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { resetCollapsed } from "./ui/collapsed";
import { resetGrouping } from "./ui/grouping";
import { resetShowCompleted } from "./ui/showCompleted";

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetCollapsed();
  resetShowCompleted();
  resetGrouping();
  vi.unstubAllGlobals();
});
