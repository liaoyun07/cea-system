<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { errorText } from '../api.js';
import { time } from '../model.js';
const props = defineProps({ api: Function });
const emit = defineEmits(['pending']);
const registries = ref([]),
  registry = ref(''),
  repository = ref(''),
  repositoryFilter = ref('');
const images = ref([]),
  detail = ref(null),
  next = ref(null),
  cursors = ref([null]);
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
  if (registry.value) loadImages(true);
}
function changeRegistry() {
  repository.value = '';
  repositoryFilter.value = '';
  loadImages(true);
}
function filterImages(clear = false) {
  if (clear) repositoryFilter.value = '';
  repository.value = repositoryFilter.value.trim();
  loadImages(true);
}
function loadImages(reset = false) {
  if (reset) cursors.value = [null];
  images.value = [];
  detail.value = null;
  next.value = null;
  if (!registry.value) return;
  const query = new URLSearchParams({ limit: '20' });
  if (repository.value) query.set('repository', repository.value);
  const cursor = cursors.value.at(-1);
  if (cursor) {
    query.set('afterRepository', cursor.repository);
    query.set('afterDigest', cursor.digest);
  }
  return read(async (api, current) => {
    const page = await api(`${base.value}/inventory?${query}`);
    if (current()) {
      images.value = page.images;
      next.value = page.next;
    }
  });
}
function inspect(row) {
  detail.value = null;
  read(async (api, current) => {
    const value = await api(
      `${base.value}/image?repository=${encodeURIComponent(row.repository)}&digest=${encodeURIComponent(row.digest)}`,
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
      await loadImages(true);
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
      <button :disabled="loading || writing" @click="registry ? loadImages(true) : start()">刷新库存</button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="success" class="success" role="status">{{ success }}</p>
    <form class="inspection-controls resource-selector registry-filters" @submit.prevent="filterImages()">
      <label
        >仓库<select v-model="registry" aria-label="镜像仓库" :disabled="writing" @change="changeRegistry">
          <option v-for="row in registries" :key="row.id" :value="row.id">
            {{ row.id }} · {{ row.address }}
          </option>
        </select></label
      >
      <label
        >镜像仓库路径<input
          v-model="repositoryFilter"
          aria-label="镜像仓库路径"
          :disabled="writing"
          placeholder="全部路径，可输入关键字筛选"
          maxlength="255"
      /></label>
      <button type="submit" :disabled="writing || !registry">筛选</button>
      <button
        type="button"
        :disabled="writing || !registry || (!repository && !repositoryFilter)"
        @click="filterImages(true)"
      >
        清除
      </button>
    </form>
    <p v-if="loading" class="empty">正在查询实际仓库…</p>
    <section v-if="registry" class="panel">
      <div class="table-wrap">
        <table class="registry-inventory-table" aria-label="实际镜像库存">
          <thead>
            <tr>
              <th>镜像路径</th>
              <th>标签 / 短摘要</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in images" :key="`${row.repository}@${row.digest}`">
              <td>
                <code>{{ row.repository }}</code>
              </td>
              <td>
                <span v-if="row.tags.length">{{ row.tags.join(', ') }}</span>
                <span v-else
                  >无标签 · <code>{{ row.digest.slice(7, 19) }}…</code></span
                >
              </td>
              <td><button :disabled="loading || writing" @click="inspect(row)">镜像详情</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!loading && !images.length && !error" class="empty">
        {{ repository ? '没有符合筛选条件的镜像' : '当前仓库暂无可列出的镜像' }}
      </p>
      <div class="pagination">
        <button
          :disabled="loading || writing || cursors.length === 1"
          @click="
            cursors.pop();
            loadImages();
          "
        >
          上一页
        </button>
        <span>第 {{ cursors.length }} 页 · 每页 20 条</span>
        <button
          :disabled="loading || writing || !next"
          @click="
            cursors.push(next);
            loadImages();
          "
        >
          下一页
        </button>
      </div>
    </section>
    <section v-if="detail" class="panel" aria-label="镜像详情">
      <div class="page-heading">
        <h2>镜像详情</h2>
        <button :disabled="writing" @click="detail = null">关闭</button>
      </div>
      <dl class="detail-grid">
        <dt>仓库路径</dt>
        <dd>
          <code>{{ detail.repository }}</code>
        </dd>
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
        <dt>关联应用版本</dt>
        <dd>
          <template v-if="detail.applications.length">
            <div v-for="name in detail.applications" :key="name">{{ name }}</div>
          </template>
          <span v-else>未关联应用</span>
        </dd>
        <dt>服务部署</dt>
        <dd>
          <template v-if="detail.deployments.length">
            <div v-for="name in detail.deployments" :key="name">{{ name }}</div>
          </template>
          <span v-else>{{
            detail.blockers.includes('服务部署检查不可用，禁止删除') ? '查询不可用' : '未作为服务部署'
          }}</span>
        </dd>
      </dl>
      <p v-if="detail.applications.length || detail.deployments.length" class="muted small">
        已关联应用或服务部署，不能直接删除镜像。
      </p>
      <ul v-if="detail.blockers.length" class="error">
        <li v-for="message in detail.blockers" :key="message">{{ message }}</li>
      </ul>
      <button
        class="danger"
        :disabled="
          writing ||
          loading ||
          detail.applications.length > 0 ||
          detail.deployments.length > 0 ||
          detail.blockers.length > 0
        "
        @click="remove"
      >
        从当前仓库删除镜像
      </button>
    </section>
  </section>
</template>
<style scoped>
.registry-filters {
  flex-wrap: wrap;
}
.registry-filters label {
  min-width: 0;
  max-width: 100%;
  flex: 0 1 320px;
}
.registry-inventory-table {
  min-width: 520px;
}
@media (max-width: 650px) {
  .registry-filters label {
    flex: 1 1 100%;
  }
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
