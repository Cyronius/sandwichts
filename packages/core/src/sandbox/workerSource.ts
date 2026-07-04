/**
 * workerSource — source string executed inside the sandbox Web Worker
 * (SW-SANDBOX, SW-SANDBOX-HARDENING).
 *
 * The worker is the kill-switch layer of the sandbox: it runs the model's
 * generated JavaScript with `new AsyncFunction(code)`, so a runaway script
 * (infinite loop, blocking work) can be killed outright with
 * `worker.terminate()` without freezing the page. The worker exposes ONE
 * capability per whitelisted tool name; each is a stub that round-trips the
 * call to the host over a dedicated MessagePort (transferred in with the
 * `start` message) and `await`s the result.
 *
 * No DOM or app storage is reachable from worker scope, and network is cut
 * off by the iframe's CSP (`default-src 'none'`), which blob workers inherit —
 * `fetch` EXISTS in WorkerGlobalScope, so the CSP is the actual network
 * boundary (verified: absolute-URL fetch fails with a CSP block). The only
 * way out is the transferred port, and the only callable surface is the api
 * name list handed in with the `start` message. That list IS the whitelist.
 * Alongside the callable stubs, the `start` message carries the turn's
 * context object — deep-frozen and bound under the configured `contextName`
 * in the script's scope (a snapshot taken at script start, mirroring the
 * payload in the system prompt).
 *
 * Transcript entries are sanitized (JSON round-trip, size-capped) before the
 * worker posts them, so a pathological script can't balloon host memory and a
 * non-serializable tool result can't kill the `done` post.
 *
 * This string is loaded into a Worker via a Blob URL by the iframe relay. It
 * is exported as a plain string (not a stringified function) so production
 * minification can never rewrite or drop it.
 */
export const WORKER_RUNTIME_SOURCE = String.raw`
(function () {
  var port = null;
  var pending = new Map();
  var nextId = 1;
  var transcript = [];
  var maxEntryChars = 100000;

  // JSON round-trip with a size cap. Keeps every transcript entry cloneable
  // and bounded; the script itself still receives the raw result object.
  function sanitize(value) {
    try {
      var s = JSON.stringify(value);
      if (s === undefined) return String(value);
      if (s.length > maxEntryChars) {
        return { __capped: true, preview: s.slice(0, maxEntryChars) };
      }
      return JSON.parse(s);
    } catch (_) {
      return { __capped: true, preview: String(value) };
    }
  }

  function deepFreeze(obj) {
    if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
      Object.freeze(obj);
      var keys = Object.keys(obj);
      for (var i = 0; i < keys.length; i++) deepFreeze(obj[keys[i]]);
    }
    return obj;
  }

  function callTool(name, args) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending.set(id, { resolve: resolve, reject: reject });
      port.postMessage({ type: 'call', id: id, name: name, args: args });
    });
  }

  function onPortMessage(e) {
    var msg = e.data || {};
    // Host → worker: a tool call has resolved (or failed) on the handler side.
    if (msg.type === 'result') {
      var p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    }
  }

  // Iframe relay → worker: run a generated script with the given whitelist.
  // ports[0] is the dedicated channel back to the host for this run.
  self.onmessage = async function (e) {
    var msg = e.data || {};
    if (msg.type !== 'start') return;
    port = e.ports && e.ports[0];
    if (!port) return;
    port.onmessage = onPortMessage;

    transcript = [];
    if (typeof msg.maxEntryChars === 'number' && msg.maxEntryChars > 0) {
      maxEntryChars = msg.maxEntryChars;
    }
    var apiNames = msg.apiNames || [];
    var code = msg.code || '';
    var contextName = msg.contextName || 'appContext';

    // Bind the frozen context first, then one bridge stub per whitelisted
    // tool name. Each stub records its call into the transcript so the host
    // can surface what ran even if a later call throws.
    var argNames = [contextName];
    var argValues = [deepFreeze(msg.context || {})];
    for (var i = 0; i < apiNames.length; i++) {
      (function (name) {
        argNames.push(name);
        argValues.push(async function (args) {
          var callArgs = args === undefined ? {} : args;
          var entry = { name: name, args: sanitize(callArgs) };
          transcript.push(entry);
          var result = await callTool(name, callArgs);
          entry.result = sanitize(result);
          return result;
        });
      })(apiNames[i]);
    }

    try {
      var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      var fn = new AsyncFunction(argNames.join(','), code);
      await fn.apply(null, argValues);
      port.postMessage({ type: 'done', transcript: transcript });
    } catch (err) {
      var message = err && err.message ? String(err.message) : String(err);
      port.postMessage({ type: 'error', message: message, transcript: transcript });
    }
  };
})();
`;
