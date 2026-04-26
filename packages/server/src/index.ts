import { serve, type ServerType } from "@hono/node-server";
import { buildApp, VERSION } from "./app.js";
import { resolveWorkspace, type ServerWorkspace } from "./workspace-context.js";

export interface StartServerOptions {
  workspace?: string;
  port?: number;
  host?: string;
  uiDistDir?: string;
}

export interface RunningServer {
  url: string;
  port: number;
  host: string;
  workspace: ServerWorkspace;
  close: () => Promise<void>;
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const workspace = resolveWorkspace(options.workspace);
  const appOptions: { workspace: ServerWorkspace; uiDistDir?: string } = { workspace };
  if (options.uiDistDir) appOptions.uiDistDir = options.uiDistDir;
  const app = buildApp(appOptions);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 7878;

  const server: ServerType = await new Promise((resolvePromise) => {
    const instance = serve({ fetch: app.fetch, port, hostname: host }, () => {
      resolvePromise(instance);
    });
  });

  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  return {
    url: `http://${displayHost}:${port}`,
    port,
    host,
    workspace,
    close: () =>
      new Promise<void>((closeResolve, closeReject) => {
        server.close((error) => {
          if (error) {
            closeReject(error);
          } else {
            closeResolve();
          }
        });
      }),
  };
}

export { buildApp, VERSION };
export type { ServerWorkspace } from "./workspace-context.js";
