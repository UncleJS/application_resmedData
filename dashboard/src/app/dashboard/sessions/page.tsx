import Link from "next/link";
import { getSessions } from "@/lib/queries/sessions";
import type { SessionRow } from "@/lib/queries/sessions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ahiColor, fmtMinutes, formatTs, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PER_PAGE = 30;

function ahiBadgeVariant(ahi: number | null) {
  if (ahi === null) return "outline" as const;
  if (ahi < 5)  return "success" as const;
  if (ahi < 15) return "warning" as const;
  return "danger" as const;
}

/** Group an ordered list of sessions by night_date, preserving order. */
function groupByNight(rows: SessionRow[]): { night: string; sessions: SessionRow[] }[] {
  const map = new Map<string, SessionRow[]>();
  for (const s of rows) {
    const key = s.night_date.slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return Array.from(map.entries()).map(([night, sessions]) => ({ night, sessions }));
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1"));
  const { rows, total } = await getSessions(page, PER_PAGE);
  const totalPages = Math.ceil(total / PER_PAGE);
  const groups = groupByNight(rows);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Sessions</h1>
          <p className="text-sm text-foreground">{total} total</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-foreground text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Night / Session start</th>
                  <th className="px-4 py-3 text-left">End</th>
                   <th className="px-4 py-3 text-right">Duration</th>
                   <th className="px-4 py-3 text-right">AHI</th>
                   <th className="px-4 py-3 text-right">Leak p95</th>
                  <th className="px-4 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {groups.map(({ night, sessions }) => {
                  // All sessions on the same night share the same night-level stats
                  const s0 = sessions[0]!;
                  return [
                    /* ── Night summary header row ── */
                    <tr
                      key={`night-${night}`}
                      className="bg-accent/30 border-t-2 border-border"
                    >
                      <td className="px-4 py-2 font-semibold text-foreground" colSpan={1}>
                        <Link
                          href={`/dashboard/nights/${night}`}
                          className="hover:underline font-mono text-xs"
                        >
                          {formatDate(night)} →
                        </Link>
                      </td>
                      {/* End — spans the night; leave blank */}
                      <td className="px-4 py-2 text-foreground text-xs">night</td>
                      {/* Duration: night usage */}
                      <td className="px-4 py-2 text-right text-foreground text-xs">
                        {fmtMinutes(s0.night_on_duration_min)}
                      </td>
                      {/* AHI: night AHI */}
                      <td className="px-4 py-2 text-right">
                        {s0.night_ahi != null ? (
                          <Badge variant={ahiBadgeVariant(s0.night_ahi)}>
                            <span className={ahiColor(s0.night_ahi)}>{s0.night_ahi.toFixed(1)}</span>
                          </Badge>
                        ) : <span className="text-foreground text-xs">—</span>}
                      </td>
                      {/* Leak p95: night */}
                      <td className="px-4 py-2 text-right text-foreground text-xs">
                        {s0.night_leak_95 != null
                          ? `${(s0.night_leak_95 * 60).toFixed(1)} L/min`
                          : "—"}
                      </td>
                      <td />
                    </tr>,

                    /* ── Session rows ── */
                    ...sessions.map((s) => (
                      <tr key={s.id} className="hover:bg-accent/50 transition-colors">
                        {/* Session start — indented */}
                        <td className="px-4 py-2 pl-8 font-mono text-xs text-foreground">
                          {formatTs(s.session_start_utc)}
                        </td>
                        {/* Session end */}
                        <td className="px-4 py-2 font-mono text-xs text-foreground">
                          {s.session_end_utc ? formatTs(s.session_end_utc) : "—"}
                        </td>
                        {/* Session duration */}
                        <td className="px-4 py-2 text-right text-foreground">
                          {fmtMinutes(s.duration_min)}
                        </td>
                         {/* Per-session AHI */}
                         <td className="px-4 py-2 text-right">
                           {s.session_ahi != null ? (
                             <Badge variant={ahiBadgeVariant(s.session_ahi)}>
                               <span className={ahiColor(s.session_ahi)}>{s.session_ahi.toFixed(1)}</span>
                             </Badge>
                           ) : <span className="text-foreground text-xs">—</span>}
                         </td>
                         {/* Per-session leak p95 */}
                         <td className="px-4 py-2 text-right text-foreground text-xs">
                           {s.session_leak_95 != null
                             ? `${(s.session_leak_95 * 60).toFixed(1)} L/min`
                             : "—"}
                         </td>
                        <td className="px-4 py-2 text-right">
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/dashboard/sessions/${s.id}`}>Detail →</Link>
                          </Button>
                        </td>
                      </tr>
                    )),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 justify-end">
          {page > 1 && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/dashboard/sessions?page=${page - 1}`}>← Prev</Link>
            </Button>
          )}
          <span className="text-sm text-foreground">Page {page} / {totalPages}</span>
          {page < totalPages && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/dashboard/sessions?page=${page + 1}`}>Next →</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
