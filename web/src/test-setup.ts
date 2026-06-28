import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest runs without globals:true — RTL's auto-cleanup never registers, so
// mounted trees leak between tests ("found multiple elements" failures).
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement scrolling; the shell scrolls to top on navigation.
window.scrollTo = (() => undefined) as typeof window.scrollTo;
