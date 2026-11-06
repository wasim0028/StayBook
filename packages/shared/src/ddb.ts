import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export interface DdbContext {
  doc: DynamoDBDocumentClient;
  raw: DynamoDBClient;
  table: string;
}

/**
 * Document client configured for the single `Marketplace` table.
 * DYNAMODB_ENDPOINT is only for local/integration tests; in EKS the SDK resolves the regional
 * endpoint, which the VPC gateway endpoint routes privately.
 */
export function ddbFromEnv(): DdbContext {
  const table = process.env.TABLE_NAME;
  if (!table) throw new Error("TABLE_NAME must be set");
  const raw = new DynamoDBClient({
    region: process.env.AWS_REGION ?? "ap-south-1",
    endpoint: process.env.DYNAMODB_ENDPOINT || undefined,
    maxAttempts: 5,
  });
  const doc = DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false },
  });
  return { doc, raw, table };
}

export async function ddbReady(ctx: DdbContext): Promise<void> {
  await ctx.raw.send(new DescribeTableCommand({ TableName: ctx.table }));
}

export function isConditionalFailure(e: unknown): boolean {
  const name = (e as { name?: string })?.name;
  return name === "ConditionalCheckFailedException" || name === "TransactionCanceledException";
}

/** Opaque, URL-safe pagination cursor. */
export function encodeCursor(key: Record<string, unknown> | undefined): string | undefined {
  return key ? Buffer.from(JSON.stringify(key)).toString("base64url") : undefined;
}

export function decodeCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return v && typeof v === "object" ? v : undefined;
  } catch {
    return undefined;
  }
}
