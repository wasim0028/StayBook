import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { ZodError, type ZodTypeAny, type z } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, "VALIDATION_FAILED", "request validation failed", r.error.flatten());
  return r.data;
}

export interface HealthCheck {
  (): Promise<void>;
}

/**
 * Fastify instance with the house conventions:
 * structured JSON logs (with secrets redacted), consistent error envelope,
 * liveness/readiness endpoints, and graceful drain on SIGTERM.
 */
export function createServer(opts: { name: string; ready?: HealthCheck; logger?: FastifyServerOptions["logger"] }) {
  const app = Fastify({
    logger: opts.logger ?? {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization", "req.headers.cookie"],
      base: { service: opts.name },
    },
    trustProxy: true, // behind the ALB
    bodyLimit: 1_048_576,
    requestIdHeader: "x-request-id",
    genReqId: () => crypto.randomUUID(),
  });

  let draining = false;

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: "VALIDATION_FAILED", message: "invalid input", details: err.flatten() } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: "BAD_REQUEST", message: err.message } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: { code: "INTERNAL", message: "internal error", requestId: req.id } });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: { code: "NOT_FOUND", message: "route not found" } });
  });

  app.get("/healthz/live", async () => ({ ok: true }));
  app.get("/healthz/ready", async (_req, reply) => {
    if (draining) return reply.status(503).send({ ok: false, reason: "draining" });
    try {
      await opts.ready?.();
      return { ok: true };
    } catch (e) {
      return reply.status(503).send({ ok: false, reason: (e as Error).message });
    }
  });

  const markDraining = () => {
    draining = true;
  };
  return { app, markDraining };
}

/** Starts listening and wires SIGTERM: fail readiness, wait for the ALB to deregister, then close. */
export async function start(
  app: FastifyInstance,
  markDraining: () => void,
  port = Number(process.env.PORT ?? 8080),
): Promise<void> {
  const drainMs = Number(process.env.SHUTDOWN_DRAIN_MS ?? 15_000);
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    markDraining();
    await new Promise((r) => setTimeout(r, drainMs));
    await app.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  await app.listen({ host: "0.0.0.0", port });
}
