// Parsing `git status --porcelain`. The layout is fixed-width — two status
// columns, a space, then the path — so the path starts at index 3 of the *raw*
// line. Trimming first eats the leading blank column of a worktree-only change
// and, with it, the first character of the filename.

const STATUS_PREFIX_LENGTH = 3;
const RENAME_SEPARATOR = " -> ";

function unquote(path: string): string {
  return path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
}

/** The path each status line refers to. Renames report their destination. */
export function parsePorcelainPaths(status: string): string[] {
  const paths: string[] = [];
  for (const line of status.split("\n")) {
    if (line.trim().length === 0) continue;
    const raw = line.slice(STATUS_PREFIX_LENGTH).trim();
    if (!raw) continue;
    const renameIndex = raw.indexOf(RENAME_SEPARATOR);
    const path = renameIndex >= 0 ? raw.slice(renameIndex + RENAME_SEPARATOR.length) : raw;
    const cleaned = unquote(path.trim());
    if (cleaned) paths.push(cleaned);
  }
  return paths;
}

/** True for paths Backlog owns, which never count as the user's local dirt. */
export function isBacklogInternalPath(path: string): boolean {
  return path === ".backlog" || path.startsWith(".backlog/");
}
