/**
 * Schema-introspecting payload builder for the generic resource CRUD surface.
 *
 * `mandir-api/resources` exposes CRUD over 40+ tenant tables and introspects its
 * column list from `information_schema` at runtime. Hand-writing a create
 * payload per table would encode the same assumptions the API already makes, so
 * the fixture is derived from the schema instead: required columns, their
 * types, their CHECK constraints and their foreign keys.
 *
 * That is also what makes the suite worth running. A column that is NOT NULL in
 * the database but absent from the form is exactly the "saved fine, row never
 * appeared" class of defect this codebase has hit repeatedly — building the
 * payload from the schema means the test asks for what the table actually
 * demands, not what a screen happens to send.
 */
import { psql } from './lib.mjs';

const rand = () => Math.floor(Math.random() * 900000 + 100000);

/** Columns the API/DB owns; never sent in a create payload. */
const MANAGED = new Set([
  'id', 'created_at', 'updated_at', 'deleted_at', 'created_by', 'updated_by',
  'tenant_id', 'invoice_no', 'fy',
]);

/** @returns {{name:string,type:string,nullable:boolean,hasDefault:boolean}[]} */
export function columnsOf(schema, table) {
  return psql(
    `SELECT column_name, data_type, is_nullable, (column_default IS NOT NULL)::text,
            COALESCE(character_maximum_length, 0)
       FROM information_schema.columns
      WHERE table_schema = '${schema}' AND table_name = '${table}'
      ORDER BY ordinal_position`,
  ).map(([name, type, nullable, hasDefault, maxLen]) => ({
    name, type, nullable: nullable === 'YES', hasDefault: hasDefault === 'true',
    maxLen: Number(maxLen) || 0,
  }));
}

/** Single-column UNIQUE constraints — a second row must not reuse the value. */
export function uniqueColumns(schema, table) {
  const out = new Set();
  for (const [def] of psql(
    `SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = '${schema}' AND t.relname = '${table}' AND c.contype = 'u'`,
  )) {
    const cols = def.match(/UNIQUE \(([^)]+)\)/)?.[1];
    if (cols && !cols.includes(',')) out.add(cols.trim());
  }
  return out;
}

/** Allowed values parsed out of a CHECK (col IN ('a','b')) constraint. */
export function checkOptions(schema, table) {
  const out = {};
  for (const [def] of psql(
    `SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = '${schema}' AND t.relname = '${table}' AND c.contype = 'c'`,
  )) {
    // CHECK (((status)::text = ANY ((ARRAY['a'::character varying, ...])::text[])))
    const col = def.match(/\(\(?([a-z_]+)\)?::/)?.[1] ?? def.match(/\(([a-z_]+)\s/)?.[1];
    const vals = [...def.matchAll(/'([^']+)'::/g)].map((m) => m[1]);
    if (col && vals.length) out[col] = vals;
  }
  return out;
}

/** column -> referenced table, for foreign keys. */
export function foreignKeys(schema, table) {
  const out = {};
  for (const [col, refTable] of psql(
    `SELECT att.attname, ref.relname
       FROM pg_constraint c
       JOIN pg_class t   ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_class ref ON ref.oid = c.confrelid
       JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute att ON att.attrelid = t.oid AND att.attnum = k.attnum
      WHERE n.nspname = '${schema}' AND t.relname = '${table}' AND c.contype = 'f'`,
  )) out[col] = refTable;
  return out;
}

/** An existing row id from a referenced table, or null when it is empty. */
function anyId(schema, table) {
  try {
    const rows = psql(`SELECT id FROM ${schema}.${table} LIMIT 1`);
    return rows[0]?.[0] ?? null;
  } catch {
    return null;
  }
}

/** A value that satisfies this column's type and constraints. */
function valueFor(col, opts, fks, schema, tag, uniques = new Set()) {
  if (opts[col.name]?.length) return opts[col.name][0];
  if (fks[col.name]) return anyId(schema, fks[col.name]);

  const t = col.type;
  // A UNIQUE date column (annadaan_entries has one entry per day) cannot reuse
  // today's date on a second run — spread these across a far-future window.
  if (t === 'date' && uniques.has(col.name)) {
    const days = 2000 + Math.floor(Math.random() * 6000);
    return new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  }
  if (/^(integer|bigint|smallint)$/.test(t)) return col.name.endsWith('_paise') ? 10000 : 1;
  if (/^(numeric|real|double precision)$/.test(t)) return 1;
  if (t === 'boolean') return false;
  if (t === 'date') return new Date().toISOString().slice(0, 10);
  if (/timestamp/.test(t)) return new Date().toISOString();
  if (t === 'ARRAY') return [];
  if (t === 'jsonb' || t === 'json') return {};
  if (t === 'uuid') return null;
  // Text-ish. Keep it short: several columns are varchar(10)–varchar(20).
  if (/mobile|phone/.test(col.name)) return `9${String(rand()).padStart(9, '0')}`.slice(0, 10);
  if (/email/.test(col.name)) return `qa${rand()}@example.com`;
  if (/pincode/.test(col.name)) return '411001';
  // varchar(10) columns are common here (sac_code, codes, short refs); an
  // over-long fixture value gets a correct "too long" refusal from the API and
  // reads as a product failure.
  return fit(`QA${tag}`, col.maxLen);
}

/** Trim a value to a column's declared length, keeping it recognisable. */
export function fit(value, maxLen) {
  return maxLen && value.length > maxLen ? value.slice(0, maxLen) : value;
}

/**
 * A create payload for `table` containing every column the database actually
 * requires: NOT NULL, no default, not API-managed.
 *
 * @returns {{payload:object, required:string[], unresolved:string[]}}
 *   `unresolved` lists required FK columns whose referenced table is empty —
 *   the resource cannot be exercised until that fixture exists.
 */
export function buildCreatePayload(schema, table, { tag = rand() } = {}) {
  const cols = columnsOf(schema, table);
  const opts = checkOptions(schema, table);
  const fks = foreignKeys(schema, table);
  const uniques = uniqueColumns(schema, table);
  const payload = {};
  const required = [];
  const unresolved = [];

  for (const col of cols) {
    if (MANAGED.has(col.name)) continue;
    if (col.nullable || col.hasDefault) continue;
    required.push(col.name);
    const v = valueFor(col, opts, fks, schema, tag, uniques);
    if (v === null && fks[col.name]) { unresolved.push(`${col.name}->${fks[col.name]}`); continue; }
    if (v !== null) payload[col.name] = v;
  }

  // A name/title makes the row identifiable in list and search assertions.
  const named = cols.find((c) => ['name', 'title', 'item_name', 'description'].includes(c.name));
  if (named) payload[named.name] = fit(`QA${tag}`, named.maxLen);

  return { payload, required, unresolved, nameCol: named?.name ?? null };
}

/** A text column that is safe to PATCH, for the update half of the lifecycle. */
export function updatableTextColumn(schema, table) {
  const opts = checkOptions(schema, table);
  const fks = foreignKeys(schema, table);
  const uniques = uniqueColumns(schema, table);
  const col = columnsOf(schema, table).find(
    (c) => !MANAGED.has(c.name) && c.nullable && !fks[c.name] && !opts[c.name] &&
      !uniques.has(c.name) &&
      /character varying|text/.test(c.type) &&
      !/pan|encrypted|password|photo|image|s3|url|status/.test(c.name),
  );
  // The length matters: the caller sizes its patch value to it, or the API
  // correctly refuses the write as too long.
  return col ? { name: col.name, maxLen: col.maxLen } : null;
}
