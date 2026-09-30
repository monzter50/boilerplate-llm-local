import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";

export type TestServer = {
  /** http://127.0.0.1:<port>, no trailing slash. */
  baseUrl: string;
  close: () => Promise<void>;
};

/** Mounts the app on an ephemeral port, so tests never collide on 3000. */
export async function startServer(app: Express): Promise<TestServer> {
  const server: Server = app.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
