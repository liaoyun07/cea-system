<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { errorText } from '../api.js';
import { readCatalog } from '../no-code/document.js';
import DistributionHistory from './DistributionHistory.vue';

const props = defineProps({ api: Function });
const applications = ref([]),
  selected = ref(''),
  loading = ref(false),
  error = ref('');
const key = (row) => `${row.applicationId}/${row.version}`;
const application = computed(() => applications.value.find((row) => key(row) === selected.value));
const controller = new AbortController();
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const values = await readCatalog(
      (path) =>
        props.api(path, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        }),
      '/applications',
    );
    if (controller.signal.aborted) return;
    applications.value = values;
    if (!values.some((row) => key(row) === selected.value)) selected.value = '';
  } catch (e) {
    if (!controller.signal.aborted) error.value = errorText(e);
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}
onMounted(load);
onBeforeUnmount(() => controller.abort());
</script>

<template>
  <section class="list-page management-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">DISTRIBUTIONS</span>
        <h1>应用分发记录</h1>
      </div>
      <button :disabled="loading" @click="load">刷新应用</button>
    </div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <div class="inspection-controls resource-selector">
      <label
        >应用版本<select v-model="selected" aria-label="分发记录应用版本" :disabled="loading">
          <option value="">全部应用版本</option>
          <option v-for="row in applications" :key="key(row)" :value="key(row)">{{ key(row) }}</option>
        </select></label
      >
    </div>
    <DistributionHistory :api="api" :application="application" />
  </section>
</template>
