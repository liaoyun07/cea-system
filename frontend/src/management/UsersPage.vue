<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { errorText } from '../api.js';
const props = defineProps({ api: Function, mode: String, profile: Object });
const emit = defineEmits(['dirty', 'pending', 'password-changed']);
const rows = ref([]),
  offset = ref(0),
  busy = ref(false),
  error = ref(''),
  success = ref('');
const draft = ref(null),
  baseline = ref(''),
  creating = ref(false),
  resetFor = ref(null),
  resetPassword = ref('');
const currentPassword = ref(''),
  newPassword = ref(''),
  repeatedPassword = ref('');
const abort = new AbortController();
let alive = true;
const dirty = computed(
  () =>
    !!currentPassword.value ||
    !!newPassword.value ||
    !!repeatedPassword.value ||
    !!resetPassword.value ||
    (draft.value && JSON.stringify(draft.value) !== baseline.value),
);
watch(dirty, (v) => emit('dirty', !!v), { flush: 'sync' });
watch(busy, (v) => emit('pending', v), { flush: 'sync' });
onBeforeUnmount(() => {
  alive = false;
  abort.abort();
});
const api = (path, options = {}) =>
  props.api(path, { ...options, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]) });
async function action(work) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    await work();
  } catch (e) {
    if (alive) error.value = errorText(e);
  } finally {
    if (alive) busy.value = false;
  }
}
async function load() {
  const result = await api(`/users?limit=20&offset=${offset.value}`);
  if (alive) rows.value = result;
}
function open(row) {
  if (busy.value) return;
  creating.value = !row;
  draft.value = row
    ? { name: row.name, role: row.role, enabled: row.enabled, namespaces: [...row.namespaces] }
    : { name: '', password: '', role: 'USER', enabled: true, namespaces: [...props.profile.namespaces] };
  baseline.value = JSON.stringify(draft.value);
  resetFor.value = null;
  resetPassword.value = '';
  error.value = '';
  success.value = '';
}
function back() {
  if (busy.value || (dirty.value && !window.confirm('放弃未保存的修改？'))) return;
  draft.value = null;
  resetFor.value = null;
  resetPassword.value = '';
  error.value = '';
}
async function save() {
  await action(async () => {
    const d = draft.value;
    await api(creating.value ? '/users' : `/users/${encodeURIComponent(d.name)}`, {
      method: creating.value ? 'POST' : 'PUT',
      body: creating.value
        ? { name: d.name, password: d.password, role: d.role, namespaces: d.namespaces }
        : { role: d.role, enabled: d.enabled, namespaces: d.namespaces },
    });
    if (!alive) return;
    draft.value = null;
    await load();
    success.value = '用户已保存';
  });
}
async function changePassword() {
  await action(async () => {
    if (newPassword.value !== repeatedPassword.value) throw new Error('两次新密码不一致');
    await api('/me/password', {
      method: 'PUT',
      body: { currentPassword: currentPassword.value, newPassword: newPassword.value },
    });
    if (!alive) return;
    currentPassword.value = '';
    newPassword.value = '';
    repeatedPassword.value = '';
    busy.value = false;
    emit('password-changed');
  });
}
async function reset() {
  await action(async () => {
    await api(`/users/${encodeURIComponent(resetFor.value)}/password`, {
      method: 'PUT',
      body: { password: resetPassword.value },
    });
    if (!alive) return;
    resetFor.value = null;
    resetPassword.value = '';
    success.value = '密码已重置';
  });
}
onMounted(() => {
  if (props.mode === 'users') action(load);
});
</script>
<template>
  <section class="list-page management-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">{{ mode === 'users' ? 'USERS' : 'PROFILE' }}</span>
        <h1>{{ mode === 'users' ? '用户管理' : '个人中心' }}</h1>
      </div>
      <button
        v-if="mode === 'users' && !draft && !resetFor"
        class="primary"
        :disabled="busy"
        @click="open(null)"
      >
        ＋ 新建用户
      </button>
      <button v-if="draft || resetFor" :disabled="busy" @click="back">← 返回列表</button>
    </div>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <div v-if="success" class="notice success" role="status">{{ success }}</div>
    <template v-if="mode === 'profile'">
      <section class="management-editor">
        <h2>{{ profile.name }}</h2>
        <p>{{ profile.role === 'ADMIN' ? '管理员' : '普通用户' }}</p>
        <p>工作空间：{{ profile.namespaces.join('、') }}</p>
      </section>
      <form class="management-editor" @submit.prevent="changePassword">
        <h2>修改密码</h2>
        <label
          >当前密码<input
            v-model="currentPassword"
            type="password"
            autocomplete="current-password"
            required
            :disabled="busy"
        /></label>
        <label
          >新密码<input
            v-model="newPassword"
            type="password"
            minlength="10"
            autocomplete="new-password"
            required
            :disabled="busy"
        /></label>
        <label
          >确认新密码<input
            v-model="repeatedPassword"
            type="password"
            minlength="10"
            autocomplete="new-password"
            required
            :disabled="busy"
        /></label>
        <button class="primary" :disabled="busy">修改密码并重新登录</button>
      </form>
    </template>
    <form v-else-if="draft" class="management-editor" @submit.prevent="save">
      <h2>{{ creating ? '新建用户' : '编辑用户' }}</h2>
      <label
        >账号<input
          v-model="draft.name"
          required
          :disabled="busy || !creating"
          pattern="[A-Za-z][A-Za-z0-9_.-]{0,99}"
          autocomplete="off"
      /></label>
      <label v-if="creating"
        >初始密码<input
          v-model="draft.password"
          required
          type="password"
          minlength="10"
          :disabled="busy"
          autocomplete="new-password"
      /></label>
      <label
        >角色<select v-model="draft.role" :disabled="busy || draft.name === profile.name">
          <option value="USER">普通用户</option>
          <option value="ADMIN">管理员</option>
        </select></label
      >
      <fieldset :disabled="busy">
        <legend>授权工作空间</legend>
        <label v-for="ns in profile.namespaces" :key="ns" class="check"
          ><input v-model="draft.namespaces" type="checkbox" :value="ns" />{{ ns }}</label
        >
      </fieldset>
      <label v-if="!creating" class="check"
        ><input
          v-model="draft.enabled"
          type="checkbox"
          :disabled="busy || draft.name === profile.name"
        />允许登录</label
      >
      <button class="primary" :disabled="busy || !draft.namespaces.length">保存用户</button>
    </form>
    <form v-else-if="resetFor" class="management-editor" @submit.prevent="reset">
      <h2>重置 {{ resetFor }} 的密码</h2>
      <label
        >新密码<input
          v-model="resetPassword"
          type="password"
          minlength="10"
          required
          autocomplete="new-password"
          :disabled="busy" /></label
      ><button class="primary" :disabled="busy">确认重置</button>
    </form>
    <template v-else>
      <div class="list-toolbar"><button :disabled="busy" @click="action(load)">刷新</button></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>账号</th>
              <th>角色</th>
              <th>状态</th>
              <th>工作空间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.name">
              <td>{{ row.name }}</td>
              <td>{{ row.role === 'ADMIN' ? '管理员' : '普通用户' }}</td>
              <td>{{ row.enabled ? '启用' : '停用' }}</td>
              <td>{{ row.namespaces.join('、') }}</td>
              <td>
                <div class="button-row">
                  <button :disabled="busy" @click="open(row)">编辑用户</button
                  ><button
                    v-if="row.name !== profile.name"
                    :disabled="busy"
                    @click="
                      resetFor = row.name;
                      resetPassword = '';
                    "
                  >
                    重置密码
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer class="pagination">
        <span>每页 20 条 · 第 {{ offset / 20 + 1 }} 页</span>
        <div>
          <button
            :disabled="busy || offset === 0"
            @click="
              offset -= 20;
              action(load);
            "
          >
            上一页</button
          ><button
            :disabled="busy || rows.length < 20"
            @click="
              offset += 20;
              action(load);
            "
          >
            下一页
          </button>
        </div>
      </footer>
    </template>
  </section>
</template>
