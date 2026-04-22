import crypto from "node:crypto";

export function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
}
