#!/usr/bin/env node
/** List Nemotron model IDs available on your Nebius Token Factory account. */

import { getSettings } from "../src/config.js";
import { OpenAICompatibleClient } from "../src/llm/client.js";

const s = getSettings();
if (!s.llmConfigured) {
  console.error("Set NEBIUS_API_KEY in .env first.");
  process.exit(2);
}
const client = new OpenAICompatibleClient({ baseUrl: s.nebiusBaseUrl, apiKey: s.nebiusApiKey, timeoutSeconds: 60 });
const ids = (await client.listModels()).sort();
const nemotron = ids.filter((id) => id.toLowerCase().includes("nemotron"));
console.log(`Nemotron models:\n  ${(nemotron.length ? nemotron : ["(none found)"]).join("\n  ")}`);
console.log(`\nConfigured: nano=${s.nemotronNanoModel} super=${s.nemotronSuperModel} ultra=${s.nemotronUltraModel}`);
for (const [tier, id] of [["nano", s.nemotronNanoModel], ["super", s.nemotronSuperModel], ["ultra", s.nemotronUltraModel]]) {
  if (!ids.includes(id)) console.log(`  WARNING: ${tier} model ${JSON.stringify(id)} is not in your catalog`);
}
