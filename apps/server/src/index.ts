import type { Env } from '@adi-mcp/shared';
import { createApp } from './app.js';

export { createApp } from './app.js';
export { createProviderRegistry } from './providers.js';

// Built once per isolate rather than per request: provider definitions are static, so
// rebuilding the registry on every request would be wasted work.
const app = createApp();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;
