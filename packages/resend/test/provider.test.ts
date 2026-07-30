import { describe, expect, it } from 'vitest';
import { InMemoryKvStore, NotImplementedError, createLogger } from '@adi-mcp/core';
import type { ExecutionContext } from '@adi-mcp/core';
import type { Env } from '@adi-mcp/shared';
import { resendProvider } from '../src/index.js';

const ctx: ExecutionContext = {
  userId: 'user-1',
  env: {} as Env,
  kv: new InMemoryKvStore(),
  logger: createLogger({ level: 'error' }),
  requestId: 'req-test',
};

describe('resendProvider', () => {
  it('declares its id and credential kind', () => {
    expect(resendProvider.id).toBe('resend');
    expect(resendProvider.credential.kind).toBe('api-key');
    expect(resendProvider.credential.description.length).toBeGreaterThan(20);
  });

  it('exposes provider-prefixed tools with documented schemas', () => {
    expect(resendProvider.tools.map((tool) => tool.name).sort()).toEqual([
      'resend_get_email_status',
      'resend_send_email',
    ]);
    for (const tool of resendProvider.tools) {
      expect(tool.name.startsWith('resend_')).toBe(true);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toBeDefined();
    }
  });

  it('reports NotImplementedError from every tool rather than crashing', async () => {
    for (const tool of resendProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(NotImplementedError);
    }
  });

  it('names the tool in its NotImplementedError so the gap is actionable', async () => {
    for (const tool of resendProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(tool.name);
    }
  });
});

describe('resend_send_email schema', () => {
  const sendEmail = resendProvider.tools.find((t) => t.name === 'resend_send_email')!;

  const base = { from: 'me@verified.com', to: ['you@example.com'], subject: 'Hi' };

  it('accepts a message with a text body', () => {
    expect(sendEmail.inputSchema.safeParse({ ...base, text: 'hello' }).success).toBe(true);
  });

  it('accepts a message with an html body', () => {
    expect(sendEmail.inputSchema.safeParse({ ...base, html: '<p>hi</p>' }).success).toBe(true);
  });

  it('rejects a message with neither html nor text', () => {
    expect(sendEmail.inputSchema.safeParse(base).success).toBe(false);
  });

  it('rejects an empty recipient list', () => {
    expect(sendEmail.inputSchema.safeParse({ ...base, to: [], text: 'x' }).success).toBe(false);
  });

  it('rejects a malformed recipient address', () => {
    expect(
      sendEmail.inputSchema.safeParse({ ...base, to: ['not-an-email'], text: 'x' }).success,
    ).toBe(false);
  });
});
