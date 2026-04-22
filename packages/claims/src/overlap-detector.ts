function staticPrefix(scope: string): string {
  let wildcardIndex = scope.length;
  for (const token of ["*", "?", "["]) {
    const index = scope.indexOf(token);
    if (index !== -1) {
      wildcardIndex = Math.min(wildcardIndex, index);
    }
  }
  return scope.slice(0, wildcardIndex).replace(/\/$/, "");
}

export function scopesOverlap(left: string, right: string): boolean {
  if (left === "**" || right === "**") {
    return true;
  }

  const leftHasGlob = /[*?[]/.test(left);
  const rightHasGlob = /[*?[]/.test(right);

  if (!leftHasGlob && !rightHasGlob) {
    return (
      left === right ||
      left.startsWith(`${right}/`) ||
      right.startsWith(`${left}/`)
    );
  }

  const leftPrefix = staticPrefix(left);
  const rightPrefix = staticPrefix(right);
  if (!leftPrefix || !rightPrefix) {
    return true;
  }

  return (
    leftPrefix === rightPrefix ||
    leftPrefix.startsWith(`${rightPrefix}/`) ||
    rightPrefix.startsWith(`${leftPrefix}/`)
  );
}
