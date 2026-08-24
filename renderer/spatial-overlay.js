(() => {
  'use strict';
  const canvas = document.getElementById('stage');
  const context = canvas.getContext('2d');
  const toolbar = document.getElementById('toolbar');
  let init = null;
  let gesture = 'lasso';
  let points = [];
  let drawing = false;
  let completing = false;
  let activePointerId = null;
  let inputSource = 'mouse';

  const resize = () => {
    const dpr = Math.max(0.25, window.devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  };

  const pointFrom = event => ({
    x: Math.max(0, Math.min(innerWidth, event.clientX)),
    y: Math.max(0, Math.min(innerHeight, event.clientY)),
    t_ms: points.length ? Math.max(0, Math.round(event.timeStamp - points[0].origin)) : 0,
    pressure: Number.isFinite(event.pressure) && event.pressure > 0 ? event.pressure : 0.5,
    origin: points.length ? points[0].origin : event.timeStamp,
  });

  const publicPoints = () => points.map(({ x, y, t_ms, pressure }) => ({ x, y, t_ms, pressure }));

  function path() {
    if (!points.length) return;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  }

  function render() {
    context.clearRect(0, 0, innerWidth, innerHeight);
    if (!points.length) return;
    const start = points[0];
    const end = points.at(-1);
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#43e2ff';
    context.fillStyle = 'rgba(67,226,255,.2)';
    context.lineWidth = gesture === 'highlight' ? 18 : 4;
    if (gesture === 'circle') {
      context.beginPath();
      context.ellipse(left + width / 2, top + height / 2, Math.max(2, width / 2), Math.max(2, height / 2), 0, 0, Math.PI * 2);
      context.stroke();
    } else if (gesture === 'x') {
      context.beginPath(); context.moveTo(left, top); context.lineTo(left + width, top + height);
      context.moveTo(left + width, top); context.lineTo(left, top + height); context.stroke();
    } else if (gesture === 'arrow' || gesture === 'drag') {
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      context.beginPath(); context.moveTo(start.x, start.y); context.lineTo(end.x, end.y);
      if (gesture === 'arrow') {
        context.lineTo(end.x - 18 * Math.cos(angle - Math.PI / 6), end.y - 18 * Math.sin(angle - Math.PI / 6));
        context.moveTo(end.x, end.y);
        context.lineTo(end.x - 18 * Math.cos(angle + Math.PI / 6), end.y - 18 * Math.sin(angle + Math.PI / 6));
      }
      context.stroke();
    } else if (gesture === 'click') {
      context.beginPath(); context.arc(start.x, start.y, 13, 0, Math.PI * 2); context.fill(); context.stroke();
    } else {
      path();
      if (gesture === 'lasso' && points.length > 2) context.closePath();
      context.stroke();
    }
  }

  function selectGesture(value) {
    gesture = value;
    toolbar.querySelectorAll('[data-gesture]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.gesture === gesture)));
  }

  async function cancel() {
    if (!init || completing) return;
    completing = true;
    try { await window.solatSpatial.cancel({ captureId: init.capture_id, token: init.token }); } catch { window.close(); }
  }

  async function complete() {
    if (!init || completing || !points.length) return;
    completing = true;
    try {
      await window.solatSpatial.complete({
        captureId: init.capture_id,
        token: init.token,
        event: { source: inputSource, gesture, points: publicPoints() },
      });
    } catch (error) {
      completing = false;
      document.querySelector('.hint').textContent = error?.message || 'Spatial capture failed. Press Esc to close.';
    }
  }

  toolbar.addEventListener('click', event => {
    const button = event.target.closest('[data-gesture]');
    if (button) selectGesture(button.dataset.gesture);
  });
  document.getElementById('cancel').addEventListener('click', cancel);
  canvas.addEventListener('pointerdown', event => {
    if (!init || completing || drawing || event.button !== 0) return;
    points = [];
    drawing = true;
    activePointerId = event.pointerId;
    inputSource = event.pointerType === 'pen' ? 'stylus' : event.pointerType === 'touch' ? 'touch' : 'mouse';
    points.push(pointFrom(event));
    canvas.setPointerCapture(event.pointerId);
    render();
  });
  canvas.addEventListener('pointermove', event => {
    if (!drawing || event.pointerId !== activePointerId || points.length >= 2048) return;
    const next = pointFrom(event);
    const last = points.at(-1);
    if (Math.hypot(next.x - last.x, next.y - last.y) < 1.5) return;
    points.push(next);
    render();
  });
  canvas.addEventListener('pointerup', event => {
    if (!drawing || event.pointerId !== activePointerId) return;
    drawing = false;
    activePointerId = null;
    if (points.length === 1 && gesture !== 'click') points.push(pointFrom(event));
    render();
    void complete();
  });
  const abandonPointer = event => {
    if (!drawing || event.pointerId !== activePointerId) return;
    drawing = false;
    activePointerId = null;
    points = [];
    render();
    document.querySelector('.hint').textContent = 'Pointer cancelled. Draw again · Esc cancels';
  };
  canvas.addEventListener('pointercancel', abandonPointer);
  canvas.addEventListener('lostpointercapture', abandonPointer);
  addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); void cancel(); }
    if (event.key === 'Enter') { event.preventDefault(); void complete(); }
  });
  addEventListener('resize', resize);
  window.solatSpatial.onInit(payload => {
    init = payload;
    selectGesture(payload.gesture || 'lasso');
    resize();
  });
  resize();
})();
