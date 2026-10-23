/** Fake OpenAI-compatible clients for tests, scripted demos and replay recording. */

import { sleep } from "../util.js";

export class FakeAPIError extends Error {
  name = "FakeAPIError";

  constructor(status, message = "fake error") {
    super(message);
    this.status = status;
  }
}

/** `responder(model, task, messages)` returns a string, an object (sent as JSON) or an Error (thrown). */
export class FakeLLMClient {
  constructor(responder, delay = null) {
    this.responder = responder;
    this.delay = delay;
    this.calls = [];
  }

  async createChatCompletion({ model, messages, task = "" }, { signal } = {}) {
    this.calls.push({ model, task, messages });
    if (this.delay) await sleep(this.delay(model) * 1000, signal);
    const out = this.responder(model, task, messages);
    if (out instanceof Error) throw out;
    const content = typeof out === "string" ? out : JSON.stringify(out);
    const prompt = Math.floor(messages.reduce((n, m) => n + m.content.length, 0) / 4);
    return {
      choices: [{ message: { content } }],
      usage: { prompt_tokens: prompt, completion_tokens: Math.max(1, Math.floor(content.length / 4)) },
    };
  }
}

/** Returns pre-written responses per task, in order (the last one repeats). Values may be functions of the messages. */
export class ScriptedLLM extends FakeLLMClient {
  constructor(script, delay = null) {
    super((model, task, messages) => this.respond(task, messages), delay);
    this.script = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]));
    this.used = {};
  }

  respond(task, messages) {
    const queue = this.script[task];
    if (!queue?.length) throw new Error(`ScriptedLLM: no scripted response left for task ${JSON.stringify(task)}`);
    const item = queue.length > 1 ? queue.shift() : queue[0];
    this.used[task] = (this.used[task] ?? 0) + 1;
    return typeof item === "function" ? item(messages) : item;
  }

  count(task) {
    return this.used[task] ?? 0;
  }
}
