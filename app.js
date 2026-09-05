/* app.js — views, forms, and rendering. All data read/written via db.js (IndexedDB). */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let currentMonth = new Date();
let currentView = "dashboard";
let analyticsRange = 6; // months; 0 = all time
let editingContext = null; // { store, id }

const CUSTOMER_FIELDS = [
  { key: "date", label: "Date", type: "date", required: true },
  { key: "name", label: "Customer name", type: "text", required: true, placeholder: "e.g. Anita Sharma" },
  { key: "phone", label: "Phone number", type: "tel", placeholder: "e.g. 9876543210" },
  { key: "service", label: "Service availed", type: "text", required: true, placeholder: "e.g. Haircut + Facial" },
  { key: "amount", label: "Amount paid (Rs.)", type: "number", required: true, step: "0.01", min: "0" },
  { key: "paymentMode", label: "Payment mode", type: "select", options: ["Cash", "Card", "UPI", "Other"] },
  { key: "notes", label: "Notes", type: "textarea", placeholder: "Optional" }
];

const EXPENSE_FIELDS = [
  { key: "date", label: "Date", type: "date", required: true },
  { key: "category", label: "Category", type: "select",
    options: ["Rent", "Products/Stock", "Electricity", "Water", "Salaries", "Marketing", "Equipment", "Maintenance", "Other"] },
  { key: "description", label: "Description", type: "text", placeholder: "Optional" },
  { key: "amount", label: "Amount (Rs.)", type: "number", required: true, step: "0.01", min: "0" }
];

const STORE_CONFIG = {
  customers: { fields: CUSTOMER_FIELDS, singular: "visit", titleField: "name", subField: "service" },
  expenses: { fields: EXPENSE_FIELDS, singular: "expense", titleField: "category", subField: "description" }
};

/* ---------------- helpers ---------------- */

function money(n) {
  const v = Number(n) || 0;
  return "Rs. " + v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(d) {
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function displayDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ---------------- view switching ---------------- */

function setView(view) {
  currentView = view;
  $$(".view").forEach((v) => (v.hidden = true));
  $(`#view-${view}`).hidden = false;
  $$(".nav-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.view === view));
  $("#fab").hidden = !(view === "customers" || view === "expenses");
  if (view === "dashboard") renderDashboard();
  if (view === "customers") renderCustomerList();
  if (view === "expenses") renderExpenseList();
  if (view === "analytics") renderAnalytics();
}

$$(".nav-btn").forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.view)));

$("#prevMonth").addEventListener("click", () => {
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
  renderDashboard();
});
$("#nextMonth").addEventListener("click", () => {
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
  renderDashboard();
});

/* ---------------- dashboard ---------------- */

async function renderDashboard() {
  $("#monthLabel").textContent = monthLabel(currentMonth);
  const key = monthKey(currentMonth);

  const [customers, expenses] = await Promise.all([DB.getAll("customers"), DB.getAll("expenses")]);
  const monthCustomers = customers.filter((c) => c.date && c.date.startsWith(key));
  const monthExpenses = expenses.filter((e) => e.date && e.date.startsWith(key));

  const revenue = monthCustomers.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const spent = monthExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const pl = revenue - spent;

  $("#statRevenue").textContent = money(revenue);
  $("#statExpenses").textContent = money(spent);
  $("#statPL").textContent = money(pl);

  const plCard = $("#statPLCard");
  plCard.classList.remove("stat-card--profit", "stat-card--loss");
  plCard.classList.add(pl >= 0 ? "stat-card--profit" : "stat-card--loss");

  const combined = [
    ...monthCustomers.map((c) => ({ ...c, _store: "customers" })),
    ...monthExpenses.map((e) => ({ ...e, _store: "expenses" }))
  ].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 8);

  const list = $("#recentList");
  list.innerHTML = "";
  combined.forEach((item) => list.appendChild(buildEntryItem(item, item._store)));
  $("#recentEmpty").hidden = combined.length > 0;
}

/* ---------------- list rendering ---------------- */

function buildEntryItem(record, storeName) {
  const cfg = STORE_CONFIG[storeName];
  const li = document.createElement("li");
  li.className = "entry-item";

  const main = document.createElement("div");
  main.className = "entry-main";

  const title = document.createElement("span");
  title.className = "entry-title";
  title.textContent = record[cfg.titleField] || (storeName === "customers" ? "Unnamed customer" : "Expense");

  const sub = document.createElement("span");
  sub.className = "entry-sub";
  const subText = record[cfg.subField] ? `${record[cfg.subField]} · ${displayDate(record.date)}` : displayDate(record.date);
  sub.textContent = subText;

  main.append(title, sub);

  const amount = document.createElement("span");
  amount.className = "entry-amount";
  amount.textContent = money(record.amount);

  li.append(main, amount);
  li.addEventListener("click", () => openSheet(storeName, record));
  return li;
}

async function renderCustomerList() {
  const all = await DB.getAll("customers");
  const q = $("#customerSearch").value.trim().toLowerCase();
  const filtered = all
    .filter((c) => !q || (c.name || "").toLowerCase().includes(q) || (c.service || "").toLowerCase().includes(q))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));

  const list = $("#customerList");
  list.innerHTML = "";
  filtered.forEach((r) => list.appendChild(buildEntryItem(r, "customers")));
  $("#customerEmpty").hidden = filtered.length > 0 || all.length > 0;
  if (all.length > 0 && filtered.length === 0) {
    $("#customerEmpty").hidden = false;
    $("#customerEmpty").textContent = "No matching visits found.";
  } else {
    $("#customerEmpty").textContent = "No visits logged yet. Tap + to add your first customer entry.";
  }
}

async function renderExpenseList() {
  const all = await DB.getAll("expenses");
  const q = $("#expenseSearch").value.trim().toLowerCase();
  const filtered = all
    .filter((e) => !q || (e.category || "").toLowerCase().includes(q) || (e.description || "").toLowerCase().includes(q))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));

  const list = $("#expenseList");
  list.innerHTML = "";
  filtered.forEach((r) => list.appendChild(buildEntryItem(r, "expenses")));
  if (all.length > 0 && filtered.length === 0) {
    $("#expenseEmpty").hidden = false;
    $("#expenseEmpty").textContent = "No matching expenses found.";
  } else {
    $("#expenseEmpty").hidden = filtered.length > 0;
    $("#expenseEmpty").textContent = "No expenses logged yet. Tap + to add your first expense.";
  }
}

$("#customerSearch").addEventListener("input", renderCustomerList);
$("#expenseSearch").addEventListener("input", renderExpenseList);

/* ---------------- add / edit sheet ---------------- */

const overlay = $("#sheetOverlay");
const sheetForm = $("#sheetForm");
const sheetTitle = $("#sheetTitle");
const sheetDelete = $("#sheetDelete");

function openSheet(storeName, record = null) {
  const cfg = STORE_CONFIG[storeName];
  editingContext = { store: storeName, id: record ? record.id : null };

  sheetTitle.textContent = record ? `Edit ${cfg.singular}` : `Add ${cfg.singular}`;
  sheetForm.innerHTML = "";

  cfg.fields.forEach((f) => {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const label = document.createElement("label");
    label.textContent = f.label;
    label.htmlFor = "f_" + f.key;
    wrap.appendChild(label);

    let input;
    if (f.type === "select") {
      input = document.createElement("select");
      f.options.forEach((opt) => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        input.appendChild(o);
      });
    } else if (f.type === "textarea") {
      input = document.createElement("textarea");
    } else {
      input = document.createElement("input");
      input.type = f.type;
      if (f.step) input.step = f.step;
      if (f.min !== undefined) input.min = f.min;
      if (f.placeholder) input.placeholder = f.placeholder;
    }
    input.id = "f_" + f.key;
    input.name = f.key;
    if (f.required) input.required = true;

    const val = record ? record[f.key] : (f.key === "date" ? todayISO() : "");
    if (val !== undefined && val !== null) input.value = val;

    wrap.appendChild(input);
    sheetForm.appendChild(wrap);
  });

  sheetDelete.hidden = !record;
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeSheet() {
  overlay.hidden = true;
  document.body.style.overflow = "";
  editingContext = null;
}

overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closeSheet();
});

$("#fab").addEventListener("click", () => {
  openSheet(currentView === "expenses" ? "expenses" : "customers");
});

sheetForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingContext) return;
  const { store, id } = editingContext;
  const cfg = STORE_CONFIG[store];
  const record = id ? { id } : {};

  cfg.fields.forEach((f) => {
    const input = $("#f_" + f.key, sheetForm);
    record[f.key] = f.type === "number" ? Number(input.value || 0) : input.value.trim();
  });

  if (id) {
    await DB.put(store, record);
  } else {
    await DB.add(store, record);
  }

  closeSheet();
  refreshAll();
});

sheetDelete.addEventListener("click", async () => {
  if (!editingContext || !editingContext.id) return;
  if (!confirm("Delete this entry? This cannot be undone.")) return;
  await DB.delete(editingContext.store, editingContext.id);
  closeSheet();
  refreshAll();
});

function refreshAll() {
  renderDashboard();
  if (currentView === "customers") renderCustomerList();
  if (currentView === "expenses") renderExpenseList();
}

/* ---------------- CSV export / import ---------------- */

function toCSV(rows, columns) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.join(",");
  const lines = rows.map((r) => columns.map((c) => esc(r[c])).join(","));
  return [header, ...lines].join("\n");
}

function downloadFile(filename, content, mime = "text/csv") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, idx) => (obj[h.trim()] = (r[idx] ?? "").trim()));
    return obj;
  });
}

$$('[data-export]').forEach((btn) => {
  btn.addEventListener("click", async () => {
    const store = btn.dataset.export;
    const cfg = STORE_CONFIG[store];
    const columns = cfg.fields.map((f) => f.key);
    const rows = await DB.getAll(store);
    const csv = toCSV(rows, columns);
    downloadFile(`${store}-${todayISO()}.csv`, csv);
  });
});

$("#importCustomers").addEventListener("change", (e) => importCSVFile(e, "customers"));
$("#importExpenses").addEventListener("change", (e) => importCSVFile(e, "expenses"));

function importCSVFile(e, store) {
  const file = e.target.files[0];
  if (!file) return;
  const cfg = STORE_CONFIG[store];
  const reader = new FileReader();
  reader.onload = async () => {
    const records = parseCSV(reader.result);
    let count = 0;
    for (const r of records) {
      const rec = {};
      cfg.fields.forEach((f) => {
        rec[f.key] = f.type === "number" ? Number(r[f.key] || 0) : (r[f.key] || "");
      });
      if (Object.values(rec).some((v) => v !== "" && v !== 0)) {
        await DB.add(store, rec);
        count++;
      }
    }
    alert(`Imported ${count} record(s) into ${store === "customers" ? "customer visits" : "expenses"}.`);
    refreshAll();
    e.target.value = "";
  };
  reader.readAsText(file);
}

$("#clearAllBtn").addEventListener("click", async () => {
  if (!confirm("This erases every customer visit and expense stored in your account, on every device. Continue?")) return;
  if (!confirm("Are you absolutely sure? This cannot be undone.")) return;
  await DB.clear("customers");
  await DB.clear("expenses");
  refreshAll();
});

/* ---------------- analytics ---------------- */

$$(".range-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    analyticsRange = Number(btn.dataset.range);
    $$(".range-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
    renderAnalytics();
  });
});

function roundedTopBarPath(x, top, width, height, radius) {
  if (height <= 0) return "";
  const r = Math.max(0, Math.min(radius, width / 2, height));
  const bottom = top + height;
  return `M${x},${bottom} L${x},${top + r} Q${x},${top} ${x + r},${top} ` +
         `L${x + width - r},${top} Q${x + width},${top} ${x + width},${top + r} ` +
         `L${x + width},${bottom} Z`;
}

function buildTrendChart(months) {
  const groupW = 56;
  const barW = 16;
  const gap = 3;
  const plotH = 130;
  const labelH = 22;
  const width = Math.max(months.length * groupW, groupW);
  const height = plotH + labelH;
  const maxVal = Math.max(1, ...months.map((m) => Math.max(m.revenue, m.expense)));

  let bars = "";
  months.forEach((m, i) => {
    const cx = i * groupW + groupW / 2;
    const revH = (m.revenue / maxVal) * (plotH - 6);
    const expH = (m.expense / maxVal) * (plotH - 6);
    const revX = cx - barW - gap / 2;
    const expX = cx + gap / 2;
    bars += `<path d="${roundedTopBarPath(revX, plotH - revH, barW, revH, 4)}" fill="var(--gold)"><title>${m.label}: ${money(m.revenue)} revenue</title></path>`;
    bars += `<path d="${roundedTopBarPath(expX, plotH - expH, barW, expH, 4)}" fill="var(--expense)"><title>${m.label}: ${money(m.expense)} expenses</title></path>`;
    bars += `<text class="bar-label" x="${cx}" y="${plotH + 15}" text-anchor="middle">${m.shortLabel}</text>`;
  });

  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">` +
         `<line class="baseline" x1="0" y1="${plotH}" x2="${width}" y2="${plotH}" />` +
         bars +
         `</svg>`;
}

function buildRankRows(items, maxItems) {
  if (!items.length) {
    return `<p class="empty-hint">Nothing logged in this range yet.</p>`;
  }
  const sorted = [...items].sort((a, b) => b.value - a.value);
  let shown = sorted;
  let otherTotal = 0;
  if (maxItems && sorted.length > maxItems) {
    shown = sorted.slice(0, maxItems - 1);
    otherTotal = sorted.slice(maxItems - 1).reduce((s, r) => s + r.value, 0);
  }
  const maxVal = Math.max(1, shown[0] ? shown[0].value : 0, otherTotal);
  let html = shown.map((r) => `
    <div class="rank-row">
      <div class="rank-row-top">
        <span class="rank-row-label">${r.label}</span>
        <span class="rank-row-value">${money(r.value)}</span>
      </div>
      <div class="rank-track"><div class="rank-fill" style="width:${Math.max(3, (r.value / maxVal) * 100)}%"></div></div>
    </div>`).join("");
  if (otherTotal > 0) {
    html += `
    <div class="rank-row">
      <div class="rank-row-top">
        <span class="rank-row-label">Other</span>
        <span class="rank-row-value">${money(otherTotal)}</span>
      </div>
      <div class="rank-track"><div class="rank-fill" style="width:${Math.max(3, (otherTotal / maxVal) * 100)}%"></div></div>
    </div>`;
  }
  return html;
}

async function renderAnalytics() {
  const [customers, expenses] = await Promise.all([DB.getAll("customers"), DB.getAll("expenses")]);

  // Work out which months are in range, oldest first.
  const now = new Date();
  let monthCount = analyticsRange || 60; // "All" caps at 5 years of buckets, plenty for this app
  if (analyticsRange === 0) {
    const allDates = [...customers, ...expenses].map((r) => r.date).filter(Boolean).sort();
    if (allDates.length) {
      const earliest = new Date(allDates[0] + "T00:00:00");
      monthCount = (now.getFullYear() - earliest.getFullYear()) * 12 + (now.getMonth() - earliest.getMonth()) + 1;
    } else {
      monthCount = 1;
    }
  }

  const months = [];
  for (let i = monthCount - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    months.push({
      key,
      label: monthLabel(d),
      shortLabel: d.toLocaleDateString("en-IN", { month: "short" }),
      revenue: 0,
      expense: 0
    });
  }
  const monthIndex = Object.fromEntries(months.map((m, i) => [m.key, i]));
  const inRange = (date) => date && monthIndex[date.slice(0, 7)] !== undefined;

  const rangeCustomers = customers.filter((c) => inRange(c.date));
  const rangeExpenses = expenses.filter((e) => inRange(e.date));

  rangeCustomers.forEach((c) => { months[monthIndex[c.date.slice(0, 7)]].revenue += Number(c.amount) || 0; });
  rangeExpenses.forEach((e) => { months[monthIndex[e.date.slice(0, 7)]].expense += Number(e.amount) || 0; });

  const totalRevenue = rangeCustomers.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const totalExpenses = rangeExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalProfit = totalRevenue - totalExpenses;
  const totalVisits = rangeCustomers.length;
  const avgTicket = totalVisits ? totalRevenue / totalVisits : 0;

  $("#anRevenue").textContent = money(totalRevenue);
  $("#anExpenses").textContent = money(totalExpenses);
  $("#anProfit").textContent = money(totalProfit);
  $("#anVisits").textContent = totalVisits.toLocaleString("en-IN");
  $("#anAvgTicket").textContent = money(avgTicket);

  const plCard = $("#anPLCard");
  plCard.classList.remove("stat-card--profit", "stat-card--loss");
  plCard.classList.add(totalProfit >= 0 ? "stat-card--profit" : "stat-card--loss");

  $("#trendChart").innerHTML = buildTrendChart(months);

  const byCategory = {};
  rangeExpenses.forEach((e) => {
    const key = e.category || "Other";
    byCategory[key] = (byCategory[key] || 0) + (Number(e.amount) || 0);
  });
  $("#categoryBreakdown").innerHTML = buildRankRows(
    Object.entries(byCategory).map(([label, value]) => ({ label, value })), 6
  );

  const byService = {};
  rangeCustomers.forEach((c) => {
    const key = (c.service || "").trim() || "Unspecified";
    byService[key] = (byService[key] || 0) + (Number(c.amount) || 0);
  });
  $("#serviceBreakdown").innerHTML = buildRankRows(
    Object.entries(byService).map(([label, value]) => ({ label, value })), 5
  );

  const byPayment = {};
  rangeCustomers.forEach((c) => {
    const key = c.paymentMode || "Other";
    byPayment[key] = (byPayment[key] || 0) + (Number(c.amount) || 0);
  });
  $("#paymentBreakdown").innerHTML = buildRankRows(
    Object.entries(byPayment).map(([label, value]) => ({ label, value }))
  );

  $("#analyticsEmpty").hidden = !(rangeCustomers.length === 0 && rangeExpenses.length === 0);
}

/* ---------------- install prompt ---------------- */

let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $("#installBtn").hidden = false;
});
$("#installBtn").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $("#installBtn").hidden = true;
});

/* ---------------- service worker ---------------- */

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

/* ---------------- auth ---------------- */

const authScreen = $("#authScreen");
const appRoot = $("#appRoot");
const authForm = $("#authForm");
const authError = $("#authError");

function showAuthError(err) {
  authError.textContent = err && err.message ? err.message : "Something went wrong. Try again.";
  authError.hidden = false;
}

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.hidden = true;
  const email = $("#authEmail").value.trim();
  const password = $("#authPassword").value;
  try {
    await Auth.signIn(email, password);
  } catch (err) {
    showAuthError(err);
  }
});

$("#authCreateBtn").addEventListener("click", async () => {
  authError.hidden = true;
  const email = $("#authEmail").value.trim();
  const password = $("#authPassword").value;
  if (!email || password.length < 6) {
    showAuthError({ message: "Enter an email and a password with at least 6 characters." });
    return;
  }
  try {
    await Auth.signUp(email, password);
  } catch (err) {
    showAuthError(err);
  }
});

$("#authForgotBtn").addEventListener("click", async () => {
  authError.hidden = true;
  const email = $("#authEmail").value.trim();
  if (!email) {
    showAuthError({ message: "Enter your email above first, then tap Forgot password." });
    return;
  }
  try {
    await Auth.resetPassword(email);
    showAuthError({ message: "Password reset email sent — check your inbox." });
    authError.style.color = "var(--success)";
  } catch (err) {
    showAuthError(err);
  }
});

$("#logoutBtn").addEventListener("click", () => Auth.signOut());

Auth.onChange((user) => {
  authError.style.color = "";
  if (user) {
    authScreen.hidden = true;
    appRoot.hidden = false;
    setView("dashboard");
  } else {
    authScreen.hidden = false;
    appRoot.hidden = true;
  }
});
