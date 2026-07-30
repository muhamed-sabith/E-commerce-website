import { cleanup, configure } from "@testing-library/react";

// Account, checkout, payment and admin pages are code-split (React.lazy); the
// first import of a chunk under jsdom can take longer than RTL's 1s default.
configure({ asyncUtilTimeout: 5000 });
import { afterEach } from "vitest";

// Vitest runs without globals:true — RTL's auto-cleanup never registers, so
// mounted trees leak between tests ("found multiple elements" failures).
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement scrolling; the shell scrolls to top on navigation.
// (The production web server's tests run in the node environment: no window.)
if (typeof window !== "undefined") {
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
}
