<template>
  <div ref="root" class="app-select">
    <button :id="triggerId" ref="trigger" type="button" class="app-select__trigger" :aria-expanded="isOpen"
      aria-haspopup="listbox" :aria-controls="listboxId" @click="toggle" @keydown="handleTriggerKeydown">
      <span>{{ selectedOption?.label ?? placeholder }}</span>
      <ChevronDown :size="15" :class="{ 'is-open': isOpen }" />
    </button>

    <ul v-if="isOpen" :id="listboxId" ref="listbox" class="app-select__menu" role="listbox" :aria-labelledby="triggerId"
      @keydown="handleListboxKeydown">
      <li v-for="(option, index) in options" :key="option.value" role="none">
        <button :ref="(element) => setOptionElement(element, index)" type="button" class="app-select__option"
          :class="{ 'is-selected': option.value === modelValue }" role="option"
          :aria-selected="option.value === modelValue" tabindex="-1" @click="select(option.value)">
          <span>{{ option.label }}</span>
          <Check v-if="option.value === modelValue" :size="14" />
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { Check, ChevronDown } from "lucide-vue-next";

export interface SelectOption {
  label: string;
  value: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: SelectOption[];
    placeholder?: string;
  }>(),
  { placeholder: "Select an option" },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const listbox = ref<HTMLElement | null>(null);
const optionElements = ref<Array<HTMLButtonElement | null>>([]);
const isOpen = ref(false);
const activeIndex = ref(0);
const componentId = `app-select-${Math.random().toString(36).slice(2, 9)}`;
const triggerId = `${componentId}-trigger`;
const listboxId = `${componentId}-listbox`;

const selectedOption = computed(() =>
  props.options.find((option) => option.value === props.modelValue),
);

function setOptionElement(element: unknown, index: number) {
  optionElements.value[index] = element instanceof HTMLButtonElement ? element : null;
}

function open(focusIndex = props.options.findIndex((option) => option.value === props.modelValue)) {
  if (!props.options.length) return;
  activeIndex.value = focusIndex >= 0 ? focusIndex : 0;
  isOpen.value = true;
  void nextTick(() => optionElements.value[activeIndex.value]?.focus());
}

function close(focusTrigger = false) {
  isOpen.value = false;
  if (focusTrigger) void nextTick(() => trigger.value?.focus());
}

function toggle() {
  if (isOpen.value) close();
  else open();
}

function select(value: string) {
  emit("update:modelValue", value);
  close(true);
}

function moveActive(step: number) {
  const count = props.options.length;
  if (!count) return;
  activeIndex.value = (activeIndex.value + step + count) % count;
  optionElements.value[activeIndex.value]?.focus();
}

function handleTriggerKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    open(event.key === "ArrowDown" ? 0 : props.options.length - 1);
  }
}

function handleListboxKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveActive(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveActive(-1);
  } else if (event.key === "Home") {
    event.preventDefault();
    activeIndex.value = 0;
    optionElements.value[0]?.focus();
  } else if (event.key === "End") {
    event.preventDefault();
    activeIndex.value = props.options.length - 1;
    optionElements.value[activeIndex.value]?.focus();
  } else if (event.key === "Escape") {
    event.preventDefault();
    close(true);
  }
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (root.value?.contains(event.target as Node)) return;
  close();
}

document.addEventListener("pointerdown", handleDocumentPointerDown);
onBeforeUnmount(() => document.removeEventListener("pointerdown", handleDocumentPointerDown));
</script>