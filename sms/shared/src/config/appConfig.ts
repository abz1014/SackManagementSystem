/**
 * The three swappable unknowns, as validated config (ARCHITECTURE.md §4).
 *
 * Design rule: STORE RAW TRUTH, INTERPRET AT READ TIME. None of these values
 * is baked into stored data, so when IFL finally answers Q4/Q5/Q7 the change
 * is a config flip — no migration, no re-sync. Defaults are deliberately
 * HONEST ('as_recorded', 'corrected') rather than assumed.
 */

import { z } from 'zod';

export const weightBasisSchema = z.enum(['as_recorded', 'gross', 'net']);
export type WeightBasis = z.infer<typeof weightBasisSchema>;

export const shiftModeSchema = z.enum(['corrected', 'legacy']);
export const nightBelongsToSchema = z.enum(['start_day', 'calendar_day']);

export const appConfigSchema = z.object({
  lineId: z.coerce.number().int().positive().default(1),

  /** Q4/Q5 — weight interpretation. Raw weight is always stored regardless. */
  weight: z.object({
    basis: weightBasisSchema.default('as_recorded'),
    coneTubeWeightG: z.coerce.number().nonnegative().default(70),
    sackTareKg: z.coerce.number().nonnegative().default(0.5),
  }),

  /** Q7/Q8 — shift. Boundaries confirmed; mode + night rule still open. */
  shift: z.object({
    mode: shiftModeSchema.default('corrected'),
    nightBelongsTo: nightBelongsToSchema.default('start_day'),
  }),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

/** Build config from raw env values (strings). Throws on invalid input. */
export function loadAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  return appConfigSchema.parse({
    lineId: env.LINE_ID,
    weight: {
      basis: env.WEIGHT_BASIS,
      coneTubeWeightG: env.CONE_TUBE_WEIGHT_G,
      sackTareKg: env.SACK_TARE_KG,
    },
    shift: {
      mode: env.SHIFT_MODE,
      nightBelongsTo: env.SHIFT_NIGHT_BELONGS_TO,
    },
  });
}

/**
 * Interpret a stored raw weight per the configured basis (Q4/Q5).
 * 'as_recorded' and 'gross' return the raw value; 'net' subtracts tare.
 * Pure, and the ONLY place weight interpretation lives.
 */
export function interpretWeight(
  rawValue: number,
  kind: 'cone' | 'sack',
  cfg: AppConfig['weight'],
): number {
  if (cfg.basis !== 'net') return rawValue;
  const tare = kind === 'cone' ? cfg.coneTubeWeightG : cfg.sackTareKg;
  const net = rawValue - tare;
  return net > 0 ? net : rawValue; // never return a nonsensical negative
}
