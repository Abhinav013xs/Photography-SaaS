import { getConfig } from '../packages/config/src/index.js';

async function checkHealth() {
  const config = getConfig();
  const apiHealthUrl = `http://localhost:${config.port}/health`;

  console.log(`[Health Probe] Pinging API at ${apiHealthUrl}...`);
  try {
    const res = await fetch(apiHealthUrl);
    const data = await res.json();
    console.log(`[Health Probe] Status: ${res.status} ${res.statusText}`);
    console.log(JSON.stringify(data, null, 2));
    process.exit(res.ok ? 0 : 1);
  } catch (err) {
    console.error(`[Health Probe] Failed to reach API: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

checkHealth();
