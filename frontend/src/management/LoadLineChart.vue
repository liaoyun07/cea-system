<script setup>
import { computed } from 'vue';
const props = defineProps({
  points: { type: Array, default: () => [] },
  from: Number,
  to: Number,
  unit: String,
  color: { type: String, default: '#7954d8' },
  percentage: Boolean,
  compact: Boolean,
  phases: { type: Array, default: () => [] },
});
const width = props.compact ? 480 : 900,
  height = 220,
  left = 48,
  top = 18,
  right = 15,
  bottom = 32;
const maximum = computed(
  () =>
    props.points.reduce((max, p) => Math.max(max, p.y || 0), props.percentage ? 100 : 1) *
    (props.percentage ? 1 : 1.1),
);
const x = (value) =>
  left + ((value - props.from) / Math.max(1, props.to - props.from)) * (width - left - right);
const y = (value) => top + (1 - value / maximum.value) * (height - top - bottom);
const path = computed(() => {
  let connected = false;
  return props.points
    .map((p) => {
      if (p.y == null) {
        connected = false;
        return '';
      }
      const point = `${connected ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`;
      connected = true;
      return point;
    })
    .join(' ');
});
const clock = (ms) => new Date(ms).toLocaleTimeString('zh-CN', { hour12: false });
</script>
<template>
  <div class="load-chart">
    <svg :viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="`${unit}趋势图`">
      <g v-for="ratio in [0, 0.5, 1]" :key="ratio">
        <line
          :x1="left"
          :x2="width - right"
          :y1="y(maximum * ratio)"
          :y2="y(maximum * ratio)"
          stroke="#e9e5f1"
        />
        <text :x="left - 10" :y="y(maximum * ratio) + 4" text-anchor="end">
          {{ (maximum * ratio).toFixed(percentage ? 0 : 1) }}
        </text>
      </g>
      <g
        v-for="phase in phases.filter(
          (p) => p.number > 1 && Date.parse(p.beganAt) > from && Date.parse(p.beganAt) < to,
        )"
        :key="phase.number"
      >
        <line
          :x1="x(Date.parse(phase.beganAt))"
          :x2="x(Date.parse(phase.beganAt))"
          :y1="top"
          :y2="height - bottom"
          stroke="#b9accf"
          stroke-dasharray="4 5"
        />
        <text :x="x(Date.parse(phase.beganAt)) + 5" :y="top + 12">切换策略</text>
      </g>
      <path :d="path" fill="none" :stroke="color" stroke-width="2.3" stroke-linejoin="round" />
      <circle
        v-for="(point, index) in points.filter((p) => p.y != null && p.label)"
        :key="index"
        :cx="x(point.x)"
        :cy="y(point.y)"
        r="3"
        :fill="color"
      >
        <title>{{ clock(point.x) }} · {{ point.label }}</title>
      </circle>
      <text :x="left" :y="height - 7">{{ clock(from) }}</text>
      <text :x="(width + left - right) / 2" :y="height - 7" text-anchor="middle">
        {{ clock((from + to) / 2) }}
      </text>
      <text :x="width - right" :y="height - 7" text-anchor="end">{{ clock(to) }}</text>
      <text v-if="!points.some((p) => p.y != null)" :x="width / 2" :y="height / 2" text-anchor="middle">
        暂无数据
      </text>
    </svg>
  </div>
</template>
<style scoped>
.load-chart {
  width: 100%;
  min-width: 0;
}
svg {
  width: 100%;
  display: block;
}
text {
  fill: #898298;
  font: 12px sans-serif;
}
</style>
