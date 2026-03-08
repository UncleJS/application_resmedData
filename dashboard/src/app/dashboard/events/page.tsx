import { getEventBreakdown } from "@/lib/queries/events";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EventBreakdownChart from "@/components/charts/EventBreakdownChart";

export const dynamic = "force-dynamic";

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const data = await getEventBreakdown(sp.from, sp.to);

  const total = data.reduce((sum, r) => sum + Number(r.cnt), 0);

  // Summary by type
  const byType = data.reduce<Record<string, number>>((acc, r) => {
    acc[r.event_type] = (acc[r.event_type] ?? 0) + Number(r.cnt);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Event Breakdown</h1>
        <p className="text-sm text-muted-foreground">{total} events across {new Set(data.map(r => r.night)).size} nights</p>
      </div>

      {/* Type summary */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(byType).map(([type, cnt]) => (
          <div key={type} className="rounded-md border border-border bg-card px-3 py-2 text-sm">
            <p className="text-muted-foreground text-xs">{type}</p>
            <p className="text-foreground font-semibold">{cnt}</p>
          </div>
        ))}
      </div>

      {/* Stacked bar by night */}
      <Card>
        <CardHeader><CardTitle>Events by night</CardTitle></CardHeader>
        <CardContent>
          <EventBreakdownChart data={data} />
        </CardContent>
      </Card>
    </div>
  );
}
