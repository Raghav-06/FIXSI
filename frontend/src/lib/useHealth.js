import { useEffect, useState } from "react";

import { api } from "./api";

let cached = null;
let inflight = null;

/** /api/health, fetched once per page load and shared by every component that asks. */
export function useHealth() {
  const [health, setHealth] = useState(cached);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (cached) return;
    inflight = inflight || api.health();
    inflight.then(
      (h) => {
        cached = h;
        setHealth(h);
      },
      (e) => {
        inflight = null;
        setError(e.message);
      },
    );
  }, []);
  return { health, error };
}
