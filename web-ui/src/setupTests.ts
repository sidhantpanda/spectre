import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// xterm requests a canvas context in JSDOM; provide a lightweight stub for tests.
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  value: () => ({} as CanvasRenderingContext2D),
});
