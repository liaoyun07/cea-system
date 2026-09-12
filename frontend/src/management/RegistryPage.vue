<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { errorText } from '../api.js';
import { time } from '../model.js';
const props = defineProps({ api: Function });
const emit = defineEmits(['pending']);
const registries = ref([]),
  registry = ref(''),
  repositories = ref([]),
  repository = ref('');
const images = ref([]),
  detail = ref(null),
  next = ref(null),
  cursors = ref(['']);
const error = ref(''),
  loading = ref(false),
  writing = ref(false),
  success = ref('');
const base = computed(() => `/registries/${encodeURIComponent(registry.value)}`);
watch(writing, (value) => emit('pending', value), { flush: 'sync' });
let generation = 0,
  controller;
async function read(work) {
  const current = ++generation;
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  error.value = '';
  success.value = '';
  const request = (path) =>
    props.api(path, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) });
  try {
    await work(request, () => current === generation);
  } catch (e) {
    if (current === generation) error.value = errorText(e);
  } finally {
    if (current === generation) loading.value = false;
  }
}
async function start() {
  await read(async (api, current) => {
    const rows = await api('/registries');
    if (!current()) return;
    registries.value = rows;
    registry.value = rows[0]?.id || '';
  });
  if (registry.value) loadRepositories(true);
}
function loadRepositories(reset = false) {
  if (reset) cursors.value = [''];
  repository.value = '';
  repositories.value = [];
  images.value = [];
  detail.value = null;
  next.value = null;
  read(async (api, current) => {
    const page = await api(`${base.value}/repositories?last=${encodeURIComponent(cursors.value.at(-1))}`);
    if (current()) {
      repositories.value = page.repositories;
      next.value = page.next;
    }
  });
}
function loadImages() {
  images.value = [];
  detail.value = null;
  if (!repository.value) return;
  read(async (api, current) => {
    const rows = await api(`${base.value}/images?repository=${encodeURIComponent(repository.value)}`);
    if (current()) images.value = rows;
  });
}
function inspect(row) {
  detail.value = null;
  read(async (api, current) => {
    const value = await api(
      `${base.value}/image?repository=${encodeURIComponent(repository.value)}&digest=${encodeURIComponent(row.digest)}`,
    );
    if (current()) detail.value = value;
  });
}
async function remove() {
  const value = detail.value,
    exact = `${value.repository}@${value.digest}`;
  if (
    window.prompt(
      `从当前仓库删除此 manifest 及指向它的标签？不会删除应用登记，不执行磁盘 GC。\n请输入完整引用确认：\n${exact}`,
    ) !== exact
  )
    return;
  const current = generation;
  writing.value = true;
  error.value = '';
  try {
    await props.api(
      `${base.value}/image?repository=${encodeURIComponent(value.repository)}&digest=${encodeURIComponent(value.digest)}&confirmation=${encodeURIComponent(exact)}`,
      { method: 'DELETE', signal: AbortSignal.timeout(60000) },
    );
    if (current === generation) {
      detail.value = null;
      images.value = images.value.filter((row) => row.digest !== value.digest);
      success.value = '仓库已确认删除 manifest；未执行磁盘 GC。';
    }
  } catch (e) {
    if (current === generation) error.value = errorText(e);
  } finally {
    writing.value = false;
  }
}
onMounted(start);
onBeforeUnmount(() => {
  generation++;
  controller?.abort();
});
</script>
<template>
  <section class="list-page management-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">REGISTRIES</span>
        <h1>镜像仓库</h1>
      </div>
      <button
        :disabled="loading || writing"
        @click="registry ? (repository ? loadImages() : loadRepositories()) : start()"
      >
        刷新库存
      </button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="success" class="success" role="status">{{ success }}</p>
    <div class="inspection-controls resource-selector">
      <label
        >仓库<select
          v-model="registry"
          aria-label="镜像仓库"
          :disabled="loading || writing"
          @change="loadRepositories(true)"
        >
          <option v-for="row in registries" :key="row.id" :value="row.id">
            {{ row.id }} · {{ row.address }}
          </option>
        </select></label
      >
      <label
        >镜像仓库路径<select
          v-model="repository"
          aria-label="镜像仓库路径"
          :disabled="loading || writing"
          @change="loadImages"
        >
          <option value="">选择路径</option>
          <option v-for="row in repositories" :key="row" :value="row">{{ row }}</option>
        </select></label
      >
    </div>
    <div v-if="registry" class="pagination">
      <button
        :disabled="loading || writing || cursors.length === 1"
        @click="
          cursors.pop();
          loadRepositories();
        "
      >
        上一页路径</button
      ><span>第 {{ cursors.length }} 页</span
      ><button
        :disabled="loading || writing || !next"
        @click="
          cursors.push(next);
          loadRepositories();
        "
      >
        下一页路径
      </button>
    </div>
    <p v-if="loading" class="empty">正在查询实际仓库…</p>
    <section v-if="repository" class="panel">
      <h2>{{ repository }}</h2>
      <div class="table-wrap">
        <table aria-label="实际镜像库存">
          <thead>
            <tr>
              <th>Digest</th>
              <th>标签</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in images" :key="row.digest">
              <td>
                <code>{{ row.digest }}</code>
              </td>
              <td>{{ row.tags.join(', ') || '无标签（已核验）' }}</td>
              <td><button :disabled="loading || writing" @click="inspect(row)">镜像详情</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!loading && !images.length && !error" class="empty">没有可列出的标签或已知 digest</p>
    </section>
    <section v-if="detail" class="panel" aria-label="镜像详情">
      <div class="page-heading">
        <h2>镜像详情</h2>
        <button :disabled="writing" @click="detail = null">关闭</button>
      </div>
      <dl class="detail-grid">
        <dt>Digest</dt>
        <dd>
          <code>{{ detail.digest }}</code>
        </dd>
        <dt>标签</dt>
        <dd>{{ detail.tags.join(', ') || '无标签' }}</dd>
        <dt>媒体类型</dt>
        <dd>{{ detail.mediaType }}</dd>
        <dt>压缩层合计</dt>
        <dd>
          {{ detail.layerBytes == null ? '多平台索引' : `${(detail.layerBytes / 1048576).toFixed(2)} MiB` }}
        </dd>
        <dt>构建时间</dt>
        <dd>{{ detail.created ? time(detail.created) : '未记录' }}</dd>
        <dt>平台</dt>
        <dd>
          <div v-for="p in detail.platforms" :key="p.digest">
            {{ p.os || '—' }} / {{ p.architecture || '—' }}{{ p.variant ? ` / ${p.variant}` : '' }}
          </div>
        </dd>
      </dl>
      <ul v-if="detail.blockers.length" class="error">
        <li v-for="message in detail.blockers" :key="message">{{ message }}</li>
      </ul>
      <button class="danger" :disabled="writing || loading || detail.blockers.length > 0" @click="remove">
        从当前仓库删除镜像
      </button>
    </section>
  </section>
</template>
<style scoped>
@media (max-width: 650px) {
  .detail-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  .detail-grid dd {
    margin-bottom: 12px;
  }
}
</style>
<style scoped>
code,
dd {
  overflow-wrap: anywhere;
}
</style>
