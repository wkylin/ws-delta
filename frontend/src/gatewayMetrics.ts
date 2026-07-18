import { computed, onBeforeUnmount, onMounted, ref } from "vue";

export type MetricsStatus = "loading" | "ready" | "error";

export interface PrometheusSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

const SAMPLE_PATTERN = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([^\s]+)(?:\s+\d+)?$/;
const LABEL_PATTERN = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"])*)"/g;

export function parsePrometheusText(input: string): PrometheusSample[] {
  const samples: PrometheusSample[] = [];
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = SAMPLE_PATTERN.exec(line);
    if (!match) continue;
    const value = Number(match[3]);
    if (!Number.isFinite(value)) continue;
    const labels: Record<string, string> = {};
    for (const label of match[2]?.matchAll(LABEL_PATTERN) ?? []) {
      labels[label[1]] = label[2].replaceAll('\\"', '"').replaceAll("\\\\", "\\");
    }
    samples.push({ name: match[1], labels, value });
  }
  return samples;
}

export function metricsUrlFromWebSocket(endpoint: string): string {
  const configured = (import.meta.env.VITE_METRICS_URL as string | undefined)?.trim();
  if (configured) return configured;
  const url = new URL(endpoint);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/metrics";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function useGatewayMetrics(webSocketEndpoint: string) {
  const status = ref<MetricsStatus>("loading");
  const error = ref("");
  const samples = ref<PrometheusSample[]>([]);
  const lastUpdatedAt = ref<Date | null>(null);
  const outboundRate = ref(0);
  const outboundBytesRate = ref(0);
  const rateHistory = ref<number[]>(Array.from({ length: 20 }, () => 0));
  const endpoint = metricsUrlFromWebSocket(webSocketEndpoint);
  let timer: number | null = null;
  let controller: AbortController | null = null;
  let previous: { messages: number; bytes: number; at: number } | null = null;

  function value(name: string): number {
    return samples.value.find((sample) => sample.name === name)?.value ?? 0;
  }

  const metrics = computed(() => ({
    connections: value("ws_realtime_connections"),
    subscriptions: value("ws_realtime_subscriptions"),
    outboundMessages: value("ws_realtime_outbound_messages_total"),
    outboundBytes: value("ws_realtime_outbound_bytes_total"),
    resyncs: value("ws_realtime_resync_requests_total"),
    drops: value("ws_realtime_recoverable_messages_dropped_total"),
    backpressure: value("ws_realtime_backpressure_notifications_total"),
    slowConsumers: value("ws_realtime_slow_consumer_disconnects_total"),
    bufferedBytes: value("ws_realtime_buffered_bytes"),
  }));

  async function refresh(): Promise<void> {
    controller?.abort();
    controller = new AbortController();
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "text/plain" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      samples.value = parsePrometheusText(await response.text());
      const now = performance.now();
      const current = {
        messages: value("ws_realtime_outbound_messages_total"),
        bytes: value("ws_realtime_outbound_bytes_total"),
        at: now,
      };
      if (previous) {
        const seconds = Math.max(0.001, (now - previous.at) / 1_000);
        outboundRate.value = Math.max(0, (current.messages - previous.messages) / seconds);
        outboundBytesRate.value = Math.max(0, (current.bytes - previous.bytes) / seconds);
        rateHistory.value = [...rateHistory.value.slice(1), outboundRate.value];
      }
      previous = current;
      lastUpdatedAt.value = new Date();
      status.value = "ready";
      error.value = "";
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      status.value = "error";
      error.value = reason instanceof Error ? reason.message : "Metrics endpoint unavailable";
    }
  }

  onMounted(() => {
    void refresh();
    timer = window.setInterval(() => void refresh(), 2_500);
  });
  onBeforeUnmount(() => {
    controller?.abort();
    if (timer != null) window.clearInterval(timer);
  });

  return {
    endpoint,
    error,
    lastUpdatedAt,
    metrics,
    outboundBytesRate,
    outboundRate,
    rateHistory,
    refresh,
    status,
  };
}
