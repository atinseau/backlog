import fs from "node:fs";
import path from "node:path";

export interface ProjectPaths {
  root: string;
  backlogDir: string;
}

export function findProject(startDir = process.cwd()): ProjectPaths | null {
  let current = path.resolve(startDir);

  while (true) {
    const backlogDir = path.join(current, ".backlog");
    if (fs.existsSync(backlogDir) && fs.statSync(backlogDir).isDirectory()) {
      return { root: current, backlogDir };
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}
