import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { resetCollapsed } from "./ui/collapsed";

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetCollapsed();
  vi.unstubAllGlobals();
});
