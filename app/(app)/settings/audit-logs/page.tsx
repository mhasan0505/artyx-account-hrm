import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getAuditLogs } from "@/lib/actions/settings";

interface SearchParams {
  action?: string;
  entity?: string;
  limit?: string;
  offset?: string;
}

interface AuditLogRow {
  id: string;
  user: { name: string | null; email: string | null } | null;
  action: string;
  entity: string;
  entityId: string;
  metadata: unknown;
  createdAt: Date;
}

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const action = searchParams.action ?? "";
  const entity = searchParams.entity ?? "";

  const parsedLimit = Number.parseInt(searchParams.limit ?? "50", 10);
  const parsedOffset = Number.parseInt(searchParams.offset ?? "0", 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 500)
    : 50;
  const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

  const { logs, total } = await getAuditLogs({
    action: action || undefined,
    entity: entity || undefined,
    limit,
    offset,
  });
  const typedLogs = logs as AuditLogRow[];

  const pages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;
  const hasNextPage = currentPage < pages;
  const hasPrevPage = currentPage > 1;

  const nextOffset = offset + limit;
  const prevOffset = Math.max(0, offset - limit);

  // Build query string for pagination
  const buildQueryString = (newOffset: number) => {
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    if (entity) params.set("entity", entity);
    params.set("limit", limit.toString());
    params.set("offset", newOffset.toString());
    return params.toString();
  };

  // CSV export data
  const csvData = [
    ["Timestamp", "User", "Email", "Action", "Entity", "Entity ID", "Metadata"],
    ...typedLogs.map((log) => [
      log.createdAt.toISOString().slice(0, 19).replace("T", " "),
      log.user?.name || "System",
      log.user?.email || "-",
      log.action,
      log.entity,
      log.entityId,
      JSON.stringify(log.metadata || {}),
    ]),
  ]
    .map((row) =>
      row
        .map((cell: string) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n");

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Audit Logs" />

      <div className="space-y-4 rounded-md border p-4">
        <h2 className="text-lg font-semibold">Filters</h2>
        <form className="space-y-4" method="get">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Action</label>
              <input
                type="text"
                name="action"
                placeholder="e.g., SALE_CHECKOUT"
                defaultValue={action}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Entity</label>
              <input
                type="text"
                name="entity"
                placeholder="e.g., Sale"
                defaultValue={entity}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="default">
              Apply Filters
            </Button>
            <a
              href="/settings/audit-logs"
              className="inline-flex items-center justify-center rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Clear
            </a>
          </div>
        </form>
      </div>

      <div className="rounded-md border">
        <div className="flex items-center justify-between border-b p-4">
          <div>
            <h2 className="text-lg font-semibold">Activity Log</h2>
            <p className="text-sm text-muted-foreground">
              Showing {typedLogs.length} of {total} total entries
            </p>
          </div>
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(csvData)}`}
            download={`audit-logs-${new Date().toISOString().slice(0, 10)}.csv`}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Export CSV
          </a>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-2 text-left font-medium">Timestamp</th>
                <th className="px-4 py-2 text-left font-medium">User</th>
                <th className="px-4 py-2 text-left font-medium">Action</th>
                <th className="px-4 py-2 text-left font-medium">Entity</th>
                <th className="px-4 py-2 text-left font-medium">Entity ID</th>
                <th className="px-4 py-2 text-left font-medium">Metadata</th>
              </tr>
            </thead>
            <tbody>
              {typedLogs.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    No activity found.
                  </td>
                </tr>
              ) : (
                typedLogs.map((log) => (
                  <tr key={log.id} className="border-b last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap">
                      {log.createdAt
                        .toISOString()
                        .slice(0, 19)
                        .replace("T", " ")}
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium">
                        {log.user?.name ?? "System"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {log.user?.email ?? "-"}
                      </div>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {log.action}
                    </td>
                    <td className="px-4 py-2">{log.entity}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {log.entityId}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {log.metadata &&
                      typeof log.metadata === "object" &&
                      Object.keys(log.metadata as Record<string, unknown>)
                        .length > 0 ? (
                        <details>
                          <summary className="cursor-pointer text-blue-600 hover:underline">
                            View
                          </summary>
                          <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
                            {JSON.stringify(log.metadata, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="mt-4 flex items-center justify-between border-t p-4">
            <div className="text-sm text-muted-foreground">
              Page {currentPage} of {pages}
            </div>
            <div className="flex gap-2">
              {hasPrevPage && (
                <a
                  href={`?${buildQueryString(prevOffset)}`}
                  className="inline-flex items-center justify-center rounded-md border border-input px-3 py-2 text-sm hover:bg-accent"
                >
                  Previous
                </a>
              )}
              {hasNextPage && (
                <a
                  href={`?${buildQueryString(nextOffset)}`}
                  className="inline-flex items-center justify-center rounded-md border border-input px-3 py-2 text-sm hover:bg-accent"
                >
                  Next
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
