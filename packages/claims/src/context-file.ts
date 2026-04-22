import fs from "node:fs";
import path from "node:path";
import { cockpitContextSchema, type CockpitContext } from "@cockpit-ai/schemas";

export function readContextFile(gitDir: string): CockpitContext | null {
  const filePath = path.join(gitDir, "cockpit-context.json");
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return cockpitContextSchema.parse(raw);
}

export function writeContextFile(gitDir: string, context: CockpitContext): string {
  const filePath = path.join(gitDir, "cockpit-context.json");
  fs.writeFileSync(filePath, JSON.stringify(context, null, 2) + "\n", "utf8");
  return filePath;
}

export function removeContextFile(gitDir: string, claimId?: string): void {
  const filePath = path.join(gitDir, "cockpit-context.json");
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
