import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Terminal } from "lucide-react";

interface LogEntry {
  timestamp: string;
  level: "info" | "error" | "warn";
  message: string;
}

export default function LogsPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: logs, refetch, isLoading } = useQuery<LogEntry[]>({
    queryKey: ["/api/admin/logs?n=500"],
    staleTime: 0,
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const filtered = useMemo(() => {
    if (!logs) return [];
    return logs.filter((entry) => {
      if (levelFilter !== "all" && entry.level !== levelFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!entry.message.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [logs, search, levelFilter]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current && autoRefresh) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered, autoRefresh]);

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Server Logs</h1>
          <p className="text-muted-foreground">
            {filtered.length} entries
            {autoRefresh && " · Auto-refreshing"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="auto-refresh"
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
            />
            <Label htmlFor="auto-refresh" className="text-sm">Auto-refresh</Label>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Input
            placeholder="Filter logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="font-mono text-sm"
          />
        </div>
        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Levels</SelectItem>
            <SelectItem value="error">Errors Only</SelectItem>
            <SelectItem value="warn">Warnings Only</SelectItem>
            <SelectItem value="info">Info Only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div
            ref={scrollRef}
            className="h-[600px] overflow-y-auto p-3 font-mono text-xs leading-relaxed"
          >
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Terminal className="h-8 w-8 mb-2" />
                <p>{isLoading ? "Loading logs..." : "No log entries"}</p>
              </div>
            ) : (
              filtered.map((entry, i) => (
                <div
                  key={i}
                  className={`py-0.5 px-1 rounded ${
                    entry.level === "error"
                      ? "bg-red-500/10 text-red-700 dark:text-red-400"
                      : entry.level === "warn"
                      ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                      : ""
                  }`}
                >
                  <span className="text-muted-foreground select-none">
                    {formatTime(entry.timestamp)}
                  </span>
                  {" "}
                  {entry.level !== "info" && (
                    <span className={
                      entry.level === "error" ? "text-red-600 font-bold" : "text-yellow-600 font-bold"
                    }>
                      [{entry.level.toUpperCase()}]
                    </span>
                  )}
                  {" "}
                  <span className="break-all">{entry.message}</span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
