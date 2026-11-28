import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, openSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const E2E_ROOT = resolve(here, "..");
export const REPO = resolve(E2E_ROOT, "../..");
export const WEB = join(REPO, "apps/web");
export const OUT = join(E2E_ROOT, "out", process.env.E2E_STACK ?? "swarm");

const CONVEX_PORT = Number(process.env.E2E_CONVEX_PORT ?? 3610);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4290);
export const RELAY_URL = `http://127.0.0.1:${process.env.E2E_RELAY_PORT ?? 8791}`;
const DIST = { WAKU_DIST_DIR: `dist-e2e-${WEB_PORT}`, WAKU_REACT_PROFILING: process.env.E2E_PROFILING ?? "0", WAKU_PUBLIC_NOTES_RELAY_URL: RELAY_URL };

const CAP = { GOMAXPROCS: process.env.E2E_BUILD_THREADS ?? "4", TOKIO_WORKER_THREADS: process.env.E2E_BUILD_THREADS ?? "4", UV_THREADPOOL_SIZE: "4" };

export type Stack = { base: string; convexUrl: string; scratch: string; pids: number[] };

export const stackFile = join(OUT, "stack.json");

export const readStack = () => JSON.parse(readFileSync(stackFile, "utf8")) as Stack;

const answers = async (url: string) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.status < 500;
  } catch {
    return false;
  }
};

const waitFor = async (what: string, url: string, ms: number) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await answers(url)) return;
    await new Promise((settle) => setTimeout(settle, 300));
  }
  throw new Error(`${what} did not answer at ${url} within ${ms} ms`);
};

const run = (what: string, command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...CAP, ...env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${what} failed:\n${result.stdout}\n${result.stderr}`);
  console.log(`[e2e] ${what} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  return result.stdout;
};

const detach = (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, log: string) => {
  const out = openSync(log, "a");
  const child = spawn(command, args, { cwd, env: { ...process.env, ...CAP, ...env }, detached: true, stdio: ["ignore", out, out] });
  child.unref();
  return child;
};

export const convexRun = (scratch: string, fn: string, args: unknown = {}) =>
  run(`convex run ${fn}`, "npx", ["convex", "run", fn, JSON.stringify(args)], scratch, { CONVEX_AGENT_MODE: "anonymous" });

export const startStack = async () => {
  mkdirSync(OUT, { recursive: true });
  const base = `http://localhost:${WEB_PORT}`;
  const convexUrl = `http://127.0.0.1:${CONVEX_PORT}`;
  const scratch = process.env.E2E_SCRATCH ?? join(tmpdir(), `lifeos-e2e-backend-${CONVEX_PORT}`);
  if (process.env.E2E_REUSE === "1" && existsSync(stackFile) && (await answers(base.replace("localhost", "127.0.0.1"))) && (await answers(`${convexUrl}/version`))) {
    console.log(`[e2e] reusing the stack at ${base}`);
    return readStack();
  }
  const taken = async () => (await answers(base.replace("localhost", "127.0.0.1"))) || (await answers(`${convexUrl}/version`));
  for (let tries = 0; tries < 30 && (await taken()); tries += 1) await new Promise((settle) => setTimeout(settle, 500));
  if (await taken())
    throw new Error(`Port ${WEB_PORT} or ${CONVEX_PORT} is taken. Stop the old stack (pnpm e2e:stop) or set E2E_WEB_PORT and E2E_CONVEX_PORT.`);
  const ports = `--local-cloud-port ${CONVEX_PORT} --local-site-port ${CONVEX_PORT + 1}`;
  run("seed a throwaway local backend", "sh", [join(WEB, "scripts/local-backend.sh")], WEB, { SCRATCH: scratch, BASE: base, CONVEX_PORTS: ports });
  if (process.env.E2E_BULK === "1") convexRun(scratch, "scratch:seedBulk", { today: new Date().toLocaleDateString("en-CA"), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  const backend = detach("npx", ["convex", "dev", "--typecheck", "disable", ...ports.split(" ")], scratch, { CONVEX_AGENT_MODE: "anonymous" }, join(OUT, "backend.log"));
  await waitFor("the local backend", `${convexUrl}/version`, 120_000);
  if (process.env.E2E_SKIP_BUILD !== "1")
    run("build the web app against it", "npx", ["waku", "build"], WEB, { ...DIST, WAKU_PUBLIC_CONVEX_URL: convexUrl, NODE_ENV: "production" });
  const web = detach("npx", ["waku", "start", "--port", String(WEB_PORT)], WEB, { ...DIST, WAKU_PUBLIC_CONVEX_URL: convexUrl }, join(OUT, "web.log"));
  await waitFor("waku start", base.replace("localhost", "127.0.0.1"), 60_000);
  const stack = { base, convexUrl, scratch, pids: [backend.pid, web.pid].flatMap((pid) => (pid === undefined ? [] : [pid])) } satisfies Stack;
  writeFileSync(stackFile, JSON.stringify(stack, null, 2));
  return stack;
};

export const stopStack = (stack: Stack) => {
  for (const pid of stack.pids) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {}
  }
};
