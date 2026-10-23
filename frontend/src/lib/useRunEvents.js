import { useEffect, useReducer, useRef, useState } from "react";

import { api } from "./api";
import { initialRunState, reduce } from "./runState";

/**
 * Subscribe to a run's SSE stream. Past events arrive first, then live ones; reconnects resume by event id.
 * connection: "connecting" | "open" | "reconnecting" | "closed" | "not_found"
 */
export function useRunEvents(runId) {
  const [state, dispatch] = useReducer((s, evs) => evs.reduce(reduce, s), initialRunState);
  const [connection, setConnection] = useState("connecting");
  const lastId = useRef(0);
  const done = useRef(false);

  useEffect(() => {
    let es = null;
    let retryTimer = null;
    let cancelled = false;
    let failures = 0;
    lastId.current = 0;
    done.current = false;

    const connect = () => {
      if (cancelled || done.current) return;
      es = new EventSource(api.eventsUrl(runId, lastId.current));
      es.onopen = () => {
        failures = 0;
        setConnection("open");
      };
      es.onmessage = (msg) => {
        let ev;
        try {
          ev = JSON.parse(msg.data);
        } catch {
          return;
        }
        if (ev.id <= lastId.current) return;
        lastId.current = ev.id;
        dispatch([ev]);
        if (ev.type === "run_completed") {
          done.current = true;
          es?.close();
          setConnection("closed");
        }
      };
      es.onerror = () => {
        if (done.current) return;
        if (es?.readyState === EventSource.CLOSED) {
          // Server refused (e.g. restart or 404): check the run, then retry with backoff.
          es = null;
          failures += 1;
          setConnection("reconnecting");
          api.run(runId).then(
            () => {
              retryTimer = setTimeout(connect, Math.min(15000, 1000 * 2 ** failures));
            },
            (err) => {
              if (err?.status === 404) setConnection("not_found");
              else retryTimer = setTimeout(connect, Math.min(15000, 1000 * 2 ** failures));
            },
          );
        } else {
          setConnection("reconnecting"); // the browser retries automatically with Last-Event-ID
        }
      };
    };

    connect();
    return () => {
      cancelled = true;
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [runId]);

  return { state, connection };
}
