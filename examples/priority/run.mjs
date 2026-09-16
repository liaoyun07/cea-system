// Live CEA test. Only creates the two named Flows and their executions; SQL/Kubernetes are read-only.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile, appendFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const env = Object.fromEntries(
  (await readFile(`${root}/deploy/cea/.env`, "utf8"))
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_0-9]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const base = `http://127.0.0.1:${env.CEA_API_PORT}/api/namespaces/lab`;
const headers = {
  Authorization: `Basic ${Buffer.from(`${env.BACKEND_USER}:${env.BACKEND_PASSWORD}`).toString("base64")}`,
};
const resume = process.argv[2];
if (resume) assert.match(resume, /^priority-test-\d+$/);
const evidence = `${root}/.local/cea/${resume ?? `priority-test-${Date.now()}`}`;
await mkdir(evidence, { recursive: true });
const save = (name, value) =>
  writeFile(`${evidence}/${name}.json`, JSON.stringify(value, null, 2));
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
function sql(query) {
  const text = docker(
    "exec",
    "cea-mysql-1",
    "sh",
    "-c",
    'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -u"$MYSQL_USER" cea -N -B -e "$1"',
    "sh",
    query,
  );
  return text ? text.split(/\r?\n/).map((l) => JSON.parse(l)) : [];
}
async function api(path, method = "GET", body) {
  const r = await fetch(base + path, {
    method,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      ...(method === "POST" ? { "Idempotency-Key": randomUUID() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert(r.ok, `${method} ${path}: ${r.status} ${r.ok ? "" : await r.text()}`);
  return r.json();
}
async function all(path) {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const page = await api(`${path}?limit=100&offset=${offset}`);
    rows.push(...page);
    if (page.length < 100) return rows;
  }
}
function services() {
  const ids = docker(
    "ps",
    "-q",
    "--filter",
    "label=com.docker.compose.project=cea",
  ).split(/\s+/);
  return JSON.parse(docker("inspect", ...ids))
    .map((c) => ({
      id: c.Id,
      name: c.Name,
      image: c.Image,
      started: c.State.StartedAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
const config = await readFile(`${root}/deploy/cea/application.yaml`, "utf8");
assert.match(config, /lab: \{cloud: 2, edge-a: 6, edge-b: 6, edge-c: 6\}/);
const before = resume
  ? JSON.parse(await readFile(`${evidence}/before.json`, "utf8"))
  : {
      executions: await all("/executions"),
      flows: await Promise.all(
        (await all("/flows")).map((f) => api(`/flows/${f.flowId}`)),
      ),
      services: services(),
    };
if (!resume) {
  assert(
    before.executions.every((e) =>
      ["SUCCESS", "FAILED", "KILLED", "SKIPPED"].includes(e.state),
    ),
    "CEA must be idle before the test",
  );
  assert.equal(
    sql("SELECT COUNT(*) FROM res_job_reservation WHERE released=FALSE")[0],
    0,
    "Existing reservations",
  );
  assert.equal(
    sql("SELECT COUNT(*) FROM wf_worker_job")[0],
    0,
    "Existing worker jobs",
  );
  await save("before", before);
}
for (const name of resume ? [] : ["occupy", "compete"]) {
  const id = `priority-${name}`;
  assert(
    !before.flows.some((f) => f.flowId === id),
    `Flow ${id} already exists; do not overwrite`,
  );
  const source = await readFile(
    new URL(`${name}.yaml`, import.meta.url),
    "utf8",
  );
  await api(`/flows/${id}/validate`, "POST", { source });
  await api(`/flows/${id}/revisions`, "POST", { expectedRevision: 0, source });
}
const ids = resume
    ? JSON.parse(await readFile(`${evidence}/execution-ids.json`, "utf8"))
    : [],
  runs = new Map(),
  seen = new Set();
let queuedProof = null;
function pods() {
  if (!runs.size) return [];
  const names = [...runs.values()].map((t) => `cea-${t.id}-a1`);
  return JSON.parse(
    docker(
      "exec",
      "cea-cloud-1",
      "kubectl",
      "get",
      "pods",
      "-n",
      "cea-lab",
      "-l",
      `job-name in (${names.join(",")})`,
      "-o",
      "json",
    ),
  ).items;
}
function taskPod(list, id) {
  return list.find(
    (p) => p.metadata.labels["job-name"] === `cea-${runs.get(id)?.id}-a1`,
  );
}
function taskState(pod) {
  return pod?.status.containerStatuses?.find((c) => c.name === "task")?.state;
}
const started = (p) =>
  taskState(p)?.running?.startedAt ?? taskState(p)?.terminated?.startedAt;
const finished = (p) => taskState(p)?.terminated?.finishedAt;
async function observe() {
  for (const id of ids)
    for (const t of await api(`/executions/${id}/tasks`))
      if (["hold_a", "hold_b", "low", "high"].includes(t.taskId))
        runs.set(t.taskId, t);
  const queue = sql(
    `SELECT JSON_OBJECT('taskId',t.task_id,'queueState',w.state,'priority',w.priority,'enqueueOrder',w.enqueue_order,'attemptNo',w.attempt_no,'prepared',w.prepared_json IS NOT NULL,'cluster',r.cluster_id,'released',r.released) FROM wf_task_run t LEFT JOIN wf_worker_job w ON w.task_run_id=t.id LEFT JOIN res_job_reservation r ON r.namespace='lab' AND r.allocation_id=CONCAT(t.id,'-1') WHERE t.execution_id IN (${ids.map((id) => `'${id}'`).join(",")}) AND t.task_id IN ('hold_a','hold_b','low','high')`,
  );
  const list = pods(),
    now = new Date().toISOString();
  await appendFile(
    `${evidence}/observations.jsonl`,
    JSON.stringify({ at: now, queue, pods: list }) + "\n",
  );
  for (const row of queue)
    if (row.cluster && !seen.has(row.taskId)) {
      seen.add(row.taskId);
      console.log(`${now} observed reservation: ${row.taskId}`);
    }
  const low = queue.find((r) => r.taskId === "low"),
    high = queue.find((r) => r.taskId === "high");
  if (
    !queuedProof &&
    low?.queueState &&
    high?.queueState &&
    !low.cluster &&
    !high.cluster &&
    !taskPod(list, "low") &&
    !taskPod(list, "high")
  ) {
    assert(low.enqueueOrder < high.enqueueOrder);
    assert.equal(low.priority, 10);
    assert.equal(high.priority, 90);
    assert(!low.prepared);
    assert(!high.prepared);
    assert(
      queue.filter(
        (r) => ["hold_a", "hold_b"].includes(r.taskId) && !r.released,
      ).length === 2,
    );
    queuedProof = { at: now, low, high };
    await save("queued", queuedProof);
    console.log(
      `${now} low queued first; both waiting, neither reserved/prepared nor has a Pod`,
    );
  }
  return list;
}
async function until(label, predicate, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const list = await observe();
    if (await predicate(list)) return list;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${label} timed out; evidence retained: ${evidence}`);
}
try {
  if (!resume) {
    ids.push(
      (
        await api("/executions", "POST", {
          flowId: "priority-occupy",
          inputs: {},
        })
      ).executionId,
    );
    await save("execution-ids", ids);
    console.log(`occupy: ${ids[0]}`);
    await until(
      "both occupants running",
      (list) =>
        ["hold_a", "hold_b"].every(
          (id) => taskState(taskPod(list, id))?.running,
        ),
      60000,
    );
    ids.push(
      (
        await api("/executions", "POST", {
          flowId: "priority-compete",
          inputs: {},
        })
      ).executionId,
    );
    await save("execution-ids", ids);
    console.log(`compete: ${ids[1]}`);
  }
  const list = await until(
    "both executions terminal",
    async () => {
      const state = await Promise.all(
        ids.map((id) => api(`/executions/${id}`)),
      );
      return state.every((e) =>
        ["SUCCESS", "FAILED", "KILLED"].includes(e.state),
      );
    },
    300000,
  );
  const executions = await Promise.all(
    ids.map((id) => api(`/executions/${id}`)),
  );
  assert(executions.every((e) => e.state === "SUCCESS"));
  assert(queuedProof, "No proof of simultaneous resource wait");
  const rows = [];
  for (const id of ["hold_a", "high", "low", "hold_b"]) {
    const t = runs.get(id),
      p = taskPod(list, id);
    assert(p);
    assert.equal(taskState(p).terminated.exitCode, 0);
    const attempts = await api(
      `/executions/${t.executionId}/tasks/${t.id}/attempts`,
    );
    assert.equal(attempts.length, 1);
    const job = JSON.parse(
      docker(
        "exec",
        "cea-cloud-1",
        "kubectl",
        "get",
        "job",
        `cea-${t.id}-a1`,
        "-n",
        "cea-lab",
        "-o",
        "json",
      ),
    );
    await save(`job-${id}`, job);
    assert.equal(job.status.succeeded, 1);
    const logs = docker(
      "exec",
      "cea-cloud-1",
      "kubectl",
      "logs",
      p.metadata.name,
      "-n",
      "cea-lab",
      "-c",
      "task",
    );
    await writeFile(`${evidence}/${id}.log`, logs);
    rows.push({
      task: id,
      priority: id === "high" ? 90 : id === "low" ? 10 : 0,
      jobCreatedAt: job.metadata.creationTimestamp,
      containerStartedAt: started(p),
      containerFinishedAt: finished(p),
    });
  }
  const byId = Object.fromEntries(rows.map((r) => [r.task, r])),
    time = (s) => new Date(s).getTime();
  assert(time(byId.hold_a.containerFinishedAt) <= time(byId.high.jobCreatedAt));
  assert(time(byId.high.containerFinishedAt) <= time(byId.low.jobCreatedAt));
  assert(
    time(byId.low.containerFinishedAt) < time(byId.hold_b.containerFinishedAt),
    "B must remain running throughout competition",
  );
  const after = {
    executions: await all("/executions"),
    flows: await Promise.all(
      (await all("/flows")).map((f) => api(`/flows/${f.flowId}`)),
    ),
    services: services(),
  };
  for (const old of before.executions)
    assert.deepEqual(
      after.executions.find((e) => e.id === old.id),
      old,
    );
  for (const old of before.flows)
    assert.deepEqual(
      after.flows.find((f) => f.flowId === old.flowId),
      old,
    );
  assert.deepEqual(after.services, before.services);
  assert.equal(
    await readFile(`${root}/deploy/cea/application.yaml`, "utf8"),
    config,
  );
  assert.equal(
    sql("SELECT COUNT(*) FROM res_job_reservation WHERE released=FALSE")[0],
    0,
  );
  assert.equal(sql("SELECT COUNT(*) FROM wf_worker_job")[0], 0);
  await save("result", {
    result: "PASS",
    executionIds: ids,
    rows,
    queuedProof,
    preserved: {
      executions: before.executions.length,
      flows: before.flows.length,
      services: before.services.length,
    },
  });
  console.log(
    JSON.stringify(
      { result: "PASS", executionIds: ids, rows, evidence },
      null,
      2,
    ),
  );
} catch (error) {
  await save("failure", { message: error.message, executionIds: ids });
  throw error;
}
