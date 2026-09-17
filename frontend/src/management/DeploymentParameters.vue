<script setup>
defineProps({ fields: Array });
const choiceValue = (type, value) =>
  ['STRING', 'SELECT'].includes(type)
    ? value
    : JSON.stringify(value, null, ['OBJECT', 'ARRAY'].includes(type) ? 2 : 0);
</script>
<template>
  <div class="deployment-parameters">
    <p v-if="!fields.length" class="muted">此应用未声明业务参数。</p>
    <div v-for="field in fields" :key="field.name" class="parameter-field">
      <div class="parameter-heading">
        <label :for="`deployment-param-${field.name}`"
          >{{ field.name }}<span v-if="field.required" class="required"> *</span></label
        >
        <span class="tag">{{ field.type }}</span>
        <label v-if="!field.required" class="provided"
          ><input type="checkbox" v-model="field.provided" :aria-label="`设置 ${field.name}`" />设置</label
        >
      </div>
      <select
        v-if="field.choices?.length"
        :id="`deployment-param-${field.name}`"
        :aria-label="field.name"
        v-model="field.value"
        :disabled="!field.provided"
      >
        <option disabled value="">请选择</option>
        <option
          v-for="(choice, index) in field.choices"
          :key="index"
          :value="choiceValue(field.type, choice)"
        >
          {{ choiceValue(field.type, choice) }}
        </option>
      </select>
      <label v-else-if="field.type === 'BOOLEAN'" class="boolean-value"
        ><input
          :id="`deployment-param-${field.name}`"
          :aria-label="field.name"
          type="checkbox"
          :checked="field.value === 'true'"
          :disabled="!field.provided"
          @change="field.value = String($event.target.checked)"
        />{{ field.value === 'true' ? '开启' : '关闭' }}</label
      >
      <textarea
        v-else-if="['OBJECT', 'ARRAY'].includes(field.type)"
        :id="`deployment-param-${field.name}`"
        :aria-label="field.name"
        v-model="field.value"
        :disabled="!field.provided"
        :required="field.provided"
        rows="3"
        spellcheck="false"
        :placeholder="field.type === 'OBJECT' ? JSON.stringify({ key: 'value' }) : '[1, 2, 3]'"
      />
      <input
        v-else
        :id="`deployment-param-${field.name}`"
        :aria-label="field.name"
        :value="field.value"
        @input="field.value = $event.target.value"
        :disabled="!field.provided"
        :type="['NUMBER', 'INTEGER'].includes(field.type) ? 'number' : 'text'"
        :step="field.type === 'INTEGER' ? '1' : 'any'"
        :required="field.provided && field.type !== 'STRING'"
      />
    </div>
  </div>
</template>
<style scoped>
.deployment-parameters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}
.parameter-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.parameter-heading > label:first-child {
  flex-direction: row;
  margin: 0;
  overflow-wrap: anywhere;
}
.provided {
  margin: 0 0 0 auto;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.provided input,
.boolean-value input {
  width: auto;
  margin: 0;
}
.boolean-value {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  min-height: 42px;
}
.required {
  color: #a52b41;
}
@media (max-width: 850px) {
  .deployment-parameters {
    grid-template-columns: 1fr;
  }
}
</style>
