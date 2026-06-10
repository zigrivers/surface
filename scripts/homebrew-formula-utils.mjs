export function formulaString(formulaSource, field, sourcePath = "Homebrew formula") {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = formulaSource.match(new RegExp(`^\\s*${escapedField}\\s+['"]([^'"]+)['"]`, "mu"));

  if (match?.[1] === undefined || match[1].trim().length === 0) {
    throw new Error(`Could not find ${field} in ${sourcePath}.`);
  }

  return match[1];
}
