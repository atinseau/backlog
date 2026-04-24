import fs from "node:fs";
import path from "node:path";
import { backlogContextSchema, type BacklogContext } from "@backlog/schemas";

export function readContextFile(gitDir: string): BacklogContext | null {
  const filePath = path.join(gitDir, "backlog-context.json");
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return backlogContextSchema.parse(raw);
}

export function writeContextFile(gitDir: string, context: BacklogContext): string {
  const filePath = path.join(gitDir, "backlog-context.json");
  fs.writeFileSync(filePath, JSON.stringify(context, null, 2) + "\n", "utf8");
  return filePath;
}

export function removeContextFile(gitDir: string, claimId?: string): void {
  const filePath = path.join(gitDir, "backlog-context.json");
  if (!fs.existsSync(filePath)) {
    return;
  }

  if (!claimId) {
    fs.unlinkSync(filePath);
    return;
  }

  const context = readContextFile(gitDir);
  if (context?.claim_id === claimId) {
    fs.unlinkSync(filePath);
  }
}
