<template>
  <section class="gateway-observer" aria-label="Gateway metrics">
    <header class="gateway-observer__head">
      <div>
        <p class="section-label">Gateway runtime</p>
        <div class="gateway-observer__status">
          <i :class="`is-${status}`" />
          <span>{{ statusLabel }}</span>
        </div>
      </div>
      <button
        type="button"
        class="icon-button gateway-observer__refresh"
        title="Refresh gateway metrics"
        aria-label="Refresh gateway metrics"
        @click="refresh"
      >
        <RefreshCw :size="13" :class="{ 'is-spinning': status === 'loading' }" />
      </button>
    </header>

    <p v-if="status === 'error'" class="gateway-observer__error" :title="endpoint">
      {{ error || "Metrics endpoint unavailable" }}
    </p>

    <dl class="gateway-metric-grid">
      <div><dt>Connections</dt><dd>{{ integer(metrics.connections) }}</dd></div>
      <div><dt>Subscriptions</dt><dd>{{ integer(metrics.subscriptions) }}</dd></div>
      <div><dt>TX rate</dt><dd>{{ decimal(outboundRate) }}<small>/s</small></dd></div>
      <div><dt>TX bandwidth</dt><dd>{{ formatRate(outboundBytesRate) }}</dd></div>
      <div :class="{ 'has-warning': metrics.resyncs > 0 }"><dt>Resync</dt><dd>{{ integer(metrics.resyncs) }}</dd></div>
      <div :class="{ 'has-danger': metrics.drops > 0 }"><dt>Dropped</dt><dd>{{ integer(metrics.drops) }}</dd></div>
    </dl>

    <div class="gateway-pulse" aria-label="Recent outbound message rate">
      <div class="gateway-pulse__meta">
        <span>TX pulse</span>
        <time>{{ updatedLabel }}</time>
      </div>
      <div class="gateway-pulse__bars" aria-hidden="true">
        <i
          v-for="(sample, index) in rateHistory"
          :key="index"
          :style="{ height: `${barHeight(sample)}%` }"
        />
      </div>
    </div>

    <div class="gateway-pressure">
      <span><i class="is-buffer" />Buffer <b>{{ formatBytes(metrics.bufferedBytes) }}</b></span>
      <span :class="{ 'has-warning': metrics.backpressure > 0 }"><i class="is-pressure" />Pressure <b>{{ integer(metrics.backpressure) }}</b></span>
      <span :class="{ 'has-danger': metrics.slowConsumers > 0 }"><i class="is-slow" />Slow <b>{{ integer(metrics.slowConsumers) }}</b></span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { RefreshCw } from "lucide-vue-next";
import { useGatewayMetrics } from "../gatewayMetrics";

const props = defineProps<{ webSocketEndpoint: string }>();
const {
  endpoint,
  error,
  lastUpdatedAt,
  metrics,
  outboundBytesRate,
  outboundRate,
  rateHistory,
  refresh,
  status,
} = useGatewayMetrics(props.webSocketEndpoint);

const statusLabel = computed(() => status.value === "ready" ? "Metrics online" : status.value === "error" ? "Metrics offline" : "Fetching metrics");
const updatedLabel = computed(() => lastUpdatedAt.value?.toLocaleTimeString([], { hour12: false }) || "--:--:--");

function integer(value: number): string {
  return Math.round(value).toLocaleString();
}

function decimal(value: number): string {
  return value < 10 ? value.toFixed(1) : Math.round(value).toLocaleString();
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${Math.round(value)} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KiB`;
  return `${(value / 1_048_576).toFixed(1)} MiB`;
}

function formatRate(value: number): string {
  return `${formatBytes(value)}/s`;
}

function barHeight(value: number): number {
  const max = Math.max(1, ...rateHistory.value);
  return Math.max(8, Math.round((value / max) * 100));
}
</script>
