<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <p class="brand-kicker">Protocol workbench</p>
          <h1>WS / REALTIME</h1>
        </div>
      </div>

      <nav class="view-switch" aria-label="Workspace view">
        <button type="button" :class="{ 'is-active': view === 'board' }" @click="view = 'board'">Board</button>
        <button type="button" :class="{ 'is-active': view === 'monitor' }" @click="view = 'monitor'">Monitor</button>
      </nav>

      <div class="connection-strip">
        <span class="connection-state" :class="`is-${status}`">
          <span class="connection-state__dot" />
          {{ statusLabel }}
        </span>
        <span class="connection-endpoint">{{ endpoint }}</span>
        <button
          type="button"
          class="icon-button"
          title="Reconnect WebSocket"
          aria-label="Reconnect WebSocket"
          @click="reconnect"
        >
          <RefreshCw :size="16" />
        </button>
      </div>
    </header>

    <main v-if="view === 'board'" class="workspace">
      <section class="board-stage" aria-label="Realtime odds board">
        <div class="stage-heading">
          <div>
            <p class="section-label">Live data surface</p>
            <h2>Odds board</h2>
          </div>
          <dl class="stage-metrics">
            <div>
              <dt>Rows</dt>
              <dd>{{ rows.length }}</dd>
            </div>
            <div>
              <dt>Sequence</dt>
              <dd>{{ currentSeq || "--" }}</dd>
            </div>
            <div>
              <dt>Last frame</dt>
              <dd>{{ lastMessageAt }}</dd>
            </div>
          </dl>
        </div>

        <OddsBoard
          :groups="groups"
          :sports="sportOptions"
          :active-topic="activeTopic"
          :flashes="flashes"
          :status="status"
          @update-topic="updateTopic"
        />
      </section>

      <aside class="inspector" aria-label="Protocol inspector">
        <header class="inspector__head">
          <div>
            <p class="section-label">Wire activity</p>
            <h2>Protocol stream</h2>
          </div>
          <button
            type="button"
            class="icon-button"
            title="Clear protocol log"
            aria-label="Clear protocol log"
            @click="clearLogs"
          >
            <Trash2 :size="15" />
          </button>
        </header>

        <div class="seq-rail">
          <span>stream</span>
          <code :title="streamId">{{ shortStreamId }}</code>
          <span>topic key</span>
          <code :title="topicKey">{{ shortTopicKey }}</code>
        </div>

        <GatewayMetrics :web-socket-endpoint="endpoint" />

        <div class="traffic-grid">
          <button type="button" @click="resetStats">
            <span>Messages</span><strong>{{ stats.messages }}</strong>
          </button>
          <button type="button" @click="resetStats">
            <span>Traffic</span><strong>{{ formatBytes(stats.bytes) }}</strong>
          </button>
          <button type="button" @click="resetStats">
            <span>Odds patches</span><strong>{{ stats.oddsPatches }}</strong>
          </button>
          <button type="button" @click="resetStats">
            <span>Seq gaps</span><strong>{{ stats.gaps }}</strong>
          </button>
        </div>

        <div class="message-legend" aria-label="Message type totals">
          <span><i class="snapshot" />Snapshot {{ stats.snapshots }}</span>
          <span><i class="delta" />Topic {{ stats.topicDeltas }}</span>
          <span><i class="odds" />Outcome {{ stats.outcomeDeltas }}</span>
        </div>

        <ol class="protocol-log">
          <li v-if="!logs.length" class="protocol-log__empty">
            Waiting for WebSocket frames
          </li>
          <li v-for="entry in logs" :key="entry.id" :class="`is-${entry.tone}`">
            <div class="protocol-log__meta">
              <time>{{ entry.time }}</time>
              <span>{{ entry.bytes ? formatBytes(entry.bytes) : "local" }}</span>
            </div>
            <div class="protocol-log__event">
              <span class="protocol-log__pulse" />
              <code>{{ entry.type }}</code>
              <b v-if="entry.seq != null">#{{ entry.seq }}</b>
            </div>
            <p>{{ entry.summary }}</p>
          </li>
        </ol>
      </aside>
    </main>

    <WebSocketMonitor v-else :status="status" />

    <footer class="statusbar">
      <span>sports-realtime.v1</span>
      <span>snapshot + structure delta + outcome delta</span>
      <span class="statusbar__live"><i />{{ statusLabel }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { RefreshCw, Trash2 } from "lucide-vue-next";
import OddsBoard from "./OddsBoard.vue";
import GatewayMetrics from "./components/GatewayMetrics.vue";
import WebSocketMonitor from "./components/WebSocketMonitor.vue";
import { useRealtimeBoard } from "./realtime";

const {
  activeTopic,
  clearLogs,
  currentSeq,
  endpoint,
  flashes,
  formatBytes,
  groups,
  lastMessageAt,
  logs,
  reconnect,
  resetStats,
  rows,
  sportOptions,
  stats,
  status,
  streamId,
  topicKey,
  updateTopic,
} = useRealtimeBoard();
const view = ref<"board" | "monitor">("board");

const statusLabel = computed(() => {
  switch (status.value) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    default:
      return "Offline";
  }
});

const shortStreamId = computed(() =>
  streamId.value ? `${streamId.value.slice(0, 8)}...${streamId.value.slice(-4)}` : "pending",
);
const shortTopicKey = computed(() =>
  topicKey.value.length > 34 ? `${topicKey.value.slice(0, 31)}...` : topicKey.value,
);
</script>
