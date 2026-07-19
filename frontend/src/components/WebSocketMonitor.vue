<template>
  <section class="monitor-view" aria-label="WebSocket monitor">
    <header class="monitor-head">
      <div>
        <p class="section-label">Transport observability</p>
        <h2>WebSocket monitor</h2>
      </div>
      <div class="monitor-head__meta">
        <span class="monitor-status" :class="`is-${status}`"><i />{{ status }}</span>
        <button type="button" class="monitor-clear" @click="clearSession"><Trash2 :size="14" />Clear session</button>
      </div>
    </header>

    <div class="monitor-kpis">
      <article><span>Session</span><strong>#{{ state.session }}</strong><small>{{ time(state.startedAt) }}</small></article>
      <article><span>Frames</span><strong><em>↓{{ state.inbound }}</em> / <b>↑{{ state.outbound }}</b></strong><small>{{ bytes(state.bytes) }} total</small></article>
      <article><span>Ready</span><strong>{{ state.readyCount }}</strong><small>{{ short(state.streamId) }}</small></article>
      <article class="is-alert">
        <span>Incidents</span>
        <strong class="incident-counts">
          <a v-if="state.errors" :href="incidentHref('error')" aria-label="Jump to latest error details" @click.prevent="jumpToIncident('error')">{{ state.errors }}</a>
          <span v-else>0</span>
          <i>/</i>
          <a v-if="state.warnings" class="is-warning" :href="incidentHref('warning')" aria-label="Jump to latest warning details" @click.prevent="jumpToIncident('warning')">{{ state.warnings }}</a>
          <span v-else class="is-warning">0</span>
        </strong>
        <small>errors / warnings</small>
      </article>
      <article><span>Inbound cadence</span><strong>{{ Math.round(state.averageInboundGapMs) }}ms</strong><small>EWMA frame gap</small></article>
    </div>

    <div class="monitor-grid">
      <article class="monitor-panel">
        <header><div><p class="section-label">Message dimensions</p><h3>Type breakdown</h3></div><Braces :size="17" /></header>
        <div class="metric-table">
          <div class="metric-table__head"><span>#</span><span>Type</span><span>Total</span><span>Direction / bytes / time</span></div>
          <div v-for="(metric, index) in typeMetrics" :key="metric.type" class="metric-table__row"><i>{{ index + 1 }}</i><code>{{ metric.type }}</code><strong>{{ metric.total }}</strong><small><em>↓{{ metric.inbound }}</em> <b>↑{{ metric.outbound }}</b> · {{ bytes(metric.lastBytes) }} / {{ bytes(metric.bytes) }} · {{ time(metric.lastAt) }}</small></div>
          <p v-if="!typeMetrics.length" class="monitor-empty">No frames yet</p>
        </div>
      </article>

      <article class="monitor-panel">
        <header><div><p class="section-label">Subscription dimensions</p><h3>Topic breakdown</h3></div><Layers3 :size="17" /></header>
        <div class="metric-table">
          <div class="metric-table__head"><span>#</span><span>Topic</span><span>Total</span><span>Direction / seq / type</span></div>
          <div v-for="(metric, index) in topicMetrics" :key="metric.topic" class="metric-table__row"><i>{{ index + 1 }}</i><code :title="metric.topic">{{ metric.topic }}</code><strong>{{ metric.total }}</strong><small><em>↓{{ metric.inbound }}</em> <b>↑{{ metric.outbound }}</b> · seq {{ metric.lastSeq ?? "--" }} · {{ metric.lastType }} · {{ time(metric.lastAt) }}</small></div>
          <p v-if="!topicMetrics.length" class="monitor-empty">No topic frames yet</p>
        </div>
      </article>
    </div>

    <article id="incidents" class="monitor-panel monitor-incidents">
      <header><div><p class="section-label">Failure context</p><h3>Errors and warnings</h3></div><TriangleAlert :size="17" /></header>
      <div v-if="incidents.length" class="incident-list">
        <details v-for="entry in incidents" :id="`incident-${entry.id}`" :key="entry.id" :class="`is-${entry.severity}`">
          <summary><span /><time>{{ time(entry.at) }}</time><strong>{{ entry.title }}</strong><code>{{ entry.kind }}</code></summary>
          <pre>{{ json(entry.detail) }}</pre>
        </details>
      </div>
      <p v-else class="monitor-empty">No errors or warnings in this session</p>
    </article>

    <article class="monitor-panel monitor-stream">
      <header><div><p class="section-label">Full session trace</p><h3>Frame stream</h3></div><Activity :size="17" /></header>
      <div class="stream-legend"><span>{{ timeline.length }} records</span><span>↓ inbound</span><span>↑ outbound</span><span>lifecycle</span></div>
      <div v-if="timeline.length" class="frame-list">
        <details v-for="entry in timeline" :key="`${entry.category}-${entry.id}`">
          <summary v-if="entry.category === 'frame'"><time>{{ time(entry.at) }}</time><span class="frame-direction" :class="entry.direction">{{ entry.direction === "inbound" ? "↓" : "↑" }}</span><code>{{ entry.type }}</code><span class="frame-topic">{{ entry.topic || "control" }}</span><span>{{ bytes(entry.bytes) }}</span><b v-if="entry.seq != null">#{{ entry.seq }}</b></summary>
          <summary v-else><time>{{ time(entry.at) }}</time><span class="frame-direction lifecycle">•</span><code>{{ entry.kind }}</code><span class="frame-topic">{{ entry.title }}</span><span>{{ entry.severity || "info" }}</span></summary>
          <pre>{{ json(entry.category === "frame" ? entry.payload : entry.detail) }}</pre>
        </details>
      </div>
      <p v-else class="monitor-empty">Waiting for WebSocket activity</p>
    </article>
  </section>
</template>

<script setup lang="ts">
import { Activity, Braces, Layers3, Trash2, TriangleAlert } from "lucide-vue-next";
import type { ConnectionStatus } from "../types";
import {
  startTelemetrySession,
  wsIncidents,
  wsTelemetryState,
  wsTimeline,
  wsTopicMetrics,
  wsTypeMetrics,
} from "../wsTelemetry";

defineProps<{ status: ConnectionStatus }>();
const state = wsTelemetryState;
const typeMetrics = wsTypeMetrics;
const topicMetrics = wsTopicMetrics;
const incidents = wsIncidents;
const timeline = wsTimeline;

function clearSession(): void { startTelemetrySession(false); }
function incidentHref(severity: "error" | "warning"): string {
  const entry = incidents.value.find((incident) => incident.severity === severity);
  return entry ? `#incident-${entry.id}` : "#incidents";
}
function jumpToIncident(severity: "error" | "warning"): void {
  const entry = incidents.value.find((incident) => incident.severity === severity);
  if (!entry) return;
  const detail = document.getElementById(`incident-${entry.id}`) as HTMLDetailsElement | null;
  if (!detail) return;
  detail.open = true;
  detail.scrollIntoView({ behavior: "smooth", block: "center" });
  detail.querySelector("summary")?.focus({ preventScroll: true });
}
function bytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KiB`;
  return `${(value / 1_048_576).toFixed(1)} MiB`;
}
function time(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--:--:--" : date.toLocaleTimeString([], { hour12: false });
}
function short(value: string): string { return value ? `${value.slice(0, 8)}…${value.slice(-4)}` : "pending"; }
function json(value: unknown): string {
  if (value == null) return "No additional detail";
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
</script>

<style scoped>
.monitor-view { min-width:0; padding:24px; overflow:auto; }.monitor-head { display:flex; justify-content:space-between; align-items:flex-end; gap:20px; max-width:1500px; margin:0 auto 16px; }.monitor-head__meta { display:flex; align-items:center; gap:12px; }.monitor-status { display:flex; align-items:center; gap:7px; color:var(--muted); font:10px var(--mono); text-transform:uppercase; }.monitor-status i { width:7px; height:7px; border-radius:50%; background:var(--faint); }.monitor-status.is-connected i { background:var(--green); box-shadow:0 0 0 4px rgba(56,217,150,.1); }.monitor-status.is-connecting i,.monitor-status.is-reconnecting i { background:var(--amber); }.monitor-clear { display:flex; align-items:center; gap:6px; padding:8px 10px; border:1px solid var(--line); border-radius:4px; color:var(--muted); background:var(--surface); cursor:pointer; font-size:10px; }.monitor-clear:hover { color:var(--text); border-color:var(--line-bright); }
.monitor-kpis { display:grid; grid-template-columns:repeat(5,1fr); max-width:1500px; margin:0 auto 14px; border:1px solid var(--line); background:var(--surface); }.monitor-kpis article { min-width:0; padding:14px 16px; border-left:1px solid var(--line); }.monitor-kpis article:first-child { border-left:0; }.monitor-kpis > article > span,.monitor-kpis small { display:block; color:var(--faint); font:9px var(--mono); text-transform:uppercase; }.monitor-kpis strong { display:block; margin:7px 0 5px; font:20px var(--mono); }.monitor-kpis strong em { color:var(--green); font-style:normal; }.monitor-kpis strong b { color:var(--amber); }.monitor-kpis .is-alert strong { color:var(--red); }.incident-counts a,.incident-counts span { display:inline; color:inherit; font:inherit; text-decoration:underline; text-decoration-thickness:1px; text-underline-offset:3px; }.incident-counts span { text-decoration:none; }.incident-counts a:hover { color:#ff8e8e; }.monitor-kpis .incident-counts .is-warning { color:var(--amber); }.monitor-kpis .incident-counts a.is-warning:hover { color:#ffd47b; }.incident-counts i { color:var(--faint); font-style:normal; }
.monitor-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; max-width:1500px; margin:0 auto; }.monitor-panel { min-width:0; padding:18px; border:1px solid var(--line); border-radius:6px; background:var(--surface); }.monitor-panel > header { display:flex; justify-content:space-between; align-items:flex-start; color:var(--muted); margin-bottom:14px; }.monitor-panel h3 { margin:5px 0 0; font-size:16px; }.metric-table { border-top:1px solid var(--line); }.metric-table__head,.metric-table__row { display:grid; grid-template-columns:24px minmax(0,1fr) 64px minmax(0,1.4fr); gap:10px; align-items:center; min-height:39px; border-bottom:1px solid var(--line); }.metric-table__head { color:var(--faint); font:9px var(--mono); }.metric-table__head span:nth-child(n+3),.metric-table__row strong,.metric-table__row small { text-align:right; }.metric-table__row i { color:var(--faint); font:9px var(--mono); font-style:normal; text-align:right; }.metric-table__row code { overflow:hidden; color:var(--text); font:11px var(--mono); text-overflow:ellipsis; white-space:nowrap; }.metric-table__row strong { color:var(--green); font:12px var(--mono); }.metric-table__row small { overflow:hidden; color:var(--muted); font:9px var(--mono); text-overflow:ellipsis; white-space:nowrap; }.metric-table__row small em { color:var(--green); font-style:normal; }.metric-table__row small b { color:var(--amber); }
.monitor-incidents,.monitor-stream { max-width:1500px; margin:14px auto 0; }.incident-list,.frame-list { border-top:1px solid var(--line); max-height:460px; overflow:auto; }.incident-list details,.frame-list details { border-bottom:1px solid var(--line); }.incident-list summary,.frame-list summary { display:grid; align-items:center; gap:9px; min-height:40px; cursor:pointer; list-style:none; font:10px var(--mono); }.incident-list summary { grid-template-columns:8px 70px minmax(0,1fr) 150px; }.incident-list summary > span { width:6px; height:6px; border-radius:50%; background:var(--amber); }.incident-list .is-error summary > span { background:var(--red); }.incident-list time,.incident-list code { color:var(--muted); }.incident-list pre,.frame-list pre { max-height:300px; margin:0 0 12px 96px; padding:12px; overflow:auto; border:1px solid var(--line); color:#b9d6ca; background:#0e1215; font:10px/1.55 var(--mono); white-space:pre-wrap; }.stream-legend { display:flex; gap:15px; padding-bottom:12px; color:var(--faint); font:9px var(--mono); }.frame-list summary { grid-template-columns:70px 20px 140px minmax(0,1fr) 75px 70px; }.frame-list time,.frame-list summary > span,.frame-list b { color:var(--muted); }.frame-list code { overflow:hidden; color:var(--text); text-overflow:ellipsis; white-space:nowrap; }.frame-direction { font-size:16px; text-align:center; }.frame-direction.inbound { color:var(--green); }.frame-direction.outbound { color:var(--amber); }.frame-direction.lifecycle { color:var(--blue); }.frame-topic { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.monitor-empty { min-height:80px; display:grid; place-items:center; margin:0; color:var(--faint); font:10px var(--mono); }
@media (max-width:1000px) { .monitor-kpis { grid-template-columns:repeat(2,1fr); }.monitor-kpis article { border-top:1px solid var(--line); }.monitor-kpis .is-alert { border-right:1px solid var(--line); border-bottom:1px solid var(--line); }.monitor-grid { grid-template-columns:1fr; } }
@media (max-width:600px) { .monitor-view { padding:14px; overflow-x:hidden; }.monitor-head { align-items:flex-start; flex-direction:column; }.monitor-head__meta { width:100%; justify-content:space-between; }.monitor-kpis { grid-template-columns:minmax(0,1fr) minmax(0,1fr); }.monitor-kpis article { padding:12px; }.monitor-kpis strong { overflow-wrap:anywhere; }.monitor-panel { padding:14px; }.monitor-panel > header { margin-bottom:12px; }.metric-table__head,.metric-table__row { grid-template-columns:20px minmax(0,1fr) 50px; min-height:0; row-gap:6px; line-height:1.35; }.metric-table__head { padding:8px 0 10px; }.metric-table__head span:last-child { grid-column:1/-1; padding-top:2px; text-align:left; }.metric-table__row { padding:9px 0 10px; }.metric-table__row i,.metric-table__row code,.metric-table__row strong { align-self:start; }.metric-table__row code { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.metric-table__row small { grid-column:1/-1; padding-left:20px; text-align:left; line-height:1.4; }.stream-legend { flex-wrap:wrap; gap:7px 12px; }.frame-list summary { grid-template-columns:58px 18px minmax(0,1fr) auto; }.frame-topic { grid-column:3; }.incident-list summary { grid-template-columns:8px 58px minmax(0,1fr); }.incident-list code { grid-column:3; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.incident-list pre,.frame-list pre { margin-left:0; overflow-wrap:anywhere; } }
</style>
