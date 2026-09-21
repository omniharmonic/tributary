/**
 * Gate schema, applied at every boot. Everything is `IF NOT EXISTS`, so a redeploy is
 * a no-op and a fresh database comes up in one step. The SpaceStore's own tables come
 * from `@tributary/spaces-shim`; these are the Gate's additions: invites, shares,
 * access requests and the audit log.
 */
import type pg from 'pg'
import { migrateSpaceStore } from '@tributary/spaces-shim'

export const GATE_EXTRA_SQL = `
create table if not exists gate.invite (
  id text primary key,
  space_uri text not null references gate.space(uri) on delete cascade,
  kind text not null check (kind in ('join', 'read', 'read-join')),
  token_hash text not null unique,
  role integer not null default 10,
  expires_at timestamptz not null,
  max_uses integer,
  uses integer not null default 0,
  created_by text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists invite_space_idx on gate.invite (space_uri);
create table if not exists gate.invite_redemption (
  invite_id text not null references gate.invite(id) on delete cascade,
  space_uri text not null references gate.space(uri) on delete cascade,
  did text not null,
  redeemed_at timestamptz not null default now(),
  primary key (invite_id, did)
);
create index if not exists invite_redemption_viewer_idx on gate.invite_redemption (space_uri, did);
create table if not exists gate.share (
  space_uri text not null references gate.space(uri) on delete cascade,
  did text not null,
  granted_by text not null,
  created_at timestamptz not null default now(),
  primary key (space_uri, did)
);
create table if not exists gate.access_request (
  id text primary key,
  space_uri text not null references gate.space(uri) on delete cascade,
  did text not null,
  state text not null check (state in ('pending', 'approved', 'denied')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  unique (space_uri, did)
);
create table if not exists gate.gate_audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  space_uri text not null,
  actor text,
  action text not null,
  subject text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists gate_audit_space_idx on gate.gate_audit (space_uri, at desc);
`

export async function migrate(pool: pg.Pool): Promise<void> {
  await migrateSpaceStore(pool)
  await pool.query(GATE_EXTRA_SQL)
}
