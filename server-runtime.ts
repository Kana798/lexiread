import path from 'node:path';

export interface ServerRuntimeOptions {
  cwd: string;
  env: Record<string, string | undefined>;
}

export function resolveServerRuntime({ cwd, env }: ServerRuntimeOptions) {
  const appRoot = env.LEXI_APP_ROOT || cwd;
  return {
    appRoot,
    distPath: appRoot + (appRoot.endsWith('/') || appRoot.endsWith('\\') ? '' : '/') + 'dist',
    envPath: env.LEXI_ENV_PATH,
    // Loopback by default: the API proxies paid provider credentials and has no
    // authentication, so exposing it on every network interface would let any
    // page on the LAN burn the user's quota. Set LEXI_BIND_HOST=0.0.0.0 to
    // deliberately opt into LAN access.
    bindHost: env.LEXI_BIND_HOST || '127.0.0.1',
  };
}
