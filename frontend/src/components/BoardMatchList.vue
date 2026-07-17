<template>
  <div v-if="!groups.length" class="board-empty">
    <LoaderCircle v-if="status !== 'offline'" :size="22" class="spin" />
    <WifiOff v-else :size="22" />
    <strong>{{ status === "connected" ? "Hydrating board" : "Feed unavailable" }}</strong>
    <span>{{ status === "connected" ? "Waiting for the first topic snapshot." : "Start the mock server on port 8088."
      }}</span>
  </div>

  <div v-else class="league-list">
    <section v-for="group in groups" :key="`${group.country}:${group.league}`" class="league-group">
      <header class="league-head">
        <span class="league-head__pin" />
        <span>{{ group.country }}</span>
        <strong>{{ group.league }}</strong>
        <b>{{ group.rows.length }}</b>
      </header>

      <article v-for="row in group.rows" :key="row.id" class="match-row">
        <div class="match-state" :class="{ 'is-live': row.isLive }">
          <Radio v-if="row.isLive" :size="13" />
          <CalendarClock v-else :size="13" />
          <span>{{ row.isLive ? row.livePhase || "LIVE" : row.kickoff || "TBD" }}</span>
        </div>

        <div class="match-info">
          <div class="match-info__teams"><span>{{ row.homeTeam }}</span><span>{{ row.awayTeam }}</span></div>
          <strong v-if="row.score" class="match-score">{{ row.score }}</strong>
          <div class="match-info__meta"><span>{{ row.marketName || "Primary market" }}</span><span
              v-if="row.extraMarkets">+{{ row.extraMarkets }} markets</span></div>
        </div>

        <div class="market-grid" :style="{ '--market-count': Math.min(3, Math.max(1, row.markets.length)) }">
          <button v-for="market in row.markets.slice(0, 3)" :key="market.key" type="button" class="odd-cell"
            :class="[flashFor(row.id, market) ? `is-${flashFor(row.id, market)}` : '', { 'is-locked': market.locked, 'is-selected': isSelected(row.id, market.key) }]"
            :disabled="market.locked" @click="toggleSelection(row.id, market.key)">
            <span>{{ market.label }}</span>
            <strong>{{ market.locked ? "--" : market.value.toFixed(2) }}</strong>
            <ArrowUp v-if="flashFor(row.id, market) === 'up'" :size="12" />
            <ArrowDown v-if="flashFor(row.id, market) === 'down'" :size="12" />
          </button>
        </div>

        <button type="button" class="row-action" title="Open match" aria-label="Open match">
          <ChevronRight :size="17" />
        </button>
      </article>
    </section>
  </div>
</template>

<script setup lang="ts">
import { reactive } from "vue";
import { ArrowDown, ArrowUp, CalendarClock, ChevronRight, LoaderCircle, Radio, WifiOff } from "lucide-vue-next";
import type { BoardGroup, ConnectionStatus, MarketCell, Trend } from "../types";

const props = defineProps<{
  groups: BoardGroup[];
  flashes: Record<string, Trend>;
  status: ConnectionStatus;
}>();

const selected = reactive(new Set<string>());

function identity(rowId: string, market: MarketCell): string {
  return `${rowId}|${market.sourceMarketKey || ""}|${market.sourceOutcomeCode || market.key}`;
}

function flashFor(rowId: string, market: MarketCell): Trend | undefined {
  return props.flashes[identity(rowId, market)];
}

function selectionKey(rowId: string, marketKey: string): string {
  return `${rowId}|${marketKey}`;
}

function isSelected(rowId: string, marketKey: string): boolean {
  return selected.has(selectionKey(rowId, marketKey));
}

function toggleSelection(rowId: string, marketKey: string) {
  const key = selectionKey(rowId, marketKey);
  if (selected.has(key)) selected.delete(key);
  else selected.add(key);
}
</script>