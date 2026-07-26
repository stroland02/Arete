// Beancount baseline server (TEST DATA — the pre-feature state of main for v2).
//
// This is what `main` looks like BEFORE the feature PR. It deliberately does
// NOT wire the expense-search / pagination / report handlers — those files are
// what the `feat/expense-search` PR adds, so the PR diff carries the catalogued
// defects for Kuma to review. See sandbox-customer/v2/README.md.

import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4100);

const server = createServer((req, res) => {
  res.setHeader("content-type", "application/json");

  if (req.method === "GET" && req.url === "/health") {
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`beancount-sandbox listening on http://localhost:${PORT}`);
});
