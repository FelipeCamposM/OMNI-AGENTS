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
import React from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceTabBar } from './src/features/workspace/WorkspaceTabBar';
import { TAB_DRAG_EVENT } from './src/features/workspace/tabPointerDrag';
window.actions = []; window.events = []; window.gestures = [];
window.addEventListener(TAB_DRAG_EVENT, e => window.gestures.push(e.detail));
for (const type of ['dragstart', 'pointercancel']) window.addEventListener(type, () => window.events.push(type));
const dispatch = action => window.actions.push(action);
const tabs = [{id:'agent',kind:'agent',title:'Claude'},{id:'file',kind:'file',title:'code.ts'}];
createRoot(document.getElementById('root')).render(<main>{['source', 'target'].map(id => <section key={id} id={id} data-drop-pane={id}>
  <header draggable onDragStart={e => {
    if (e.target.closest('[role="tablist"]')) { e.preventDefault(); return; }
    e.dataTransfer.setData('application/x-omni-workspace-pane', JSON.stringify({paneId:id}));
  }}>
    <WorkspaceTabBar pane={{type:'pane', id, activeTabId:'agent', tabs:id === 'source' ? tabs : []}} dispatch={dispatch} onCloseTab={() => {}} />
  </header>
</section>)}</main>);
`;

async function bundle(previous) {
  return (await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
    plugins: previous ? [{ name: 'previous-gesture', setup(builder) {
      builder.onLoad({ filter: /tabPointerDrag\.ts$/ }, async ({ path }) => ({ loader: 'ts', contents:
        (await readFile(path, 'utf8'))
          .replace('event.preventDefault();', '')
          .replace('source.setPointerCapture(pointerId);', '')
          .replace('if (source.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId);', '')
      }));
    }}] : [],
  })).outputFiles[0].text;
}

const bundles = { '/previous.js': await bundle(true), '/fixed.js': await bundle(false) };
const server = createServer((req, res) => {
  if (bundles[req.url]) { res.setHeader('Content-Type', 'text/javascript'); res.end(bundles[req.url]); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<html><style>body{margin:0;user-select:none}main{display:flex}section{position:relative;width:350px;height:400px;border:1px solid}header{height:40px;background:#ccc}[role=tablist]{display:flex}[role=tablist]>div{display:flex}[role=tab]{height:40px;width:180px}</style><div id="root"></div><script src="${req.url === '/previous' ? '/previous.js' : '/fixed.js'}"></script></html>`);
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
    if (version === 'fixed') {
      // Clique simples ainda troca de aba (captura do ponteiro no pointerdown desviava o click).
      for (const type of ['mousePressed', 'mouseReleased']) {
        await call('Input.dispatchMouseEvent', { type, x: 300, y: 20, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
      }
      const clicked = await evaluate('window.actions.splice(0)');
      console.log('click', JSON.stringify(clicked));
      assert.ok(clicked.some(action => action.type === 'SELECT_TAB' && action.tabId === 'file'), 'Click no longer selects the tab');
    }
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 80, y: 20 });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 80, y: 20, button: 'left', buttons: 1, clickCount: 1 });
    for (let x = 90; x <= 690; x += 30) {
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: x < 200 ? 20 : 200, button: 'left', buttons: 1 });
    }
    const hover = await evaluate('window.gestures.at(-1)');
    console.log(version, JSON.stringify(hover));
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 690, y: 200, button: 'left', buttons: 0, clickCount: 1 });
    const result = await evaluate('({actions:window.actions,events:window.events})');
    console.log(version, JSON.stringify(result));
    if (version === 'previous') {
      assert.ok(result.events.includes('pointercancel'), 'Expected to reproduce native drag cancellation');
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    }
    else {
      assert.deepEqual(hover?.target, { paneId: 'target', zone: 'right' }, 'Preview did not follow the pointer to the right edge');
      assert.ok(result.actions.some(action => action.type === 'SPLIT_WITH_TAB' && action.tabId === 'agent' && action.targetPaneId === 'target'
        && action.direction === 'horizontal' && action.position === 'after'), 'Agent tab did not split the target pane');
      assert.ok(!result.events.includes('pointercancel'), 'Native drag still cancels the gesture');
    }
  }
  console.log('PASS: reproduced old cancellation; agent tab splits the target pane in Edge.');
} finally {
  socket?.close();
  browser.kill();
  server.close();
}
