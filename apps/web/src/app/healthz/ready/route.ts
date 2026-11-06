import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Readiness: required configuration is present. Upstream API health is the API's own probe's job. */
export function GET() {
  try {
    env.apiUrl();
    env.appUrl();
    env.cognitoDomain();
    env.clientId();
    return Response.json({ status: "ready" });
  } catch (e) {
    return Response.json({ status: "misconfigured", error: (e as Error).message }, { status: 503 });
  }
}
