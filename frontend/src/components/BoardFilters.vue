<template>
  <nav class="mode-tabs" aria-label="Board scope">
    <button v-for="mode in modes" :key="mode.value" type="button"
      :class="{ 'is-active': activeTopic.showScope === mode.value }" @click="emitTopic({ showScope: mode.value })">
      <Radio v-if="mode.value === 'live'" :size="14" />
      <Trophy v-else :size="14" />
      {{ mode.label }}
    </button>
    <span class="mode-tabs__feed">
      <i :class="{ 'is-live': status === 'connected' }" />
      {{ status === "connected" ? "Streaming" : "Awaiting feed" }}
    </span>
  </nav>

  <div class="filter-row filter-row--sports">
    <span class="filter-label">Sport</span>
    <div class="scroll-strip">
      <button v-for="sport in sports" :key="sport.id" type="button" class="filter-chip"
        :class="{ 'is-active': activeTopic.sportCode === sport.id }" @click="emitTopic({ sportCode: sport.id })">
        {{ sport.label }}
      </button>
    </div>
  </div>

  <div class="filter-row">
    <div class="segmented" aria-label="Grouping mode">
      <button type="button" :class="{ 'is-active': activeTopic.groupMode === 'league' }"
        @click="emitTopic({ groupMode: 'league' })">
        <List :size="14" /> League
      </button>
      <button type="button" :class="{ 'is-active': activeTopic.groupMode === 'time' }"
        @click="emitTopic({ groupMode: 'time' })">
        <Clock3 :size="14" /> Time
      </button>
    </div>

    <div class="market-select">
      <span class="filter-label">Primary market</span>
      <AppSelect :model-value="activeTopic.primaryMarketTabCode" :options="marketOptions"
        @update:model-value="emitTopic({ primaryMarketTabCode: $event })" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Clock3, List, Radio, Trophy } from "lucide-vue-next";
import AppSelect, { type SelectOption } from "./AppSelect.vue";
import type { ConnectionStatus, TopicItem } from "../types";

defineProps<{
  sports: Array<{ id: string; label: string }>;
  activeTopic: TopicItem;
  status: ConnectionStatus;
}>();

const emit = defineEmits<{ updateTopic: [patch: Partial<TopicItem>] }>();

const modes: Array<{ label: string; value: TopicItem["showScope"] }> = [
  { label: "Sports", value: "all" },
  { label: "Live now", value: "live" },
];
const marketOptions: SelectOption[] = [
  { value: "1x2", label: "Match result" },
  { value: "2up", label: "2 Up" },
  { value: "ou", label: "Over / Under" },
  { value: "handicap", label: "Handicap" },
];

function emitTopic(patch: Partial<TopicItem>) {
  emit("updateTopic", patch);
}
</script>