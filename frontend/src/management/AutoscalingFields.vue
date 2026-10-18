<script setup>
defineProps({ value: Object, max: { type: Number, default: 100 } });
</script>
<template>
  <div class="form-grid">
    <label
      >最小副本数<input v-model.number="value.minReplicas" type="number" min="1" :max="max" step="1" required
    /></label>
    <label
      >最大副本数<input
        v-model.number="value.maxReplicas"
        type="number"
        :min="value.minReplicas"
        :max="max"
        step="1"
        required
    /></label>
    <label
      >CPU 目标利用率（%）<input
        v-model.number="value.cpuUtilization"
        type="number"
        min="1"
        step="1"
        placeholder="可选"
    /></label>
    <label
      >内存目标利用率（%）<input
        v-model.number="value.memoryUtilization"
        type="number"
        min="1"
        step="1"
        placeholder="可选"
    /></label>
  </div>
</template>
