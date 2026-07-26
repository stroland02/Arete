// Beancount web client (TEST DATA — fake customer app for exercising Kuma).
// Talks to the API in ../api/server.ts. Static, dependency-free.

const API = window.BEANCOUNT_API ?? "http://localhost:4100";

function render(expenses) {
  const list = document.getElementById("list");
  list.innerHTML = "";
  for (const e of expenses) {
    const li = document.createElement("li");
    const desc = document.createElement("span");
    desc.textContent = e.description;
    const amount = document.createElement("span");
    amount.className = "amount";
    amount.textContent = `$${(e.amountCents / 100).toFixed(2)}`;
    li.append(desc, amount);
    list.append(li);
  }
}

async function loadPage(page = 1) {
  const res = await fetch(`${API}/expenses?page=${page}&limit=10`);
  const data = await res.json();
  render(data.items ?? []);
}

async function search(term) {
  if (!term) return loadPage(1);
  const res = await fetch(`${API}/expenses/search?q=${encodeURIComponent(term)}`);
  render(await res.json());
}

document.getElementById("q").addEventListener("input", (ev) => {
  search(ev.target.value.trim());
});

loadPage(1);
