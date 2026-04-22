interface LogEntry {
  timestamp: string;
  level: "info" | "error" | "warn";
  message: string;
}

const MAX_ENTRIES = 500;
const buffer: LogEntry[] = [];

export function getRecentLogs(n = 200): LogEntry[] {
  return buffer.slice(-n);
}

function addEntry(level: LogEntry["level"], args: any[]) {
  const message = args.map(a =>
    typeof a === "string" ? a : a instanceof Error ? a.stack || a.message : JSON.stringify(a)
  ).join(" ");

  buffer.push({
    timestamp: new Date().toISOString(),
    level,
    message,
  });

  // Trim to max size
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
}

/**
 * Intercept console.log, console.error, console.warn to capture into the buffer.
 * Call this once at startup.
 */
export function installLogCapture() {
  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  console.log = (...args: any[]) => {
    addEntry("info", args);
    origLog(...args);
  };

  console.error = (...args: any[]) => {
    addEntry("error", args);
    origError(...args);
  };

  console.warn = (...args: any[]) => {
    addEntry("warn", args);
    origWarn(...args);
  };
}
