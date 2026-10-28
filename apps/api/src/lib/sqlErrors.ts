// SQL Server error numbers the API turns into answers.

function errorNumber(error: unknown): number | undefined {
  const e = error as { number?: unknown; originalError?: { info?: { number?: unknown } } };
  const n = e.number ?? e.originalError?.info?.number;
  return typeof n === 'number' ? n : undefined;
}

/** A primary key or unique index already holds the value. */
export function isUniqueViolation(error: unknown): boolean {
  const n = errorNumber(error);
  return n === 2627 || n === 2601;
}

/** A foreign key points at a row that does not exist (in this organisation). */
export function isForeignKeyViolation(error: unknown): boolean {
  return errorNumber(error) === 547;
}
