import picomatch from "picomatch";

export function scopeMatchesPath(scope: string, relativePath: string): boolean {
  if (scope === "**") {
    return true;
  }
  return picomatch(scope, { dot: true })(relativePath);
}

export function pathsCoveredByScopes(scopes: string[], paths: string[]): string[] {
  return paths.filter((candidate) => !scopes.some((scope) => scopeMatchesPath(scope, candidate)));
}
