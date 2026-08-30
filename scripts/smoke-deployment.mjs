const apiUrl = new URL(process.env.DEPLOYMENT_API_URL ?? "http://localhost:3001");
const webUrl = new URL(process.env.DEPLOYMENT_WEB_URL ?? "http://localhost:3000");
const allowInsecure = process.env.ALLOW_INSECURE_SMOKE === "true";

if (!allowInsecure && (apiUrl.protocol !== "https:" || webUrl.protocol !== "https:")) {
  throw new Error("Deployment smoke tests require HTTPS. Set ALLOW_INSECURE_SMOKE=true only for a local environment.");
}

async function request(base, path, init = {}) {
  const response = await fetch(new URL(path, base), { ...init, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init.method ?? "GET"} ${path} returned ${response.status}: ${body.slice(0, 500)}`);
  }
  return response;
}

const health = await (await request(apiUrl, "/health")).json();
if (health.status !== "ok") throw new Error("The API liveness response was not healthy.");

const readiness = await (await request(apiUrl, "/health/ready")).json();
if (readiness.status !== "ready" || Object.values(readiness.checks ?? {}).some((value) => value !== true)) {
  throw new Error(`The API is not ready: ${JSON.stringify(readiness)}`);
}

const openapi = await (await request(apiUrl, "/openapi.yaml")).text();
if (!openapi.includes("openapi: 3.")) throw new Error("The generated OpenAPI document was not served.");

await request(webUrl, "/");

if (process.env.METRICS_TOKEN) {
  const metrics = await (await request(apiUrl, "/metrics", { headers: { authorization: `Bearer ${process.env.METRICS_TOKEN}` } })).text();
  if (!metrics.includes("bytecrunch_delivery_queue_items")) throw new Error("Delivery queue metrics were not exposed.");
}

console.log(`Deployment smoke test passed: ${webUrl.origin} -> ${apiUrl.origin}`);
