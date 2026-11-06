import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { createServer } from "node:net";
import { CreateTableCommand, DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { AuthUser, DdbContext, TokenVerifier } from "@mp/shared";

/**
 * Integration tests run against moto's DynamoDB server (pip install "moto[server,dynamodb]").
 * Unlike dynalite it implements TransactWriteItems with per-item CancellationReasons, which
 * booking and payment code depend on. Set MOTO_SERVER to override the binary path.
 *
 * The table mirrors infra/terraform/dynamodb.tf. Keep the two in sync.
 */

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

async function waitReady(client: DynamoDBClient, proc: ChildProcess, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`moto_server exited with code ${proc.exitCode}`);
    try {
      await client.send(new ListTablesCommand({}));
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error(`moto_server did not start: ${(lastErr as Error)?.message}`);
}

const MOTO_SINGLE_THREADED = [
  "import sys",
  "from werkzeug.serving import run_simple",
  "from moto.server import DomainDispatcherApplication, create_backend_app",
  "run_simple(sys.argv[1], int(sys.argv[2]), DomainDispatcherApplication(create_backend_app), threaded=False, use_reloader=False)",
].join("\n");

/** The Python that has moto installed: the interpreter in moto_server's shebang, else python3. */
function motoPython(): string {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const f = join(dir, "moto_server");
    if (!existsSync(f)) continue;
    const first = readFileSync(f, "utf8").split("\n", 1)[0] ?? "";
    const m = /^#!\s*(\S+)/.exec(first);
    if (m && !m[1]!.endsWith("/env")) return m[1]!;
    break;
  }
  return "python3";
}

export const TABLE_GSIS = ["GSI1", "GSI2", "GSI3", "GSI4", "GSI5"] as const;

export async function startTestDb(): Promise<DdbContext & { stop: () => Promise<void> }> {
  const port = await freePort();
  // moto_server handles requests on several threads, and its TransactWriteItems isn't safe under
  // that: concurrent transactions can crash it (HTML 500s). DynamoDB executes each transaction
  // atomically, so run moto single-threaded to match. MOTO_SERVER still overrides the binary.
  const proc = process.env.MOTO_SERVER
    ? spawn(process.env.MOTO_SERVER, ["-H", "127.0.0.1", "-p", String(port)], { stdio: ["ignore", "ignore", "pipe"] })
    : spawn(motoPython(), ["-c", MOTO_SINGLE_THREADED, "127.0.0.1", String(port)], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr?.on("data", (d) => (stderr = (stderr + String(d)).slice(-2000)));
  proc.on("error", (e) => (stderr += `\n${e.message}`));

  const raw = new DynamoDBClient({
    region: "ap-south-1",
    endpoint: `http://127.0.0.1:${port}`,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    maxAttempts: 1,
  });

  try {
    await waitReady(raw, proc);
  } catch (e) {
    proc.kill("SIGKILL");
    throw new Error(`${(e as Error).message}\n${stderr}\nInstall with: pip install "moto[server,dynamodb]"`);
  }

  const table = "Marketplace-test";
  const s = (n: string) => ({ AttributeName: n, AttributeType: "S" as const });
  const gsi = (name: string) => ({
    IndexName: name,
    KeySchema: [
      { AttributeName: `${name}PK`, KeyType: "HASH" as const },
      { AttributeName: `${name}SK`, KeyType: "RANGE" as const },
    ],
    // Terraform projects GSI3 with INCLUDE and GSI4 with KEYS_ONLY; ALL is a superset and fine for tests.
    Projection: { ProjectionType: "ALL" as const },
  });

  await raw.send(
    new CreateTableCommand({
      TableName: table,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [s("PK"), s("SK"), ...TABLE_GSIS.flatMap((g) => [s(`${g}PK`), s(`${g}SK`)])],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: TABLE_GSIS.map(gsi),
    }),
  );

  const doc = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });
  return {
    raw,
    doc,
    table,
    stop: async () => {
      raw.destroy();
      if (proc.exitCode === null) {
        await new Promise<void>((resolve) => {
          proc.once("exit", () => resolve());
          proc.kill("SIGTERM");
          setTimeout(() => proc.kill("SIGKILL"), 2000).unref();
        });
      }
    },
  };
}

/** Test verifier: token "user:<sub>:<group1>,<group2>" becomes that user; anything else is rejected. */
export const fakeVerifier: TokenVerifier = {
  async verify(token: string): Promise<AuthUser> {
    const m = /^user:([^:]+):?(.*)$/.exec(token);
    if (!m) throw new Error("bad token");
    const groups = (m[2] ?? "").split(",").filter(Boolean) as AuthUser["groups"];
    return { sub: m[1]!, groups };
  },
};

export const bearer = (sub: string, ...groups: string[]) => ({
  authorization: `Bearer user:${sub}:${groups.join(",")}`,
});
