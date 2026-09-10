// Starts and stops the Rust fixture server automatically. Build mobile assets first.
// Uses a disposable headless Chrome profile, never the user's browser session.
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";

const profile = resolve("target", `mobile-browser-${Date.now()}`);
await mkdir(profile, { recursive: true });
const fixture = spawn("cargo", ["test", "-p", "omni-engine", "browser_fixture", "--", "--ignored"], { windowsHide: true, stdio: "ignore" });
const chrome = spawn(process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });
let socket;
try {
  let serverReady = false;
  for (let i = 0; i < 120; i++) {
    try { const response = await fetch("http://127.0.0.1:47329/conversas"); serverReady = response.ok; if (serverReady) break; }
    catch { /* Rust fixture is still compiling/starting. */ }
    await delay(500);
  }
  assert.ok(serverReady,"Rust fixture server did not start");
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(resolve(profile,"DevToolsActivePort"),"utf8")).split("\n")[0]; break; }
    catch { await delay(100); }
  }
  assert.ok(port,"Chrome did not start");
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then(r => r.json());
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => { socket.addEventListener("open",resolve,{once:true}); socket.addEventListener("error",reject,{once:true}); });
  let sequence = 0;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
    if (message.id && pending.has(message.id)) {
      const { resolve,reject,timer } = pending.get(message.id); clearTimeout(timer); pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
    }
  });
  function command(method, params = {}) {
    return new Promise((resolve,reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); },10_000);
      pending.set(id,{resolve,reject,timer}); socket.send(JSON.stringify({id,method,params}));
    });
  }
  async function evaluate(expression) {
    const result = await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
    assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  await command("Runtime.enable"); await command("Page.enable");
  for (const width of [320,390,768]) {
    await command("Emulation.setDeviceMetricsOverride",{width,height:844,deviceScaleFactor:1,mobile:true});
    await command("Page.navigate",{url:"http://127.0.0.1:47329"});
    let loaded = false;
    for (let i = 0; i < 60; i++) { if (await evaluate("document.body.innerText.includes('Abrir conversa')")) { loaded = true; break; } await delay(100); }
    assert.ok(loaded,`Mobile conversation list did not load: ${await evaluate("document.body.innerText")}`);
    const layout = await evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('button')].map(b=>({text:b.innerText,height:b.getBoundingClientRect().height,right:b.getBoundingClientRect().right}))})");
    assert.ok(layout.scroll <= width,`Horizontal overflow at ${width}: ${JSON.stringify(layout)}`);
    assert.ok(layout.buttons.every(b=>b.height >= 44 && b.right <= width),`Inaccessible button at ${width}`);
    await writeFile(resolve("target",`mobile-${width}.png`),Buffer.from((await command("Page.captureScreenshot",{format:"png"})).data,"base64"));
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.innerText==='Abrir conversa').click()");
    for (let i = 0; i < 50; i++) { if (await evaluate("!!document.querySelector('textarea')")) break; await delay(100); }
    assert.ok(await evaluate("[...document.querySelectorAll('button')].find(b=>b.innerText==='Enviar resposta')?.disabled"),"Inactive sessions must not accept prompts");
    await writeFile(resolve("target",`mobile-detail-${width}.png`),Buffer.from((await command("Page.captureScreenshot",{format:"png"})).data,"base64"));
    console.log(`Mobile ${width}px: list, detail, touch targets and empty session validated`);
  }
  assert.deepEqual(exceptions,[],"Browser runtime exceptions");
  await command("Browser.close").catch(()=>{});
} finally {
  await fetch("http://127.0.0.1:47329/__test_stop", { method:"POST" }).catch(()=>{});
  socket?.close(); chrome.kill();
  await delay(250); fixture.kill();
}
