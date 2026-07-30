import { describe, expect, it, vi } from 'vitest';
import { createLogger, type LogLevel } from '../src/logger.js';

function makeSink() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies Record<LogLevel, ReturnType<typeof vi.fn>>;
}

describe('createLogger', () => {
  it('emits JSON lines with timestamp, level, and message', () => {
    const sink = makeSink();
    const logger = createLogger({ level: 'debug', sink });

    logger.info('hello world', { foo: 'bar' });

    expect(sink.info).toHaveBeenCalledTimes(1);
    const line = sink.info.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('hello world');
    expect(parsed.foo).toBe('bar');
    expect(typeof parsed.timestamp).toBe('string');
  });

  it('suppresses log levels below the configured threshold', () => {
    const sink = makeSink();
    const logger = createLogger({ level: 'warn', sink });

    logger.debug('should be suppressed');
    logger.info('should be suppressed too');
    logger.warn('shows up');
    logger.error('shows up too');

    expect(sink.debug).not.toHaveBeenCalled();
    expect(sink.info).not.toHaveBeenCalled();
    expect(sink.warn).toHaveBeenCalledTimes(1);
    expect(sink.error).toHaveBeenCalledTimes(1);
  });

  it('defaults to info level', () => {
    const sink = makeSink();
    const logger = createLogger({ sink });

    logger.debug('suppressed');
    logger.info('shown');

    expect(sink.debug).not.toHaveBeenCalled();
    expect(sink.info).toHaveBeenCalledTimes(1);
  });

  it('child() merges bindings into every subsequent log line', () => {
    const sink = makeSink();
    const logger = createLogger({ level: 'debug', sink, bindings: { service: 'adi-mcp' } });
    const child = logger.child({ requestId: 'req-1' });

    child.info('child log');

    const line = sink.info.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.service).toBe('adi-mcp');
    expect(parsed.requestId).toBe('req-1');
  });

  it('per-call meta overrides bindings with the same key', () => {
    const sink = makeSink();
    const logger = createLogger({ level: 'debug', sink, bindings: { scope: 'outer' } });

    logger.info('msg', { scope: 'inner' });

    const line = sink.info.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.scope).toBe('inner');
  });
});
