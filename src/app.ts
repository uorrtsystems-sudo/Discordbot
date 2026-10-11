import { createDeps as buildDeps } from "./depsFactory.js";
import type { Deps } from "./deps.js";
import type { Env } from "./env.js";
import { handleIntake } from "./intake.js";
import { handleInteraction } from "./interactions.js";
import { json } from "./http.js";

export type { Env };

export function createDeps(env: Env): Deps {
  // Workers fetch throws Illegal invocation unless it is called with the global this.
  return buildDeps(env, globalThis.fetch.bind(globalThis));
}

export async function route(request: Request, env: Env, deps: Deps = createDeps(env)): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "uorrt-dispatch" });
    }
    if (request.method === "POST" && url.pathname === "/interactions") return handleInteraction(request, env, deps);
    if (request.method === "POST" && url.pathname === "/intake") return handleIntake(request, env, deps);
    return json({ error: "Not found" }, 404);
  } catch {
    console.error("request failed");
    return json({ error: "Internal error" }, 500);
  }
}
