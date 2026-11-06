export const dynamic = "force-dynamic";

/** Liveness: the Node process is serving requests. */
export function GET() {
  return Response.json({ status: "ok" });
}
