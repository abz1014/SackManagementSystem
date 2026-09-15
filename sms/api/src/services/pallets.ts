/**
 * Pallets and pack schemas, as mirrored from PDAS (migration 036) — roadmap
 * Phase 6 completed, Wave F, 15 Sep 2026.
 *
 * WHY THE APP NEEDS PALLETS AT ALL. IFL's SOP ("QCS ID Creation by P-DAS")
 * ends every material with CreatePallet, and the QCS panel lists ACTIVE
 * PALLETS for the operator to pick on the machine (the panel's own event log:
 * funcGetArray PALLET → funcGetPalletId). A material with no active pallet
 * is therefore only half of a changeover. Before this file the app knew the
 * materials and nothing about the pallets that make them selectable.
 *
 * Reads are from the sidecar mirror only — never from PDAS. The mirror is
 * refreshed by the sync worker on every pass (seedProducts) and by the write
 * path the moment it creates or retires one, so a screen is at most one
 * sync interval behind an engineer working in SSMS and never behind SMS.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

export interface PalletRow {
  palletId: number;
  productId: number;
  /** The material's label from the product mirror, or null when the mirror lacks the product. */
  productLabel: string | null;
  packSchemaId: number | null;
  packSchemaLabel: string | null;
  lot: string | null;
  /** PalletActive — what the QCS panel lists. */
  active: boolean | null;
  /** PalletDesc1 = the sack colour, per IFL's SOP. */
  sackColour: string | null;
  labelType: number | null;
  steamProg: number | null;
  routing: number | null;
  /** Plant wall clock (PDAS getdate()), for ordering and display only. */
  pdasCreatedAt: string | null;
}

export interface PackSchemaRow {
  packSchemaId: number;
  description: string | null;
  conesPerLayer: number | null;
  packTypeId: number | null;
}

/** Active first, then newest first — the order the engineer scans the list in. */
export async function listPallets(pool: ConnectionPool): Promise<PalletRow[]> {
  const r = await pool.request().query<{
    pallet_id: number; product_id: number; description: string | null; lot_code: string | null;
    pack_schema_id: number | null; ps_desc: string | null; lot: string | null; active_flag: boolean | null;
    desc1: string | null; label_type: number | null; steam_prog: number | null; routing: number | null; pdas_created_at: Date | null;
  }>(
    `SELECT pl.pallet_id, pl.product_id, p.description, p.lot_code, pl.pack_schema_id, ps.description AS ps_desc,
            pl.lot, pl.active_flag, pl.desc1, pl.label_type, pl.steam_prog, pl.routing, pl.pdas_created_at
       FROM sms.pallet pl
       LEFT JOIN sms.product p ON p.product_id = pl.product_id
       LEFT JOIN sms.pack_schema ps ON ps.pack_schema_id = pl.pack_schema_id
      ORDER BY CASE WHEN pl.active_flag = 1 THEN 0 ELSE 1 END, pl.pdas_created_at DESC, pl.pallet_id DESC`,
  );
  return r.recordset.map((x) => ({
    palletId: Number(x.pallet_id),
    productId: Number(x.product_id),
    productLabel: x.description || x.lot_code || null,
    packSchemaId: x.pack_schema_id == null ? null : Number(x.pack_schema_id),
    packSchemaLabel: x.ps_desc ?? null,
    lot: x.lot ?? null,
    active: x.active_flag == null ? null : Boolean(x.active_flag),
    sackColour: x.desc1 ?? null,
    labelType: x.label_type == null ? null : Number(x.label_type),
    steamProg: x.steam_prog == null ? null : Number(x.steam_prog),
    routing: x.routing == null ? null : Number(x.routing),
    pdasCreatedAt: x.pdas_created_at ? new Date(x.pdas_created_at).toISOString() : null,
  }));
}

export async function listPackSchemas(pool: ConnectionPool): Promise<PackSchemaRow[]> {
  const r = await pool.request().query<{ pack_schema_id: number; description: string | null; cones_per_layer: number | null; pack_type_id: number | null }>(
    `SELECT pack_schema_id, description, cones_per_layer, pack_type_id FROM sms.pack_schema ORDER BY pack_schema_id`,
  );
  return r.recordset.map((x) => ({
    packSchemaId: Number(x.pack_schema_id),
    description: x.description ?? null,
    conesPerLayer: x.cones_per_layer == null ? null : Number(x.cones_per_layer),
    packTypeId: x.pack_type_id == null ? null : Number(x.pack_type_id),
  }));
}

/** Does the mirror hold a pallet for this (material, schema, lot)? CreatePallet would refuse it with -8001. */
export async function findPalletByKey(pool: ConnectionPool, productId: number, packSchemaId: number, lot: string): Promise<{ palletId: number; active: boolean | null } | null> {
  const r = await pool
    .request()
    .input('pid', mssql.Int, productId)
    .input('ps', mssql.Int, packSchemaId)
    .input('lot', mssql.NVarChar(255), lot)
    .query<{ pallet_id: number; active_flag: boolean | null }>(
      `SELECT TOP 1 pallet_id, active_flag FROM sms.pallet WHERE product_id = @pid AND pack_schema_id = @ps AND lot = @lot ORDER BY pallet_id DESC`,
    );
  const x = r.recordset[0];
  return x ? { palletId: Number(x.pallet_id), active: x.active_flag == null ? null : Boolean(x.active_flag) } : null;
}
