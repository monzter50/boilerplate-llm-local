import { createApp } from "./app.js";
import { config } from "./config.js";
import * as llm from "./llm.js";
import { describeError, log } from "./log.js";
import { listPrompts } from "./prompts.js";
import { version } from "./version.js";

const SHUTDOWN_GRACE_MS = 5_000;

const { app, openStreams } = createApp({ llm, config });

const server = app.listen(config.port, () => {
  log.info(`API v${version} listening on http://localhost:${config.port}`);
  log.info(`LM Studio at ${config.baseURL}`);
  log.info(`prompts: ${listPrompts().join(", ") || "(none)"}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    log.error(
      `Port ${config.port} is already in use. Stop the process holding it, or set PORT in .env.`,
    );
  } else {
    log.error("server failed to start", describeError(error));
  }
  process.exit(1);
});

let shuttingDown = false;

/**
 * Closes open SSE streams with a final frame instead of dropping them
 * mid-message, which is what `tsx watch` does on every restart.
 */
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    log.warn(`${signal} again, exiting now`);
    process.exit(1);
  }
  shuttingDown = true;

  log.info(`${signal} received, shutting down`, {
    openStreams: openStreams.size,
  });

  server.close(() => {
    log.info("server closed");
    process.exit(0);
  });

  for (const res of openStreams) {
    res.write("event: shutdown\ndata: {}\n\n");
    res.end();
  }

  // Safety net for a connection that refuses to close. unref() keeps it from
  // holding the process open when everything shuts down cleanly.
  setTimeout(() => {
    log.warn(`did not finish within ${SHUTDOWN_GRACE_MS}ms, forcing exit`);
    process.exit(1);
  }, SHUTDOWN_GRACE_MS).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// A dropped SSE connection can surface as a stray rejection; killing the API
// for that would be worse than logging it, so this one does not exit.
process.on("unhandledRejection", (reason) => {
  log.error("unhandled promise rejection", describeError(reason));
});

// An uncaught exception leaves the process in an unknown state: log it and go.
process.on("uncaughtException", (error) => {
  log.error("uncaught exception", describeError(error));
  process.exit(1);
});
