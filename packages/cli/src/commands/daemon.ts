import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { findProject } from "@backlog/config";

export interface DaemonPaths {
  unitPath: string;
  logsDir: string;
  startHint: string;
  stopHint: string;
}

export interface DaemonRenderInput {
  binary: string;
  projectRoot: string;
  port: number;
  logDir: string;
  homeDir: string;
}

const LABEL = "com.backlog.serve";
const SERVICE_NAME = "backlog.service";

// macOS LaunchAgent — runs as the user, restarts on crash, writes logs to
// ~/Library/Logs/backlog/. Loaded with `launchctl bootstrap gui/<uid> <path>`.
export function renderLaunchdPlist(input: DaemonRenderInput): string {
  const args = [
    input.binary,
    "serve",
    "--workspace",
    input.projectRoot,
    "--port",
    String(input.port),
    "--no-open",
  ];
  const programArgs = args.map((arg) => `        <string>${escapeXml(arg)}</string>`).join("\n");
  const stdoutLog = path.join(input.logDir, "serve.log");
  const stderrLog = path.join(input.logDir, "serve.error.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${programArgs}
    </array>
    <key>WorkingDirectory</key>
    <string>${escapeXml(input.projectRoot)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${escapeXml(stdoutLog)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(stderrLog)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${escapeXml(input.homeDir)}</string>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
`;
}

// Linux systemd user unit — equivalent of the launchd plist. Loaded with
// `systemctl --user enable --now backlog.service`.
export function renderSystemdUnit(input: DaemonRenderInput): string {
  return `[Unit]
Description=Backlog board server
After=network.target

[Service]
Type=simple
WorkingDirectory=${input.projectRoot}
ExecStart=${input.binary} serve --workspace ${input.projectRoot} --port ${input.port} --no-open
Restart=on-failure
RestartSec=5
StandardOutput=append:${path.join(input.logDir, "serve.log")}
StandardError=append:${path.join(input.logDir, "serve.error.log")}

[Install]
WantedBy=default.target
`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function getDaemonPaths(platform: NodeJS.Platform = process.platform, homeDir = os.homedir()): DaemonPaths | null {
  if (platform === "darwin") {
    const unitPath = path.join(homeDir, "Library", "LaunchAgents", `${LABEL}.plist`);
    const logsDir = path.join(homeDir, "Library", "Logs", "backlog");
    return {
      unitPath,
      logsDir,
      startHint: `launchctl bootstrap gui/$UID "${unitPath}"`,
      stopHint: `launchctl bootout gui/$UID/${LABEL}`,
    };
  }
  if (platform === "linux") {
    const unitPath = path.join(homeDir, ".config", "systemd", "user", SERVICE_NAME);
    const logsDir = path.join(homeDir, ".local", "state", "backlog");
    return {
      unitPath,
      logsDir,
      startHint: `systemctl --user daemon-reload && systemctl --user enable --now ${SERVICE_NAME}`,
      stopHint: `systemctl --user disable --now ${SERVICE_NAME}`,
    };
  }
  return null;
}

interface InstallOptions {
  workspace?: string;
  port: string;
  dryRun?: boolean;
}

interface UninstallOptions {
  force?: boolean;
}

function resolveBinary(): string {
  // process.argv[1] is the entry script (the symlinked `backlog` binary when
  // launched via the global install), which is exactly what launchd/systemd
  // should call.
  return process.argv[1] ?? "backlog";
}

function resolveWorkspaceRoot(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  const found = findProject();
  if (!found) {
    throw new Error(
      "No .backlog project found in the current directory. Pass --workspace <path> or run from a workspace.",
    );
  }
  return found.root;
}

export function registerDaemonCommand(program: Command): void {
  const daemon = program
    .command("daemon")
    .description("Manage the long-running backlog serve daemon (launchd on macOS, systemd on Linux)");

  daemon
    .command("install")
    .description("Write the launchd/systemd unit for `backlog serve` (does not start it)")
    .option("-w, --workspace <path>", "Workspace to serve (defaults to the current one)")
    .option("-p, --port <port>", "TCP port to bind", "7878")
    .option("--dry-run", "Print the unit file to stdout instead of writing it")
    .action((options: InstallOptions) => {
      const paths = getDaemonPaths();
      if (!paths) {
        throw new Error(
          `daemon install is not yet implemented for platform "${process.platform}". Supported: darwin, linux.`,
        );
      }
      const port = Number.parseInt(options.port, 10);
      if (Number.isNaN(port) || port <= 0 || port > 65535) {
        throw new Error(`Invalid --port value: ${options.port}`);
      }
      const projectRoot = resolveWorkspaceRoot(options.workspace);
      const renderInput: DaemonRenderInput = {
        binary: resolveBinary(),
        projectRoot,
        port,
        logDir: paths.logsDir,
        homeDir: os.homedir(),
      };
      const content =
        process.platform === "darwin" ? renderLaunchdPlist(renderInput) : renderSystemdUnit(renderInput);

      if (options.dryRun) {
        console.log(content);
        return;
      }

      fs.mkdirSync(path.dirname(paths.unitPath), { recursive: true });
      fs.mkdirSync(paths.logsDir, { recursive: true });
      fs.writeFileSync(paths.unitPath, content, "utf8");

      console.log(`Wrote ${paths.unitPath}`);
      console.log(`Logs: ${paths.logsDir}/serve.log`);
      console.log("");
      console.log("To start the daemon now:");
      console.log(`  ${paths.startHint}`);
      console.log("");
      console.log("To stop it later:");
      console.log(`  ${paths.stopHint}`);
    });

  daemon
    .command("uninstall")
    .description("Remove the launchd/systemd unit (does not stop a running daemon)")
    .option("--force", "Don't fail if the unit isn't installed")
    .action((options: UninstallOptions) => {
      const paths = getDaemonPaths();
      if (!paths) {
        throw new Error(
          `daemon uninstall is not yet implemented for platform "${process.platform}".`,
        );
      }
      if (!fs.existsSync(paths.unitPath)) {
        if (options.force) {
          console.log(`Nothing to remove at ${paths.unitPath}`);
          return;
        }
        throw new Error(`No daemon unit found at ${paths.unitPath}. Pass --force to ignore.`);
      }
      fs.unlinkSync(paths.unitPath);
      console.log(`Removed ${paths.unitPath}`);
      console.log("");
      console.log("If the daemon was loaded, stop it with:");
      console.log(`  ${paths.stopHint}`);
    });

  daemon
    .command("path")
    .description("Print where the daemon unit lives (or would be installed)")
    .action(() => {
      const paths = getDaemonPaths();
      if (!paths) {
        throw new Error(`Platform "${process.platform}" is not supported.`);
      }
      console.log(`Unit: ${paths.unitPath}`);
      console.log(`Logs: ${paths.logsDir}`);
      console.log(`Installed: ${fs.existsSync(paths.unitPath)}`);
    });
}
