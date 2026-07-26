// Beancount HTTP server (TEST DATA — fake customer app for exercising Kuma).
//
// A minimal Node http server wiring the expense + report handlers. Run with
// `npm start` from sandbox-customer/app. It is a review subject, not a
// production service.

import { createServer } from "node:http";
import { createExpense, listExpenses, searchExpenses } from "./expenses.ts";
import { summarize, topExpense } from "./reports.ts";

const PORT = Number(process.env.PORT ?? 4100);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  res.setHeader("content-type", "application/json");

  if (req.method === "GET" && url.pathname === "/expenses") {
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 10);
    res.end(JSON.stringify(listExpenses(page, limit)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/expenses/search") {
    const term = url.searchParams.get("q") ?? "";
    res.end(JSON.stringify(searchExpenses(term)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/expenses") {
    const body = await readJson(req);
    res.statusCode = 201;
    res.end(JSON.stringify(createExpense(body)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/reports/summary") {
    res.end(JSON.stringify({ byCategory: summarize(), top: topExpense() }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

function readJson(req: import("node:http").IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

server.listen(PORT, () => {
  console.log(`beancount-sandbox listening on http://localhost:${PORT}`);
});
