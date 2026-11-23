/* dsh-vapt 前端 bundle
 *
 * 契约（对照 @deepseek-ai/dsh-client-modules 的 parseDshClient / clientExportOf）：
 *   · package.json dsh.client.platform 必须字符串、inject 必须字符串数组
 *   · exports["./client"] 必须解析到本文件
 *   · 本文件必须调用 window.__ModuleLoader__.load({ id, factory })，id == 包名
 *   · 组件用宿主提供的 react（require("react")），不打包自己的 React
 *
 * 两个接缝：shell.overlay（右下角面板）、conversation.input.right（按钮）。
 * 任一 slot 不存在只 warn，不影响宿主启动。
 *
 * 交互设计（踩过的坑）：
 *   · 不依赖 window.open —— Electron 会拦掉，点了看起来像没反应；
 *     改为面板内“展开/收起”，直接渲染报告正文。
 *   · 每个按钮都必须有可见回馈（时间戳 / loading / 错误文本），
 *     否则重新拉到相同数据时用户会以为按钮坏了。
 */
window.__ModuleLoader__.load({
  id: 'dsh-vapt',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const react = require('react');
    const h = react.createElement;
    const { useState, useEffect, useCallback } = react;

    const name = 'dsh-vapt';
    const inject = ['slots'];

    const api = (body) =>
      fetch('/vapt/api', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(async (r) => {
        const text = await r.text();
        try { return JSON.parse(text); } catch { throw new Error(`HTTP ${r.status}: ${text.slice(0, 120)}`); }
      });

    const sevColor = {
      critical: '#ff6b6b', high: '#ff9f43', medium: '#ffd166', low: '#9ecbff', info: '#9aa4b2',
    };

    const S = {
      wrap: { position: 'fixed', right: '18px', bottom: '18px', zIndex: 2147483000, pointerEvents: 'auto',
        font: '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: '#e6e6e6' },
      fab: { width: '40px', height: '40px', borderRadius: '50%', border: '1px solid #2c3038',
        background: '#12151b', color: '#e6e6e6', cursor: 'pointer', fontSize: '13px',
        boxShadow: '0 4px 14px rgba(0,0,0,.45)', pointerEvents: 'auto' },
      btn: { height: '22px', padding: '0 9px', borderRadius: '6px', border: '1px solid #2c3038',
        background: '#1b1f27', color: '#e6e6e6', cursor: 'pointer', fontSize: '11px', pointerEvents: 'auto' },
      panel: { position: 'absolute', right: 0, bottom: '50px', width: '380px', maxHeight: '62vh',
        overflow: 'auto', background: '#12151b', border: '1px solid #23262d', borderRadius: '10px',
        padding: '10px 12px', boxShadow: '0 10px 34px rgba(0,0,0,.55)', pointerEvents: 'auto' },
      panelWide: { width: '520px', maxHeight: '78vh' },
      h: { margin: '8px 0 5px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.5px', color: '#8b95a5' },
      row: { display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '3px 0', borderBottom: '1px solid #1c2027' },
      code: { background: '#1b1f27', padding: '0 4px', borderRadius: '4px' },
      muted: { color: '#8b95a5' },
      pre: { whiteSpace: 'pre-wrap', background: '#0b0d11', border: '1px solid #1c2027', borderRadius: '6px',
        padding: '6px', fontSize: '11px', maxHeight: '260px', overflow: 'auto', margin: '6px 0 0' },
      err: { color: '#ff9f43', marginTop: '6px', wordBreak: 'break-all' },
    };

    function VaptDock() {
      const [open, setOpen] = useState(false);
      const [wide, setWide] = useState(false);
      const [data, setData] = useState(null);
      const [report, setReport] = useState(null);
      const [status, setStatus] = useState('');       // 可见状态：loading / 时间戳 / 错误
      const [err, setErr] = useState(null);

      const stamp = () => new Date().toLocaleTimeString();

      const load = useCallback(async (opts = {}) => {
        setStatus('loading…');
        setErr(null);
        try {
          const ov = await api({ op: 'overview' });
          if (!ov.ok) throw new Error(ov.error || 'overview failed');
          const id = ov.current;
          const [st, fd, gr] = await Promise.all([
            api({ op: 'status', engagement: id }),
            api({ op: 'findings', engagement: id }),
            api({ op: 'graph', engagement: id }),
          ]);
          const next = { ov, st, fd, gr };
          if (opts.withReport) {
            const rp = await api({ op: 'report', engagement: id });
            setReport(rp.md || '(empty report)');
          }
          setData(next);
          setStatus(`updated ${stamp()}`);
        } catch (e) {
          setErr(e.message || String(e));
          setStatus(`failed ${stamp()}`);
        }
      }, []);

      // 输入框右侧的 vapt 按钮通过自定义事件切换面板（否则那颗按钮就是死代码）
      useEffect(() => {
        const onToggle = () => setOpen((v) => !v);
        try { window.addEventListener('dsh-vapt:toggle', onToggle); } catch { /* ignore */ }
        return () => { try { window.removeEventListener('dsh-vapt:toggle', onToggle); } catch { /* ignore */ } };
      }, []);

      const toggleOpen = () => {
        const next = !open;
        setOpen(next);
        if (next && !data) return load();
        return Promise.resolve();
      };

      const toggleWide = () => {
        const next = !wide;
        setWide(next);
        if (next) return load({ withReport: true });
        setStatus(`collapsed ${stamp()}`);
        return Promise.resolve();
      };

      const body = (() => {
        if (err) return h('div', { style: S.err }, `error: ${err}`);
        if (!data) return h('div', { style: S.muted }, status || 'loading…');
        const { st, fd, gr } = data;
        if (!st || !st.ok) return h('div', { style: S.muted }, 'no engagement yet');
        const c = st.counts || {};
        const rows = (fd.findings || []).slice(0, 40).map((f) =>
          h('div', { key: f.id, style: S.row },
            h('span', { style: S.code }, f.id),
            h('span', { style: { color: sevColor[f.severity] || '#e6e6e6', minWidth: '52px' } }, f.severity),
            h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '6px' } }, f.title),
            h('span', { style: S.muted }, `${f.status}`),
          ));
        return h('div', null,
          h('div', { style: { ...S.row, ...S.muted } },
            h('span', null, st.engagement.id),
            h('span', null, `assets ${c.assets} · findings ${c.deliverable}/${c.findings} · ev ${c.evidence}`),
          ),
          h('div', { style: S.h }, 'Findings'),
          rows.length ? rows : h('div', { style: S.muted }, 'no findings yet'),
          h('div', { style: S.h }, 'Attack path'),
          h('pre', { style: S.pre }, (gr && gr.mermaid) || '(none)'),
          wide ? h('div', null,
            h('div', { style: S.h }, 'Report (zh)'),
            h('pre', { style: S.pre }, report === null ? 'loading…' : report),
          ) : null,
        );
      })();

      return h('div', { style: S.wrap },
        open ? h('div', { style: { ...S.panel, ...(wide ? S.panelWide : {}) } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' } },
            h('strong', null, 'dsh-vapt'),
            h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
              h('span', { style: { ...S.muted, fontSize: '10px' } }, status),
              h('button', { type: 'button', onClick: () => load({ withReport: wide }), style: S.btn, title: 'Reload store / 重新读取事实库' }, 'refresh'),
              h('button', { type: 'button', onClick: toggleWide, style: S.btn, title: 'Expand report in panel / 在面板内展开报告' }, wide ? 'collapse' : 'expand'),
            ),
          ),
          body,
        ) : null,
        h('button', { type: 'button', onClick: toggleOpen, style: S.fab, title: 'dsh-vapt console' }, 'vapt'),
      );
    }

    function VaptButton() {
      return h('button', {
        type: 'button',
        onClick: () => {
          try { window.dispatchEvent(new CustomEvent('dsh-vapt:toggle')); } catch { /* ignore */ }
        },
        title: 'dsh-vapt console',
        style: { height: '28px', padding: '0 10px', borderRadius: '8px', border: '1px solid var(--dsh-border,#2c3038)',
          background: 'transparent', color: 'inherit', font: 'inherit', fontSize: '12px',
          cursor: 'pointer', opacity: 0.85, pointerEvents: 'auto' },
      }, 'vapt');
    }

    function safeRegister(ctx, slot, id, order, component) {
      try {
        ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, id, order }, component));
        return true;
      } catch (err) {
        try { console.warn(`[dsh-vapt] slot ${slot} skipped:`, err); } catch { /* ignore */ }
        return false;
      }
    }

    function apply(ctx) {
      safeRegister(ctx, 'shell.overlay', 'dsh-vapt-dock', 60, VaptDock);
      safeRegister(ctx, 'conversation.input.right', 'dsh-vapt-button', 30, VaptButton);
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
