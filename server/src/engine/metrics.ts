export interface GatewayMetricsSnapshot {
  uptimeSeconds: number;
  connectionsOpened: number;
  connectionsClosed: number;
  currentConnections: number;
  currentSubscriptions: number;
  inboundMessages: number;
  inboundBytes: number;
  outboundMessages: number;
  outboundBytes: number;
  outboundByType: Record<string, number>;
  resyncRequests: number;
  sequenceGapSizeInjected: number;
  recoverableMessagesDropped: number;
  backpressureNotifications: number;
  slowConsumerDisconnects: number;
  currentBufferedBytes: number;
  maxConnectionBufferedBytes: number;
}

export class GatewayMetrics {
  private readonly startedAt = Date.now();
  private connectionsOpened = 0;
  private connectionsClosed = 0;
  private inboundMessages = 0;
  private inboundBytes = 0;
  private outboundMessages = 0;
  private outboundBytes = 0;
  private readonly outboundByType = new Map<string, number>();
  private resyncRequests = 0;
  private sequenceGapSizeInjected = 0;
  private recoverableMessagesDropped = 0;
  private backpressureNotifications = 0;
  private slowConsumerDisconnects = 0;

  connectionOpened(): void { this.connectionsOpened += 1; }
  connectionClosed(): void { this.connectionsClosed += 1; }
  inbound(bytes: number): void { this.inboundMessages += 1; this.inboundBytes += bytes; }
  outbound(type: string, bytes: number): void {
    this.outboundMessages += 1;
    this.outboundBytes += bytes;
    this.outboundByType.set(type, (this.outboundByType.get(type) ?? 0) + 1);
  }
  resync(): void { this.resyncRequests += 1; }
  sequenceGap(skip: number): void { this.sequenceGapSizeInjected += skip; }
  recoverableDrop(): void { this.recoverableMessagesDropped += 1; }
  backpressure(): void { this.backpressureNotifications += 1; }
  slowConsumer(): void { this.slowConsumerDisconnects += 1; }

  snapshot(
    currentConnections: number,
    currentSubscriptions: number,
    bufferedAmounts: number[],
  ): GatewayMetricsSnapshot {
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1_000),
      connectionsOpened: this.connectionsOpened,
      connectionsClosed: this.connectionsClosed,
      currentConnections,
      currentSubscriptions,
      inboundMessages: this.inboundMessages,
      inboundBytes: this.inboundBytes,
      outboundMessages: this.outboundMessages,
      outboundBytes: this.outboundBytes,
      outboundByType: Object.fromEntries(this.outboundByType),
      resyncRequests: this.resyncRequests,
      sequenceGapSizeInjected: this.sequenceGapSizeInjected,
      recoverableMessagesDropped: this.recoverableMessagesDropped,
      backpressureNotifications: this.backpressureNotifications,
      slowConsumerDisconnects: this.slowConsumerDisconnects,
      currentBufferedBytes: bufferedAmounts.reduce((sum, value) => sum + value, 0),
      maxConnectionBufferedBytes: Math.max(0, ...bufferedAmounts),
    };
  }
}

export function formatPrometheusMetrics(metrics: GatewayMetricsSnapshot): string {
  const names: Array<[string, number]> = [
    ["ws_realtime_uptime_seconds", metrics.uptimeSeconds],
    ["ws_realtime_connections_opened_total", metrics.connectionsOpened],
    ["ws_realtime_connections_closed_total", metrics.connectionsClosed],
    ["ws_realtime_connections", metrics.currentConnections],
    ["ws_realtime_subscriptions", metrics.currentSubscriptions],
    ["ws_realtime_inbound_messages_total", metrics.inboundMessages],
    ["ws_realtime_inbound_bytes_total", metrics.inboundBytes],
    ["ws_realtime_outbound_messages_total", metrics.outboundMessages],
    ["ws_realtime_outbound_bytes_total", metrics.outboundBytes],
    ["ws_realtime_resync_requests_total", metrics.resyncRequests],
    ["ws_realtime_sequence_gap_size_injected_total", metrics.sequenceGapSizeInjected],
    ["ws_realtime_recoverable_messages_dropped_total", metrics.recoverableMessagesDropped],
    ["ws_realtime_backpressure_notifications_total", metrics.backpressureNotifications],
    ["ws_realtime_slow_consumer_disconnects_total", metrics.slowConsumerDisconnects],
    ["ws_realtime_buffered_bytes", metrics.currentBufferedBytes],
    ["ws_realtime_max_connection_buffered_bytes", metrics.maxConnectionBufferedBytes],
  ];
  const lines = names.map(([name, value]) => `${name} ${value}`);
  for (const [type, value] of Object.entries(metrics.outboundByType)) {
    lines.push(`ws_realtime_outbound_messages_by_type_total{type="${type.replaceAll('"', '\\"')}"} ${value}`);
  }
  return `${lines.join("\n")}\n`;
}
