import { z } from "zod";

// Human collaborators on a workspace. Distinct from agents — these are
// real people who can be assigned a task as the responsible reviewer
// or implementer. They show up in the sub-task assignee dropdown
// alongside AI agents.
//
// Status lifecycle:
//   - "pending"  — invitation sent, the user hasn't confirmed yet
//   - "active"   — the user has accepted; can be assigned tasks
//   - "removed"  — soft-removed; kept for historical assignments but
//                  no longer offered as an assignee
//
// Email + invitation_token: the token is generated at invite time and
// embedded in a confirmation URL. Until the backend has SMTP wired,
// the URL is shown to the inviter so they can share it manually.

export const userRoleSchema = z.enum(["owner", "admin", "member", "guest"]);

export const userStatusSchema = z.enum(["pending", "active", "removed"]);

export const userSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  display_name: z.string().min(1),
  role: userRoleSchema.default("member"),
  status: userStatusSchema.default("pending"),
  invited_at: z.string(),
  invited_by: z.string().optional(),
  confirmed_at: z.string().optional(),
  invitation_token: z.string().optional(),
  invitation_expires_at: z.string().optional(),
});

export const usersFileSchema = z.object({
  version: z.literal(1),
  users: z.array(userSchema).default([]),
});

export type UserRole = z.infer<typeof userRoleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
export type User = z.infer<typeof userSchema>;
export type UsersFile = z.infer<typeof usersFileSchema>;
