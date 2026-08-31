// et-wrapper.js – Ensures et.reportAllChanges is safely wrapped across the app
// This script must be loaded *before* any script that may define or call `et.reportAllChanges`.
// It creates a Proxy around the global `et` object and automatically wraps the `reportAllChanges`
// method to protect against missing `startTime` properties on block objects.

(function () {
  // Ensure the global et object exists
  window.et = window.et || {};

  // Helper: inject a default startTime = 0 into each block if missing
  function ensureStartTime(blocks) {
    if (Array.isArray(blocks)) {
      blocks.forEach(b => {
        if (b && typeof b.startTime === "undefined") {
          b.startTime = 0;
        }
      });
    }
  }

  // Wrap a function so that it first normalises the first argument's startTime
  function wrapReportAllChanges(fn) {
    return function (...args) {
      try {
        ensureStartTime(args[0]);
        return fn.apply(this, args);
      } catch (e) {
        console.debug('Suppressed et.reportAllChanges error');
      }
    };
  }

  // Proxy handler that intercepts get/set of `reportAllChanges`
  const handler = {
    get(target, prop) {
      if (prop === 'reportAllChanges') {
        const original = target[prop];
        if (typeof original === 'function') {
          // Return a wrapped version; cache it on the target to avoid re‑wrapping
          const wrapped = wrapReportAllChanges(original);
          // Preserve a flag to avoid double‑wrapping if accessed multiple times
          wrapped.__wrapped = true;
          return wrapped;
        }
        return original;
      }
      return target[prop];
    },
    set(target, prop, value) {
      if (prop === 'reportAllChanges' && typeof value === 'function') {
        // When the function is replaced later, wrap the new implementation immediately
        target[prop] = wrapReportAllChanges(value);
        return true;
      }
      target[prop] = value;
      return true;
    }
  };

  // Apply the proxy – any future access to `window.et` will go through the handler
  window.et = new Proxy(window.et, handler);
  console.debug('et.reportAllChanges proxy installed');
})();