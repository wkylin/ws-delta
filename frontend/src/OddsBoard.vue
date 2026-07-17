<template>
  <section class="odds-board">
    <BoardFilters :sports="sports" :active-topic="activeTopic" :status="status" @update-topic="emitTopic" />
    <BoardMatchList :groups="groups" :flashes="flashes" :status="status" />
  </section>
</template>

<script setup lang="ts">
import BoardFilters from "./components/BoardFilters.vue";
import BoardMatchList from "./components/BoardMatchList.vue";
import type { BoardGroup, ConnectionStatus, TopicItem, Trend } from "./types";

const props = defineProps<{
  groups: BoardGroup[];
  sports: Array<{ id: string; label: string }>;
  activeTopic: TopicItem;
  flashes: Record<string, Trend>;
  status: ConnectionStatus;
}>();

const emit = defineEmits<{
  updateTopic: [patch: Partial<TopicItem>];
}>();

function emitTopic(patch: Partial<TopicItem>) {
  emit("updateTopic", patch);
}
</script>
