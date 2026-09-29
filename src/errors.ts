/** Exit codes. They are part of the CLI contract (AGENTS.md): never renumber one. */
export const EXIT = {
  ok: 0,
  internal: 1,
  usage: 2,
  remote: 3,
  notFound: 4,
  refused: 5,
  toolError: 6,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** An error uvd reports on purpose: a stable `code`, a message for humans and an exit code. */
export class UvdError extends Error {
  readonly code: string;
  readonly exitCode: ExitCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, exitCode: ExitCode, details?: Record<string, unknown>) {
    super(message);
    this.name = 'UvdError';
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function usage(message: string): UvdError {
  return new UvdError('usage', message, EXIT.usage);
}
