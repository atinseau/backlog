import fs from "node:fs";
import path from "node:path";

export interface WorkspacePaths {
  root: string;
  cockpitDir: string;
}

export function findWorkspace(startDir = process.cwd()): WorkspacePaths | null {
  let current = path.resolve(startDir);

  while (true) {
    const cockpitDir = path.join(current, ".cockpit");
    if (fs.existsSync(cockpitDir) && fs.statSync(cockpitDir).isDirectory()) {
      return { root: current, cockpitDir };
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}
