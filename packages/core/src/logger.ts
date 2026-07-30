export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  /** Returns a child logger that merges `bindings` into every log line's metadata. */
  child(bindings: Record<string, unknown>): Logger;
}

export interface CreateLoggerOptions {
  readonly level?: LogLevel;
  readonly bindings?: Record<string, unknown>;
  /** Injectable sink, defaults to console.*. Tests can pass a stub to assert on output. */
  readonly sink?: Record<LogLevel, (line: string) => void>;
}

const defaultSink: Record<LogLevel, (line: string) => void> = {
  debug: (line) => console.debug(line),
  info: (line) => console.info(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

/** Structured JSON logger. Works identically under Workers `console` and Node/Vitest. */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const bindings = options.bindings ?? {};
  const sink = options.sink ?? defaultSink;

  function log(logLevel: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[logLevel] < LEVEL_WEIGHT[level]) return;
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level: logLevel,
      message,
      ...bindings,
      ...meta,
    });
    sink[logLevel](line);
  }

  return {
    debug: (message, meta) => log('debug', message, meta),
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta),
    child: (childBindings) =>
      createLogger({ level, sink, bindings: { ...bindings, ...childBindings } }),
  };
}
