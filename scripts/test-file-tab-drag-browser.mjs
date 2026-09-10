import { build } from 'esbuild';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// Browser regression: jsdom cannot reproduce native ancestor dragging/pointercancel.
// Uses the installed Edge and an isolated temporary profile; no extra dependencies.
const entry = `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceTabBar } from './src/features/workspace/WorkspaceTabBar';
import { TabDropOverlay } from './src/features/workspace/TabDropOverlay';
import { FILE_TAB_DRAG_EVENT } from './src/features/workspace/fileTabDrag';
window.actions = []; window.events = []; window.gestures = [];
window.addEventListener(FILE_TAB_DRAG_EVENT, e => window.gestures.push(e.detail));
for (const type of ['dragstart', 'pointercancel']) window.addEventListener(type, () => window.events.push(type));
const dispatch = action => window.actions.push(action);
function App() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const update = e => setActive(e.detail);
    window.addEventListener(FILE_TAB_DRAG_EVENT, update);
    return () => window.removeEventListener(FILE_TAB_DRAG_EVENT, update);
  }, []);
  return <main>{['source', 'target'].map(id => <section key={id} id={id}>
    <header draggable onDragStart={e => {
      if (e.target.closest('[role="tablist"]')) { e.preventDefault(); return; }
      e.dataTransfer.setData('application/x-omni-workspace-pane', JSON.stringify({paneId:id}));
    }}>
      <WorkspaceTabBar pane={{type:'pane', id, activeTabId:'file', tabs:id === 'source' ? [{id:'file',kind:'file',title:'code.ts'}] : []}} dispatch={dispatch} onCloseTab={() => {}} />
    </header>
    {active && <TabDropOverlay targetPaneId={id} dispatch={dispatch} onFinished={() => setActive(false)} />}
  </section>)}</main>;
}
createRoot(document.getElementById('root')).render(<App />);
`;

async function bundle(previous) {
  return (await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
    plugins: previous ? [{ name: 'previous-gesture', setup(builder) {
      builder.onLoad({ filter: /fileTabDrag\.ts$/ }, async ({ path }) => ({ loader: 'ts', contents:
        (await readFile(path, 'utf8'))
          .replace('event.preventDefault();', '')
          .replace('source.setPointerCapture(event.pointerId);', '')
          .replace('if (source.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId);', '')
      }));
    }}] : [],
  })).outputFiles[0].text;
}

const bundles = { '/previous.js': await bundle(true), '/fixed.js': await bundle(false) };
const server = createServer((req, res) => {
  if (bundles[req.url]) { res.setHeader('Content-Type', 'text/javascript'); res.end(bundles[req.url]); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<html><style>body{margin:0;user-select:none}main{display:flex}section{position:relative;width:450px;height:400px;border:1px solid}header{height:40px;background:#ccc}[role=tablist]{display:flex}[role=tablist]>div{display:flex}[role=tab]{height:40px;width:180px}[aria-label="Destinos da tab"]{position:absolute;inset:45px 0 0;pointer-events:none}[data-tab-drop-pane]{pointer-events:auto}[aria-label="Destinos da tab"] button{position:absolute;width:100px;height:80px;left:160px;top:120px}[data-tab-drop-direction]{display:none}</style><div id="root"></div><script src="${req.url === '/previous' ? '/previous.js' : '/fixed.js'}"></script></html>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const profile = await mkdtemp(join(tmpdir(), 'omni-drag-browser-'));
const browser = spawn(process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
let socket;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch {}
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(port, 'Edge did not start');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const reply = JSON.parse(data);
    if (reply.id) { pending.get(reply.id)?.(reply); pending.delete(reply.id); }
  };
  const call = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 10000);
    pending.set(id, reply => { clearTimeout(timer); reply.error ? reject(new Error(JSON.stringify(reply.error))) : done(reply.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => (await call('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  for (const version of ['previous', 'fixed']) {
    await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/${version}` });
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`!!document.querySelector('[role="tab"]')`)) break;
      await new Promise(done => setTimeout(done, 50));
    }
    await new Promise(done => setTimeout(done, 200));
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 80, y: 20 });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 80, y: 20, button: 'left', buttons: 1, clickCount: 1 });
    for (let x = 90; x <= 660; x += 30) {
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: x < 200 ? 20 : 200, button: 'left', buttons: 1 });
    }
    console.log(version, await evaluate(`({gestures:window.gestures,overlays:document.querySelectorAll('[aria-label="Destinos da tab"]').length,hit:document.elementFromPoint(660,200)?.outerHTML})`));
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 660, y: 200, button: 'left', buttons: 0, clickCount: 1 });
    const result = await evaluate('({actions:window.actions,events:window.events})');
    console.log(version, JSON.stringify(result));
    if (version === 'previous') {
      assert.ok(result.events.includes('pointercancel'), 'Expected to reproduce native drag cancellation');
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    }
    else {
      assert.ok(result.actions.some(action => action.type === 'MOVE_TAB' && action.targetPaneId === 'target'), 'File tab did not reach destination');
      assert.ok(!result.events.includes('pointercancel'), 'Native drag still cancels the gesture');
    }
  }
  console.log('PASS: reproduced old cancellation; fixed gesture moves the file in Edge.');
} finally {
  socket?.close();
  browser.kill();
  server.close();
}
