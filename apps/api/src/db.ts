import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

/** One pool per process. Supabase: use the Session pooler URL (prepared statements work). */
export function createDb(url: string): Sql {
  return postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 10, types: { bigint: postgres.BigInt } });
}

export interface Claims {
  sub: string;
  role?: string;
  [k: string]: unknown;
}

/**
 * Run queries as the signed-in user so Postgres RLS applies exactly as it would for supabase-js.
 * `claims = null` runs as the anonymous role.
 */
export function asUser<T>(sql: Sql, claims: Claims | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    const role = claims ? "authenticated" : "anon";
    await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims ?? { role })}, true)`;
    await tx.unsafe(`set local role ${role}`);
    return fn(tx);
  }) as Promise<T>;
}

/** Trusted server-side operations (money paths). RLS bypassed; only call audited SQL functions. */
export function asService<T>(sql: Sql, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe("set local role service_role");
    return fn(tx);
  }) as Promise<T>;
}

/** bigint columns come back as BigInt; API responses use plain numbers (cents fit safely). */
export const n = (v: bigint | number | null | undefined) => (v == null ? 0 : Number(v));
