import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import ts from 'typescript';
import { it } from 'vitest';

it('runs the shared Supabase transports in workerd without following credential-bearing redirects', () => {
  const require = createRequire(import.meta.url);
  const wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
  const workerd = wranglerRequire('workerd') as { default: string };
  const directory = mkdtempSync(join(tmpdir(), 'autopw3-identity-workerd-'));
  const files = [
    'workerd.capnp',
    'rpc.js',
    'postgrest.js',
    'supabase-fetch.js',
    'test.js',
    'mock.js',
    'config.capnp',
    'output.log',
  ];
  let output: number | undefined;
  try {
    copyFileSync(
      wranglerRequire.resolve('workerd/workerd.capnp'),
      join(directory, 'workerd.capnp'),
    );
    for (const [source, destination] of [
      ['../db/supabase-rpc.ts', 'rpc.js'],
      ['../db/postgrest.ts', 'postgrest.js'],
      ['../db/supabase-fetch.ts', 'supabase-fetch.js'],
    ] as const) {
      const code = readFileSync(new URL(source, import.meta.url), 'utf8');
      writeFileSync(
        join(directory, destination),
        ts.transpileModule(code, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
        }).outputText,
      );
    }
    writeFileSync(
      join(directory, 'test.js'),
      `
      import { SupabaseRpcClient } from './rpc.js';
      import { AuthenticatedPostgrestClient } from './postgrest.js';
      function check(ok) { if (!ok) throw new Error('fixture_assertion_failed'); }
      export default { async test() {
        let unsupported = false;
        try { new Request('https://fixture.invalid/', { redirect: 'error' }); }
        catch (error) { unsupported = error instanceof TypeError; }
        check(unsupported);
        const holder = { fetcher: globalThis.fetch };
        let wrongReceiver = false;
        try { await holder.fetcher('https://fixture.invalid/', { redirect: 'manual' }); }
        catch (error) { wrongReceiver = error instanceof TypeError; }
        check(wrongReceiver);
        const rpc = new SupabaseRpcClient('https://fixture.invalid', 'fixture-key');
        check((await rpc.call('worker_check_rate_limit', {}))[0]?.allowed === true);
        const user = new AuthenticatedPostgrestClient('https://fixture.invalid', 'fixture-key', 'fixture-user-token');
        check((await user.select('user_profiles', new URLSearchParams()))[0]?.user_id === 'fixture-user');
        check((await user.select('household_members', new URLSearchParams()))[0]?.role === 'ADMIN');
        for (const status of [301, 302, 303, 307, 308]) {
          let rpcError;
          try { await rpc.call('redirect' + status, {}); } catch (error) { rpcError = error; }
          check(rpcError?.name === 'SupabaseRpcError' && rpcError?.status === 0);
          let userError;
          try { await user.select('redirect' + status, new URLSearchParams()); } catch (error) { userError = error; }
          check(userError?.name === 'SupabasePostgrestError' && userError?.status === 0);
        }
        const stats = await (await globalThis.fetch('https://fixture.invalid/hits', { redirect: 'manual' })).json();
        check(stats.destinationHits === 0 && stats.rpc === 1 && stats.profile === 1 && stats.membership === 1);
      }};
    `,
    );
    // All outbound fetches terminate at this in-process fixture Worker, never the internet.
    writeFileSync(
      join(directory, 'mock.js'),
      `
      let destinationHits = 0;
      const counts = { rpc: 0, profile: 0, membership: 0 };
      export default { async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/destination') { destinationHits++; return Response.json({}); }
        if (url.pathname === '/hits') return Response.json({ destinationHits, ...counts });
        if (request.headers.get('apikey') !== 'fixture-key') throw new Error('fixture_headers_failed');
        const isRpc = url.pathname.startsWith('/rest/v1/rpc/');
        if (request.headers.get('authorization') !== 'Bearer ' + (isRpc ? 'fixture-key' : 'fixture-user-token'))
          throw new Error('fixture_headers_failed');
        const redirect = /redirect(301|302|303|307|308)/.exec(url.pathname);
        if (redirect) return new Response(null, { status: Number(redirect[1]), headers: { location: 'https://redirect-fixture.invalid/destination' } });
        if (isRpc) { counts.rpc++; return Response.json([{ allowed: true, retry_after_seconds: 60 }]); }
        if (url.pathname === '/rest/v1/household_members') { counts.membership++; return Response.json([{ role: 'ADMIN' }]); }
        counts.profile++; return Response.json([{ user_id: 'fixture-user' }]);
      }};
    `,
    );
    writeFileSync(
      join(directory, 'config.capnp'),
      `
      using Workerd = import "workerd.capnp";
      const config :Workerd.Config = (services = [
        (name="identity",worker=(compatibilityDate="2026-10-01",globalOutbound="mock",modules=[
          (name="test.js",esModule=embed "test.js"),
          (name="rpc.js",esModule=embed "rpc.js"),
          (name="postgrest.js",esModule=embed "postgrest.js"),
          (name="supabase-fetch",esModule=embed "supabase-fetch.js")
        ])),
        (name="mock",worker=(compatibilityDate="2026-10-01",modules=[(name="mock.js",esModule=embed "mock.js")]))
      ]);
    `,
    );
    // File-backed stdio avoids Windows sandbox pipe restrictions; no assertions are skipped.
    output = openSync(join(directory, 'output.log'), 'w');
    execFileSync(workerd.default, ['test', join(directory, 'config.capnp'), 'identity'], {
      stdio: ['ignore', output, output],
      windowsHide: true,
      timeout: 20_000,
    });
  } finally {
    if (output !== undefined) closeSync(output);
    for (const file of files)
      if (existsSync(join(directory, file))) unlinkSync(join(directory, file));
    rmdirSync(directory);
  }
}, 25_000);
