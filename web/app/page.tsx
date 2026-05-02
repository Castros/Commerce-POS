type HealthResponse = {
  data?: {
    status: string;
  };
  error?: string;
};

async function getApiHealth(): Promise<string> {
  try {
    const response = await fetch(`${process.env.API_URL || "http://localhost:4100"}/health`, {
      cache: "no-store"
    });
    const payload = (await response.json()) as HealthResponse;
    return payload.data?.status || "unknown";
  } catch {
    return "offline";
  }
}

export default async function Home() {
  const apiStatus = await getApiHealth();

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">Commerce POS</p>
        <h1>Operations Console</h1>
        <p className="summary">
          Scaffolded for organizations, stores, products, customers, wallets,
          orders, payments, receipts, and school integrations.
        </p>
        <dl className="statusGrid">
          <div>
            <dt>API</dt>
            <dd>{apiStatus}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>Pilot</dd>
          </div>
          <div>
            <dt>Money Safety</dt>
            <dd>Ledger-first</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

