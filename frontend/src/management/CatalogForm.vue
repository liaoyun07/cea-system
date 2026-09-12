<script setup>
import NoCodeEditor from '../no-code/NoCodeEditor.vue';
import { ref } from 'vue';
const props = defineProps({
  kind: String,
  draft: Object,
  existing: Boolean,
  readonly: Boolean,
  upload: Boolean,
  busy: Boolean,
  api: Function,
  namespace: String,
  clusters: Array,
  datasets: Array,
  gateways: Array,
});
const emit = defineEmits(['invalid']);
const tab = ref('nocode');
function addParameter() {
  props.draft.parameterRows.push({
    name: '',
    type: 'STRING',
    required: false,
    defaultJson: '',
    choicesJson: '',
    dataset: false,
    format: '',
    allowed: [],
  });
}
</script>

<template>
  <fieldset class="catalog-fields" :disabled="busy || readonly">
    <div class="form-grid">
      <template v-if="kind === 'applications'">
        <label
          >应用 ID<input v-model="draft.applicationId" required maxlength="100" :disabled="existing"
        /></label>
        <label>版本<input v-model="draft.version" required maxlength="100" :disabled="existing" /></label>
        <label v-if="!upload" class="span-2"
          >镜像引用<input
            v-model="draft.image"
            required
            placeholder="registry/repository:tag 或 repository@sha256:…"
        /></label>
      </template>
      <template v-else-if="kind === 'datasets'">
        <label
          >数据集 ID<input v-model="draft.datasetId" required maxlength="100" :disabled="existing"
        /></label>
        <label>版本<input v-model="draft.version" required maxlength="100" :disabled="existing" /></label>
        <label
          >数据格式<input v-model="draft.format" required placeholder="pt、csv 等，与应用契约精确一致"
        /></label>
      </template>
      <template v-else>
        <label
          >{{ { clusters: '集群 ID', gateways: '网关 ID', terminals: '终端 ID', policies: '策略 ID' }[kind]
          }}<input v-model="draft.id" required maxlength="100" :disabled="existing"
        /></label>
        <label v-if="kind === 'clusters'"
          >计算层<select v-model="draft.kind" aria-label="计算层">
            <option value="EDGE">边缘 EDGE</option>
            <option value="CLOUD">云 CLOUD</option>
          </select></label
        >
        <template v-if="kind === 'gateways' || kind === 'policies'">
          <label
            >边缘集群<select v-model="draft.clusterId" aria-label="边缘集群" required :disabled="existing">
              <option value="" disabled>选择边缘集群</option>
              <option v-for="c in clusters.filter((c) => c.kind === 'EDGE')" :key="c.id" :value="c.id">
                {{ c.id }}{{ c.enabled ? '' : '（已禁用）' }}
              </option>
            </select></label
          >
          <label v-if="kind === 'gateways'"
            >CONNECT 账号<input
              v-model="draft.principal"
              required
              :disabled="existing"
              placeholder="后端已配置的接入账号名，不是密码"
          /></label>
          <label v-else
            >事件类型<input
              v-model="draft.eventType"
              required
              :disabled="existing"
              placeholder="例如 sensor-reading"
          /></label>
        </template>
        <label v-if="kind === 'terminals'"
          >所属网关<select v-model="draft.gatewayId" aria-label="所属网关" required :disabled="existing">
            <option value="" disabled>选择网关</option>
            <option v-for="g in gateways" :key="g.id" :value="g.id">
              {{ g.id }}{{ g.enabled ? '' : '（已停用）' }}
            </option>
          </select></label
        >
        <label class="check-label"
          ><input type="checkbox" v-model="draft.enabled" />{{
            kind === 'clusters' ? '允许参与执行' : kind === 'policies' ? '启用事件触发' : '允许接入'
          }}</label
        >
      </template>
    </div>

    <section v-if="kind === 'datasets'" class="catalog-section">
      <div class="section-heading">
        <h2>集群数据位置</h2>
        <button v-if="!readonly" type="button" @click="draft.locations.push({ clusterId: '', uri: '' })">
          ＋ 添加位置
        </button>
      </div>
      <div v-for="(location, i) in draft.locations" :key="i" class="location-row">
        <label
          >位置 {{ i + 1 }} · 集群<select
            v-model="location.clusterId"
            :aria-label="`位置 ${i + 1} · 集群`"
            required
          >
            <option value="" disabled>选择集群</option>
            <option v-for="c in clusters" :key="c.id" :value="c.id">{{ c.id }} · {{ c.kind }}</option>
          </select></label
        >
        <label
          >位置 {{ i + 1 }} · S3 URI<input
            v-model="location.uri"
            required
            placeholder="s3://bucket/dataset/version/data.pt"
        /></label>
        <button
          v-if="!readonly"
          type="button"
          :aria-label="`移除位置 ${i + 1}`"
          @click="draft.locations.splice(i, 1)"
        >
          移除
        </button>
      </div>
      <p v-if="!draft.locations.length" class="muted">暂无数据位置</p>
    </section>

    <section v-if="kind === 'applications'" class="catalog-section">
      <div class="section-heading">
        <h2>镜像参数契约</h2>
        <button v-if="!readonly" type="button" @click="addParameter">＋ 添加参数</button>
      </div>
      <div v-if="readonly && draft.parameterRows.length" class="table-wrap compact-contract">
        <table>
          <thead>
            <tr>
              <th>参数</th>
              <th>类型</th>
              <th>必填</th>
              <th>默认值</th>
              <th>允许值 / 数据集约束</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in draft.parameterRows" :key="p.name">
              <td class="mono">{{ p.name }}</td>
              <td>{{ p.type }}</td>
              <td>{{ p.required ? '是' : '否' }}</td>
              <td class="mono">{{ p.defaultJson || '未声明' }}</td>
              <td>{{ p.dataset ? `${p.format} · ${p.allowed.join('、')}` : p.choicesJson || '不限制' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-for="(p, i) in readonly ? [] : draft.parameterRows" :key="i" class="parameter-card">
        <div class="form-grid">
          <label>参数 {{ i + 1 }} · 名称<input v-model="p.name" required /></label>
          <label
            >参数 {{ i + 1 }} · 类型<select v-model="p.type" :aria-label="`参数 ${i + 1} · 类型`">
              <option v-for="t in ['STRING', 'INTEGER', 'NUMBER', 'BOOLEAN']" :key="t">{{ t }}</option>
            </select></label
          >
          <label
            >参数 {{ i + 1 }} · 默认值 JSON<input
              v-model="p.defaultJson"
              placeholder='例如 "mlp" 或 32；留空不声明'
          /></label>
          <label class="check-label"><input type="checkbox" v-model="p.required" />必填</label>
          <label class="check-label"
            ><input
              type="checkbox"
              v-model="p.dataset"
              :disabled="p.type !== 'STRING'"
            />数据集参数（STRING）</label
          >
          <label v-if="!p.dataset"
            >参数 {{ i + 1 }} · 允许值 JSON<input
              v-model="p.choicesJson"
              placeholder='例如 ["mlp", "cnn"]；留空不限制'
          /></label>
          <template v-else>
            <label
              >参数 {{ i + 1 }} · 数据格式<input
                v-model="p.format"
                required
                placeholder="与数据集登记格式精确一致"
            /></label>
            <label class="span-2"
              >参数 {{ i + 1 }} · 允许的数据集版本<select
                v-model="p.allowed"
                :aria-label="`参数 ${i + 1} · 允许的数据集版本`"
                multiple
                required
                size="3"
              >
                <option
                  v-for="d in datasets.filter((d) => d.format === p.format)"
                  :key="`${d.datasetId}/${d.version}`"
                  :value="`${d.datasetId}/${d.version}`"
                >
                  {{ d.datasetId }}/{{ d.version }} · {{ d.format }}
                </option>
              </select></label
            >
          </template>
        </div>
        <button
          v-if="!readonly"
          type="button"
          class="text-link danger-text"
          @click="draft.parameterRows.splice(i, 1)"
        >
          移除参数
        </button>
      </div>
      <p v-if="!draft.parameterRows.length" class="muted">此版本未声明业务参数。</p>
    </section>
  </fieldset>
  <section v-if="kind === 'policies'" class="policy-flow">
    <div class="section-heading">
      <h2>
        策略 Flow <small class="muted">{{ existing ? `r${draft.expectedRevision}` : '未保存' }}</small>
      </h2>
    </div>
    <div class="tabs" role="tablist" aria-label="策略编辑方式">
      <button type="button" role="tab" :aria-selected="tab === 'nocode'" @click="tab = 'nocode'">
        可视化编排</button
      ><button type="button" role="tab" :aria-selected="tab === 'yaml'" @click="tab = 'yaml'">源代码</button>
    </div>
    <NoCodeEditor
      v-if="tab === 'nocode'"
      v-model:source="draft.source"
      :api="api"
      :namespace="namespace"
      :flow-id="draft.id"
      :disabled="busy"
      @invalid="emit('invalid', $event)"
      @show-source="tab = 'yaml'"
    />
    <label v-else class="source-label"
      >策略 Flow YAML<textarea
        v-model="draft.source"
        class="source-editor"
        spellcheck="false"
        rows="22"
        :disabled="busy"
      />
    </label>
  </section>
</template>
