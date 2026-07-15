import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { initializeFirebase } from "./firebase.js";

const config = loadConfig();
const firebase = initializeFirebase(config);
const app = createApp(config, firebase);

const server = app.listen(config.port, "0.0.0.0", () => {
  console.info(JSON.stringify({ event: "server_started", port: config.port }));
});

function shutdown(signal: string) {
  console.info(JSON.stringify({ event: "server_stopping", signal }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
