// 统一走同源 /api（Nginx 反代到 section-svc），前端不感知后端地址

async function req(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) {
    let msg = '';
    try {
      msg = (await r.json()).error;
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new Error(msg || `请求失败（${r.status}）`);
  }
  return r.json();
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const qs = (params) => {
  const p = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? '?' + new URLSearchParams(p).toString() : '';
};

export const api = {
  sketch: () => req('/api/sketch'),
  walkers: () => req('/api/walkers'),

  saveReading: (body) => req('/api/readings', json('POST', body)),
  readings: (params) => req('/api/readings' + qs(params)),
  verify: (id, body) => req(`/api/readings/${id}/verify`, json('PATCH', body)),

  events: (params) => req('/api/events' + qs(params)),
  saveEvent: (body) => req('/api/events', json('POST', body)),
  uploadPhoto: (eventId, file) => {
    const fd = new FormData();
    fd.append('photo', file);
    return req(`/api/events/${eventId}/photo`, { method: 'POST', body: fd });
  },

  jumps: (params) => req('/api/jumps' + qs(params)),
};
