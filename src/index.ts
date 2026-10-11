import { createDeps, route } from "./app.js";
import type { Env } from "./env.js";
import { runScheduled } from "./scheduled.js";

export interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  async fetch(request: Request, env: Env, _ctx: WorkerContext): Promise<Response> {
    return route(request, env);
  },
  async scheduled(
    _event: { cron: string; scheduledTime: number },
    env: Env,
    ctx: WorkerContext,
  ): Promise<void> {
    ctx.waitUntil(runScheduled(env, createDeps(env)));
  },
};
