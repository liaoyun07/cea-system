export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function basicAuthorization(username, password) {
  if (username.includes(':')) throw new Error('账号不能包含冒号');
  return (
    'Basic ' +
    btoa(
      Array.from(new TextEncoder().encode(`${username}:${password}`), (b) => String.fromCharCode(b)).join(''),
    )
  );
}

export function createApi(namespace, authorization, fetcher = fetch) {
  const prefix = `/api/namespaces/${encodeURIComponent(namespace)}`;
  return async (path, { method = 'GET', body, key, signal } = {}) => {
    const response = await fetcher(prefix + path, {
      method,
      signal: signal || AbortSignal.timeout(20000),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      headers: {
        Authorization: authorization,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      throw new ApiError(response.status, 'INVALID_RESPONSE', '接口未返回 JSON，请检查 /api 代理配置。');
    }
    if (!response.ok)
      throw new ApiError(
        response.status,
        data?.code || 'REQUEST_FAILED',
        data?.message || `HTTP ${response.status}`,
      );
    return data;
  };
}

export function errorText(error) {
  if (error instanceof ApiError) {
    const advice =
      {
        401: '认证失效或账号密码错误。',
        403: '账号没有此命名空间或操作的权限。',
        409: '发生冲突；请核对当前版本，不会覆盖你的编辑。',
        422: '定义或输入不符合约束。',
      }[error.status] || '';
    return `${advice} ${error.message} (${error.code} / ${error.status})`.trim();
  }
  return error?.name === 'TimeoutError' || error instanceof TypeError
    ? '后端不可达或请求超时，请检查服务和 /api 代理；写入结果可能未知。'
    : error.message || String(error);
}
