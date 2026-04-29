import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { usersFileSchema, type User, type UserRole, type UsersFile } from "@backlog/schemas";

// Workspace-scoped human collaborator store. Lives at .backlog/users.yaml
// alongside agents.yaml. The data model intentionally mirrors agents:
// list, get, add, update, delete — so the UI can treat them with the
// same patterns (assignee dropdown, manage view, etc.).

function usersPath(backlogDir: string): string {
  return path.join(backlogDir, "users.yaml");
}

function readFile(backlogDir: string): UsersFile {
  const file = usersPath(backlogDir);
  if (!fs.existsSync(file)) {
    return { version: 1, users: [] };
  }
  const parsed = YAML.parse(fs.readFileSync(file, "utf8")) as unknown;
  return usersFileSchema.parse(parsed);
}

function writeFile(backlogDir: string, file: UsersFile): void {
  fs.mkdirSync(path.dirname(usersPath(backlogDir)), { recursive: true });
  fs.writeFileSync(usersPath(backlogDir), YAML.stringify(usersFileSchema.parse(file)), "utf8");
}

export function listUsers(backlogDir: string): User[] {
  return readFile(backlogDir).users;
}

export function getUser(backlogDir: string, id: string): User | null {
  return listUsers(backlogDir).find((u) => u.id === id) ?? null;
}

export interface InviteUserInput {
  email: string;
  display_name?: string;
  role?: UserRole;
  invited_by?: string;
}

// Generate a stable id from the email — slugified, deduplicated against
// existing users. Two users can never share an email; if the same
// email is re-invited we just refresh the token + expiry on the
// existing record.
function deriveId(email: string): string {
  const slug = email.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug.length > 0 ? slug : crypto.randomBytes(6).toString("hex");
}

function newToken(): string {
  // 24 bytes URL-safe base64 ≈ 192 bits of entropy. Enough for an
  // unguessable invitation link without bloating the URL.
  return crypto.randomBytes(24).toString("base64url");
}

// Default invitation TTL: 7 days. Long enough that the recipient has
// time to confirm without keeping a stale token live forever.
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

export function inviteUser(backlogDir: string, input: InviteUserInput): User {
  const file = readFile(backlogDir);
  const now = new Date();
  const expires = new Date(now.getTime() + INVITE_TTL_MS);
  const email = input.email.trim().toLowerCase();
  const existing = file.users.find((u) => u.email.toLowerCase() === email);
  if (existing) {
    // Re-invite: refresh the token + expiry, bump status back to
    // pending if it was removed. Keep display_name / role unless
    // explicitly overridden.
    existing.status = "pending";
    existing.invited_at = now.toISOString();
    existing.invitation_token = newToken();
    existing.invitation_expires_at = expires.toISOString();
    if (input.display_name) existing.display_name = input.display_name;
    if (input.role) existing.role = input.role;
    if (input.invited_by) existing.invited_by = input.invited_by;
    writeFile(backlogDir, file);
    return existing;
  }
  const localPart = email.split("@")[0] ?? email;
  const user: User = {
    id: deriveId(email),
    email,
    display_name: input.display_name?.trim() || localPart,
    role: input.role ?? "member",
    status: "pending",
    invited_at: now.toISOString(),
    invitation_token: newToken(),
    invitation_expires_at: expires.toISOString(),
  };
  if (input.invited_by) user.invited_by = input.invited_by;
  // Collision guard: if the slug already exists for a different email,
  // disambiguate by suffixing a short hash.
  if (file.users.some((u) => u.id === user.id)) {
    user.id = `${user.id}-${crypto.randomBytes(3).toString("hex")}`;
  }
  file.users.push(user);
  writeFile(backlogDir, file);
  return user;
}

export interface UpdateUserInput {
  display_name?: string;
  role?: UserRole;
  status?: User["status"];
}

export function updateUser(backlogDir: string, id: string, input: UpdateUserInput): User {
  const file = readFile(backlogDir);
  const user = file.users.find((u) => u.id === id);
  if (!user) {
    throw new Error(`Unknown user: ${id}`);
  }
  if (input.display_name !== undefined) user.display_name = input.display_name;
  if (input.role !== undefined) user.role = input.role;
  if (input.status !== undefined) user.status = input.status;
  writeFile(backlogDir, file);
  return user;
}

export function deleteUser(backlogDir: string, id: string): void {
  const file = readFile(backlogDir);
  const idx = file.users.findIndex((u) => u.id === id);
  if (idx < 0) {
    throw new Error(`Unknown user: ${id}`);
  }
  file.users.splice(idx, 1);
  writeFile(backlogDir, file);
}

// Confirm an invitation by token. Sets status to "active" and clears
// the token / expiry (one-shot). Throws if the token is invalid or
// the invitation has expired.
export function confirmInvitation(backlogDir: string, token: string): User {
  const file = readFile(backlogDir);
  const user = file.users.find((u) => u.invitation_token === token);
  if (!user) {
    throw new Error("Invalid invitation token");
  }
  if (user.invitation_expires_at && new Date(user.invitation_expires_at).getTime() < Date.now()) {
    throw new Error("Invitation token has expired");
  }
  user.status = "active";
  user.confirmed_at = new Date().toISOString();
  delete user.invitation_token;
  delete user.invitation_expires_at;
  writeFile(backlogDir, file);
  return user;
}

// Re-issue the token + bump expiry without touching anything else.
// Useful when the recipient lost the original invitation link.
export function refreshInvitation(backlogDir: string, id: string): User {
  const file = readFile(backlogDir);
  const user = file.users.find((u) => u.id === id);
  if (!user) {
    throw new Error(`Unknown user: ${id}`);
  }
  if (user.status === "active") {
    throw new Error(`User ${id} is already active`);
  }
  user.invitation_token = newToken();
  user.invitation_expires_at = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  user.invited_at = new Date().toISOString();
  user.status = "pending";
  writeFile(backlogDir, file);
  return user;
}
