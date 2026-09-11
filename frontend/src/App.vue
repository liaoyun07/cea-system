<script setup>
import { computed, markRaw, onBeforeUnmount, ref } from 'vue';
import { basicAuthorization, createApi, errorText } from './api.js';
import { time } from './model.js';
import FlowEditor from './FlowEditor.vue';
import ExecutionDetail from './ExecutionDetail.vue';
import CatalogPage from './management/CatalogPage.vue';
import DeploymentsPage from './management/DeploymentsPage.vue';
import { catalogs } from './management/catalogs.js';

const navigation = [
  {
    label: '工作空间',
    items: [
      ['flows', '流程', '◇'],
      ['executions', '执行', '▷'],
    ],
  },
  {
    label: '应用与资源',
    items: [
      ['applications', '应用与镜像', '▣'],
      ['deployments', '应用部署', '▤'],
      ['clusters', '集群资源', '⬡'],
      ['datasets', '数据集', '▥'],
    ],
  },
  {
    label: '边缘与终端',
    items: [
      ['gateways', '边缘网关', '⌁'],
      ['terminals', '终端设备', '▱'],
      ['policies', '边缘处理策略', '⋈'],
      ['observations', '卸载观测', '↗'],
    ],
  },
];
const titleFor = (key) =>
  catalogs[key]?.title || { flows: '流程', executions: '执行', deployments: '应用部署' }[key];

const namespace = ref('lab'),
  username = ref('developer'),
  password = ref('');
const session = ref(null),
  page = ref('flows'),
  pageEpoch = ref(0),
  selectedFlow = ref(null),
  selectedExecution = ref(null);
const editorTitle = ref('');
const flows = ref([]),
  executions = ref([]),
  query = ref(''),
  offset = ref(0),
  busy = ref(false),
  error = ref('');
const dirty = ref(false),
  pending = ref(false),
  connected = computed(() => !!session.value);
const pageTitle = computed(() =>
  page.value === 'flows'
    ? selectedFlow.value !== null
      ? editorTitle.value || selectedFlow.value || '新建流程'
      : '流程'
    : selectedExecution.value || titleFor(page.value),
);
let requestGeneration = 0;

function mayLeave() {
  return (
    !(dirty.value || pending.value) ||
    window.confirm(
      pending.value
        ? '有请求结果尚未确认。离开将丢失当前请求的重试信息，请先核对服务端状态。仍然离开？'
        : '有未保存的修改，确定离开并放弃这些修改？',
    )
  );
}
function beforeUnload(event) {
  if (dirty.value || pending.value) {
    event.preventDefault();
    event.returnValue = '';
  }
}
window.addEventListener('beforeunload', beforeUnload);
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));

async function login() {
  busy.value = true;
  error.value = '';
  try {
    const ns = namespace.value.trim();
    if (!ns) throw new Error('请填写命名空间');
    const api = createApi(ns, basicAuthorization(username.value, password.value));
    const rows = await api('/flows?limit=20&offset=0');
    session.value = { namespace: ns, username: username.value, api: markRaw(api) };
    password.value = '';
    flows.value = rows;
    page.value = 'flows';
    offset.value = 0;
    query.value = '';
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
function logout() {
  if (!mayLeave()) return;
  requestGeneration++;
  session.value = null;
  password.value = '';
  flows.value = [];
  executions.value = [];
  selectedFlow.value = null;
  selectedExecution.value = null;
  dirty.value = false;
  pending.value = false;
  error.value = '';
}
async function loadList() {
  const generation = ++requestGeneration;
  busy.value = true;
  error.value = '';
  try {
    const suffix =
      `?limit=20&offset=${offset.value}` +
      (page.value === 'flows' ? `&q=${encodeURIComponent(query.value)}` : '');
    const rows = await session.value.api(`/${page.value}${suffix}`);
    if (generation !== requestGeneration) return;
    if (page.value === 'flows') flows.value = rows;
    else executions.value = rows;
  } catch (e) {
    if (generation === requestGeneration) error.value = errorText(e);
  } finally {
    if (generation === requestGeneration) busy.value = false;
  }
}
function navigate(target) {
  if (busy.value || !mayLeave()) return;
  page.value = target;
  pageEpoch.value++;
  selectedFlow.value = null;
  selectedExecution.value = null;
  dirty.value = false;
  pending.value = false;
  offset.value = 0;
  requestGeneration++;
  error.value = '';
  if (['flows', 'executions'].includes(target)) loadList();
}
function edit(id) {
  if (!mayLeave()) return;
  dirty.value = false;
  pending.value = false;
  selectedFlow.value = id;
  editorTitle.value = id;
}
function showExecution(id) {
  if (!mayLeave()) return;
  dirty.value = false;
  pending.value = false;
  selectedFlow.value = null;
  page.value = 'executions';
  selectedExecution.value = id;
}
function started(id) {
  // Submission already succeeded; no pending request remains in the editor.
  pending.value = false;
  showExecution(id);
}
function paginate(delta) {
  offset.value += delta * 20;
  loadList();
}
</script>

<template>
  <div v-if="!connected" class="login-layout">
    <div class="login-brand">
      <span class="brand-mark">C</span><strong>CEA</strong><span>云边端协同平台</span>
    </div>
    <form class="login-card" @submit.prevent="login">
      <span class="eyebrow">WORKSPACE</span>
      <h1>连接工作空间</h1>
      <p class="muted">使用新后端账号进入流程与执行工作台。</p>
      <label>命名空间<input v-model="namespace" required autocomplete="off" placeholder="lab" /></label>
      <label>账号<input v-model="username" required autocomplete="username" /></label>
      <label>密码<input v-model="password" required type="password" autocomplete="current-password" /></label>
      <div v-if="error" class="notice error" role="alert">{{ error }}</div>
      <button class="primary full" :disabled="busy">{{ busy ? '正在连接…' : '连接工作空间 →' }}</button>
      <p class="small muted">凭据仅保留在当前页面内存，刷新后需重新连接。</p>
    </form>
    <p class="login-foot">独立工作台 · 一个 Flow 定义，一条执行链</p>
  </div>
  <div v-else class="workspace">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">C</span><strong>CEA<span>WORKFLOW</span></strong>
      </div>
      <div class="workspace-name">
        <span class="tiny-dot"></span>{{ session.namespace }}<small>命名空间</small>
      </div>
      <nav aria-label="主导航">
        <template v-for="group in navigation" :key="group.label">
          <div class="nav-caption">{{ group.label }}</div>
          <button
            v-for="[key, title, icon] in group.items"
            :key="key"
            :aria-label="title"
            :class="{ active: page === key }"
            :disabled="busy"
            @click="navigate(key)"
          >
            <span class="nav-icon" aria-hidden="true">{{ icon }}</span
            >{{ title }}
          </button>
        </template>
      </nav>
      <div class="sidebar-bottom">
        <div class="avatar">{{ session.username.slice(0, 1).toUpperCase() }}</div>
        <div class="account">{{ session.username }}<small>已连接</small></div>
        <button class="icon-button" aria-label="断开连接" :disabled="busy" @click="logout">↪</button>
      </div>
    </aside>
    <main>
      <header class="breadcrumb">
        <span>{{ session.namespace }}</span
        ><span>/</span><button @click="navigate(page)" :disabled="busy">{{ titleFor(page) }}</button
        ><template v-if="selectedFlow !== null || selectedExecution"
          ><span>/</span><span class="crumb-current">{{ pageTitle }}</span></template
        >
      </header>
      <div v-if="error" class="notice error outer-notice" role="alert">{{ error }}</div>
      <FlowEditor
        v-if="page === 'flows' && selectedFlow !== null"
        :key="selectedFlow"
        :api="session.api"
        :namespace="session.namespace"
        :flow-id="selectedFlow"
        @dirty="dirty = $event"
        @pending="pending = $event"
        @started="started"
        @saved-title="editorTitle = $event"
      />
      <ExecutionDetail
        v-else-if="page === 'executions' && selectedExecution"
        :key="selectedExecution"
        :api="session.api"
        :execution-id="selectedExecution"
      />
      <CatalogPage
        v-else-if="catalogs[page]"
        :key="`${session.namespace}/${page}/${pageEpoch}`"
        :kind="page"
        :api="session.api"
        :namespace="session.namespace"
        @dirty="dirty = $event"
        @pending="pending = $event"
        @execution="showExecution"
      />
      <DeploymentsPage
        v-else-if="page === 'deployments'"
        :key="pageEpoch"
        :api="session.api"
        @dirty="dirty = $event"
        @pending="pending = $event"
      />
      <section v-else class="list-page">
        <div class="page-heading">
          <div>
            <span class="eyebrow">{{ page === 'flows' ? 'FLOWS' : 'EXECUTIONS' }}</span>
            <h1>{{ pageTitle }}</h1>
            <p class="muted">
              {{ page === 'flows' ? '定义、校验并运行你的工作流。' : '查看实际执行状态、任务实例与输出。' }}
            </p>
          </div>
          <button v-if="page === 'flows'" class="primary" :disabled="busy" @click="edit('')">
            ＋ 新建流程
          </button>
        </div>
        <div class="list-toolbar">
          <form
            v-if="page === 'flows'"
            class="search"
            @submit.prevent="
              offset = 0;
              loadList();
            "
          >
            <input
              aria-label="搜索流程"
              v-model="query"
              placeholder="搜索 ID 或描述…"
              maxlength="200"
            /><button :disabled="busy">搜索</button>
          </form>
          <span v-else class="muted">按创建时间显示执行记录</span>
          <button :disabled="busy" @click="loadList">{{ busy ? '加载中…' : '↻ 刷新' }}</button>
        </div>
        <div class="table-wrap">
          <table v-if="page === 'flows'">
            <thead>
              <tr>
                <th>流程 ID</th>
                <th>命名空间</th>
                <th>修订</th>
                <th>创建者</th>
                <th>更新时间</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="flow in flows" :key="flow.flowId">
                <td>
                  <button class="text-link mono" :disabled="busy" @click="edit(flow.flowId)">
                    {{ flow.flowId }}
                  </button>
                </td>
                <td>
                  <span class="tag">{{ flow.namespace }}</span>
                </td>
                <td>r{{ flow.revision }}</td>
                <td>{{ flow.createdBy }}</td>
                <td>{{ time(flow.createdAt) }}</td>
                <td><button :disabled="busy" @click="edit(flow.flowId)">编辑 →</button></td>
              </tr>
            </tbody>
          </table>
          <table v-else>
            <thead>
              <tr>
                <th>执行 ID</th>
                <th>流程</th>
                <th>状态</th>
                <th>修订</th>
                <th>创建时间</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="run in executions" :key="run.id">
                <td>
                  <button class="text-link mono" :disabled="busy" @click="showExecution(run.id)">
                    {{ run.id }}
                  </button>
                </td>
                <td>{{ run.flowId }}</td>
                <td>
                  <span class="status" :data-state="run.state">{{ run.state }}</span>
                </td>
                <td>r{{ run.flowRevision }}</td>
                <td>{{ time(run.createdAt) }}</td>
                <td><button :disabled="busy" @click="showExecution(run.id)">详情 →</button></td>
              </tr>
            </tbody>
          </table>
          <div v-if="!(page === 'flows' ? flows : executions).length" class="empty">
            <span>◇</span>
            <h2>{{ busy ? '正在加载…' : page === 'flows' ? '暂无流程' : '暂无执行记录' }}</h2>
            <p>
              {{
                page === 'flows'
                  ? '创建流程或调整搜索条件。不会自动导入示例模板。'
                  : '保存流程并启动后，执行记录会出现在这里。'
              }}
            </p>
          </div>
        </div>
        <footer class="pagination">
          <span>每页 20 条 · 第 {{ offset / 20 + 1 }} 页</span>
          <div>
            <button :disabled="busy || offset === 0" @click="paginate(-1)">上一页</button
            ><button
              :disabled="busy || (page === 'flows' ? flows : executions).length < 20"
              @click="paginate(1)"
            >
              下一页
            </button>
          </div>
        </footer>
      </section>
    </main>
  </div>
</template>
