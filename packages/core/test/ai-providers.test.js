import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { askModel, detectProvider, listModels, pickModel } from "../dist/ai-providers.js";

/** A provider that answers from a script, recording what it was sent. */
function fake(replies) {
  const sent = [];
  let turn = 0;
  const fetcher = async (url, init = {}) => {
    sent.push({ url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
    const reply = replies[Math.min(turn, replies.length - 1)];
    turn += 1;
    return { ok: (reply.status ?? 200) < 400, status: reply.status ?? 200, json: async () => reply.body };
  };
  return { fetcher, sent };
}

test("the provider is read from how the key starts, masked or not", () => {
  assert.equal(detectProvider("sk-ant-api03-abcdef"), "anthropic");
  assert.equal(detectProvider("sk-ant…wxyz"), "anthropic");
  assert.equal(detectProvider("sk-or-v1-abcdef"), "openrouter");
  assert.equal(detectProvider("sk-or-…wxyz"), "openrouter");
  assert.equal(detectProvider("sk-proj-abcdef"), "openai");
  assert.equal(detectProvider("sk-abcdef"), "openai");
  assert.equal(detectProvider("AIzaSyabcdef"), "gemini");
  assert.equal(detectProvider("AQ.Ab8abcdef"), "gemini");
});

test("Claude: the key and version go in the headers, and haiku is offered first", async () => {
  const { fetcher, sent } = fake([
    { body: { data: [
      { id: "claude-opus-5", display_name: "Claude Opus 5" },
      { id: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5" },
      { id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5" },
      { id: "claude-sonnet-5", display_name: "Claude Sonnet 5" },
    ] } },
  ]);
  const models = await listModels("anthropic", "sk-ant-test", fetcher);
  assert.equal(sent[0].headers["x-api-key"], "sk-ant-test");
  assert.equal(sent[0].headers["anthropic-version"], "2023-06-01");
  assert.equal(sent[0].headers["anthropic-dangerous-direct-browser-access"], undefined);
  assert.equal(models[0].name, "claude-haiku-4-5");
  assert.equal(pickModel("anthropic", models), "claude-haiku-4-5");
});

test("Claude from a web page carries the header Anthropic requires there", async () => {
  const { fetcher, sent } = fake([{ body: { data: [] } }]);
  await listModels("anthropic", "sk-ant-test", fetcher, { browser: true });
  assert.equal(sent[0].headers["anthropic-dangerous-direct-browser-access"], "true");
});

test("Claude's answer is its text, and no temperature is sent", async () => {
  const { fetcher, sent } = fake([{ body: { content: [{ type: "text", text: "[{\"id\":\"t1\"}]" }] } }]);
  const text = await askModel("anthropic", "sk-ant-test", "claude-haiku-4-5", "hello", fetcher);
  assert.equal(text, "[{\"id\":\"t1\"}]");
  assert.equal(sent[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(sent[0].body.temperature, undefined);
  assert.equal(sent[0].body.model, "claude-haiku-4-5");
});

test("OpenAI: only chat models, GPT mini first, the o-series after", async () => {
  const { fetcher } = fake([
    { body: { data: [
      { id: "o4-mini" }, { id: "gpt-5" }, { id: "gpt-5-mini" }, { id: "gpt-4o-mini" },
      { id: "gpt-4o-realtime-preview" }, { id: "text-embedding-3-small" }, { id: "whisper-1" },
      { id: "gpt-image-1" }, { id: "dall-e-3" },
    ] } },
  ]);
  const names = (await listModels("openai", "sk-proj-test", fetcher)).map((m) => m.name);
  assert.deepEqual(names, ["gpt-5-mini", "gpt-4o-mini", "gpt-5", "o4-mini"]);
});

test("OpenAI's answer is the first choice's content, and no temperature is sent", async () => {
  const { fetcher, sent } = fake([{ body: { choices: [{ message: { content: "[]" } }] } }]);
  assert.equal(await askModel("openai", "sk-proj-test", "gpt-5-mini", "hi", fetcher), "[]");
  assert.equal(sent[0].headers.authorization, "Bearer sk-proj-test");
  assert.equal(sent[0].body.temperature, undefined);
});

test("OpenRouter: the key is checked on its own, because its model list is public", async () => {
  const { fetcher, sent } = fake([
    { status: 401, body: { error: { message: "No auth credentials found" } } },
  ]);
  await assert.rejects(() => listModels("openrouter", "sk-or-v1-bad", fetcher), /No auth credentials found/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://openrouter.ai/api/v1/key");
});

test("OpenRouter: text models only, the cheap fast ones first", async () => {
  const { fetcher } = fake([
    { body: { data: { label: "mine" } } },
    { body: { data: [
      { id: "anthropic/claude-opus-5", architecture: { output_modalities: ["text"] } },
      { id: "google/gemini-3.6-flash", architecture: { output_modalities: ["text"] } },
      { id: "openai/gpt-image-1", architecture: { output_modalities: ["image", "text"] } },
    ] } },
  ]);
  const names = (await listModels("openrouter", "sk-or-v1-ok", fetcher)).map((m) => m.name);
  assert.deepEqual(names, ["google/gemini-3.6-flash", "anthropic/claude-opus-5"]);
});

test("Gemini is asked for JSON and at temperature 0, as it always was", async () => {
  const { fetcher, sent } = fake([{ body: { candidates: [{ content: { parts: [{ text: "[]" }] } }] } }]);
  assert.equal(await askModel("gemini", "AIzaSytest", "gemini-3.6-flash", "hi", fetcher), "[]");
  assert.equal(sent[0].headers["x-goog-api-key"], "AIzaSytest");
  assert.equal(sent[0].body.generationConfig.responseMimeType, "application/json");
  assert.equal(sent[0].body.generationConfig.temperature, 0);
});

test("a refusal says what the provider said", async () => {
  const { fetcher } = fake([{ status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } }]);
  await assert.rejects(() => listModels("anthropic", "sk-ant-bad", fetcher), /invalid x-api-key/);
});

test("the Supabase function's copy is this file, exactly", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "../src/ai-providers.ts"), "utf8");
  const copy = readFileSync(join(here, "../../../supabase/functions/_shared/ai-providers.ts"), "utf8");
  assert.equal(copy, source, "copy packages/core/src/ai-providers.ts to supabase/functions/_shared/");
});
