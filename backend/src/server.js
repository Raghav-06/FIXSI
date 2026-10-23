/** Entry point: `npm start` (or `node --experimental-sqlite src/server.js`). */

import { VERSION, createApp } from "./app.js";
import { getSettings } from "./config.js";

const settings = getSettings();
if (settings.webhookSecretWarning) console.warn(`[fixsi] warning: ${settings.webhookSecretWarning}`);
const app = createApp({ settings });
const port = Number(process.env.PORT ?? 8000);
// No HOST = all interfaces, IPv4 and IPv6 (so "localhost" works whether it resolves to 127.0.0.1 or ::1).
const host = process.env.HOST || undefined;

const server = app.listen(port, host, () => {
  const mode = settings.replayActive ? "replay" : "live";
  console.log(`[fixsi] v${VERSION} listening on http://${host ?? "localhost"}:${port} (${mode} mode)`);
});

function shutdown() {
  app.locals.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
