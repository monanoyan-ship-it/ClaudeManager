/**
 * Path normalization utility to prevent duplicate project entries.
 * Converts Windows paths to a consistent format.
 */

function normalizePath(inputPath) {
  if (!inputPath) return inputPath;

  let normalized = inputPath
    // Backslash → forward slash
    .replace(/\\/g, '/')
    // Remove trailing slash (but keep root "/" or "C:/")
    .replace(/\/+$/, '');

  // Lowercase drive letter for consistency (C:/ → c:/)
  normalized = normalized.replace(/^([A-Z]):/, (_, letter) => letter.toLowerCase() + ':');

  return normalized;
}

module.exports = { normalizePath };
