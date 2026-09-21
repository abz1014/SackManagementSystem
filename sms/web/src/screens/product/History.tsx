/**
 * Product › History — the product-change trail (UX Phase 6 Brief 3,
 * 16 Sep 2026). Replaces Brief 1's one-line stub.
 *
 * TWO RECORDS, ONE SCREEN, NEWEST FIRST:
 *
 *  1. THE PRODUCT TIMELINE (`GET /api/product-timeline`) — SMS's own append-
 *     only record of which product was recorded as running, when, by whom.
 *     This is the ONLY UI anywhere that shows it: the old product sheet
 *     component's `History()` — deleted with the rest of that file in
 *     Brief 1 — was the sole place this ever rendered, and since then the
 *     app has had NO way to see it at all. Restored here, in the open, not
 *     behind a `<Details>` the way the old sheet hid it.
 *
 *  2. THE `sms.product_change` TRAIL (`GET /api/product-changes`, this
 *     brief's own new endpoint — see services/productChanges.ts) — one row
 *     per write ATTEMPT against PDAS: `proc_name`, `operation`, `outcome`
 *     (ok / failed / **disabled**), `pdas_error_code`, `message`, `reason`,
 *     `changed_by`, `effective_from`. A row at `outcome='disabled'` is
 *     labelled as what it honestly is — an attempt that never reached PDAS
 *     at all, because the write path was off when it was tried — which is
 *     what makes the Changeover screen's 503 refusal auditable after the
 *     fact rather than only visible in the moment. Brief 2 already produced
 *     exactly such a row against the local `_SEP07` copy (`change_id=2`, one
 *     `outcome='disabled'` insert from a rank-2 execute attempt); this tab
 *     is the first place in the whole application that row is readable.
 *
 * TWO CLOCKS (CLAUDE.md): every timestamp in both records —
 * `product_timeline.effective_from`/`changed_at`, `product_change
 * .changed_at`/`effective_from` — is APP-WRITTEN (genuine UTC, SYSUTCDATETIME()
 * or Node's `new Date()`), never the plant wall clock. Rendered with
 * `fmtAppInstant`, which deliberately does NOT pin UTC (see lib/fmt.ts's own
 * header) — the plant-clock formatters (`fmtClock`/`fmtDay`) belong to
 * production timestamps only and must not be used here.
 */
import { useEffect, useState } from 'react';
import { W } from '../../lib/words';
import { Block, Empty, Failed, SkelLines } from '../../ui/bits';
import { fmtAppInstant } from '../../lib/fmt';
import { getProductTimeline, getProductChanges, type TimelineEntry, type ProductChangeEntry } from '../../api';

function errText(e: unknown): string {
  return String((e as { message?: string })?.message ?? e);
}

export function HistoryTab() {
  return (
    <>
      <TimelineBlock />
      <TrailBlock />
    </>
  );
}

/* ------------------------------------------------------------- timeline */

function TimelineBlock() {
  const [rows, setRows] = useState<TimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    getProductTimeline()
      .then((r) => setRows(r.timeline))
      .catch((e) => setError(errText(e)));
  };
  useEffect(() => { load(); }, []);

  return (
    <Block label={W.product.tabs.history}>
      {error ? (
        <Failed error={error} onRetry={load} />
      ) : !rows ? (
        <SkelLines n={4} short />
      ) : rows.length === 0 ? (
        <Empty message={W.product.historyTrail.none} />
      ) : (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th style={{ width: '13em' }}>{W.product.historyTrail.colWhen}</th>
                <th>{W.product.historyTrail.colProduct}</th>
                <th>{W.product.historyTrail.colBy}</th>
                <th>{W.product.historyTrail.colReason}</th>
              </tr>
            </thead>
            <tbody>
              {[...rows]
                .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
                .map((t) => (
                  <tr key={t.timelineId}>
                    <td>{fmtAppInstant(t.effectiveFrom)}</td>
                    <td>{t.productLabel}</td>
                    <td>{t.changedBy ?? <span className="mut">—</span>}</td>
                    <td className="mut">{t.reason ?? '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </Block>
  );
}

/* ------------------------------------------------------------------ trail */

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'ok':
      return W.product.historyTrail.outcome.applied;
    case 'disabled':
      return W.product.historyTrail.outcome.disabled;
    default:
      // conflict | implausible | not_found | pdas_error | error | mismatch —
      // every non-'ok', non-'disabled' outcome is PDAS (or the plausibility
      // check ahead of it) refusing the write, so the same honest label
      // applies to all of them: it reached PDAS and PDAS said no.
      return W.product.historyTrail.outcome.failed;
  }
}

function TrailBlock() {
  const [rows, setRows] = useState<ProductChangeEntry[] | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const PAGE = 40;
  const load = () => {
    setError(null);
    getProductChanges(null, PAGE)
      .then((r) => { setRows(r.entries); setNextBefore(r.nextBefore); })
      .catch((e) => setError(errText(e)));
  };
  const older = async () => {
    if (nextBefore == null) return;
    setBusy(true);
    try {
      const r = await getProductChanges(nextBefore, PAGE);
      setRows((cur) => [...(cur ?? []), ...r.entries]);
      setNextBefore(r.nextBefore);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { load(); }, []);

  return (
    <Block label={W.product.historyTrail.title}>
      {error ? (
        <Failed error={error} onRetry={load} />
      ) : !rows ? (
        <SkelLines n={4} short />
      ) : rows.length === 0 ? (
        <Empty message={W.product.historyTrail.none} />
      ) : (
        <>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '13em' }}>{W.product.historyTrail.colWhen}</th>
                  <th>{W.product.historyTrail.colProduct}</th>
                  <th>{W.product.historyTrail.colOutcome}</th>
                  <th>{W.product.historyTrail.colBy}</th>
                  <th>{W.product.historyTrail.colReason}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.changeId}>
                    <td>{fmtAppInstant(c.changedAtUtc)}</td>
                    <td>
                      {c.procName ?? c.operation}
                      {c.productId != null && <span className="mut sm"> · product {c.productId}</span>}
                      {c.palletId != null && <span className="mut sm"> · pallet {c.palletId}</span>}
                      {c.effectiveFromUtc && (
                        <div className="mut sm">effective {fmtAppInstant(c.effectiveFromUtc)}</div>
                      )}
                    </td>
                    <td>
                      {outcomeLabel(c.outcome)}
                      {c.message && <div className="mut sm">{c.message}{c.pdasErrorCode != null ? ` (${c.pdasErrorCode})` : ''}</div>}
                    </td>
                    <td>{c.changedByName ?? <span className="mut">—</span>}</td>
                    <td className="mut">{c.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nextBefore != null && (
            <button type="button" className="btn" style={{ marginTop: 12 }} disabled={busy} onClick={() => void older()}>
              {W.health.older}
            </button>
          )}
        </>
      )}
    </Block>
  );
}
