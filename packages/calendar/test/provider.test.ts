import { describe, expect, it } from 'vitest';
import { InMemoryKvStore, NotImplementedError, createLogger } from '@adi-mcp/core';
import type { ExecutionContext } from '@adi-mcp/core';
import type { Env } from '@adi-mcp/shared';
import { calendarProvider } from '../src/index.js';

const ctx: ExecutionContext = {
  userId: 'user-1',
  env: {} as Env,
  kv: new InMemoryKvStore(),
  logger: createLogger({ level: 'error' }),
  requestId: 'req-test',
};

describe('calendarProvider', () => {
  it('declares its id and credential kind', () => {
    expect(calendarProvider.id).toBe('calendar');
    expect(calendarProvider.credential.kind).toBe('oauth2');
    expect(calendarProvider.credential.description.length).toBeGreaterThan(20);
  });

  it('exposes provider-prefixed tools with documented schemas', () => {
    expect(calendarProvider.tools.map((tool) => tool.name).sort()).toEqual([
      'calendar_create_event',
      'calendar_list_events',
    ]);
    for (const tool of calendarProvider.tools) {
      expect(tool.name.startsWith('calendar_')).toBe(true);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toBeDefined();
    }
  });

  it('reports NotImplementedError from every tool rather than crashing', async () => {
    for (const tool of calendarProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(NotImplementedError);
    }
  });

  it('names the tool in its NotImplementedError so the gap is actionable', async () => {
    for (const tool of calendarProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(tool.name);
    }
  });
});

describe('calendar_create_event schema', () => {
  const createEvent = calendarProvider.tools.find((t) => t.name === 'calendar_create_event')!;

  const valid = {
    summary: 'Standup',
    start: '2026-08-01T09:00:00Z',
    end: '2026-08-01T09:30:00Z',
  };

  it('accepts a well-formed event', () => {
    expect(createEvent.inputSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an end that is not after the start', () => {
    expect(
      createEvent.inputSchema.safeParse({ ...valid, end: '2026-08-01T08:00:00Z' }).success,
    ).toBe(false);
  });

  it('rejects an end equal to the start', () => {
    expect(createEvent.inputSchema.safeParse({ ...valid, end: valid.start }).success).toBe(false);
  });

  it('rejects a timestamp without an offset', () => {
    expect(createEvent.inputSchema.safeParse({ ...valid, start: '2026-08-01 09:00' }).success).toBe(
      false,
    );
  });

  it('defaults calendarId to primary', () => {
    const parsed = createEvent.inputSchema.parse(valid) as { calendarId: string };
    expect(parsed.calendarId).toBe('primary');
  });

  it('rejects a malformed attendee address', () => {
    expect(
      createEvent.inputSchema.safeParse({ ...valid, attendees: ['not-an-email'] }).success,
    ).toBe(false);
  });
});
