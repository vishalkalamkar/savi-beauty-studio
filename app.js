/* app.js — views, forms, and rendering. All data read/written via db.js (Firestore). */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let currentMonth = new Date();
let currentView = "dashboard";
let analyticsRange = 6; // months; 0 = all time
let customerMode = "visits"; // Customers tab: "visits" (by day) or "customers" (one row per person)
let editingContext = null; // { store, id }
let staffDate = todayISO(); // day being marked on the Staff tab; its month drives the salary section

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

const STAFF_FIELDS = [
  { key: "name", label: "Staff name", type: "text", required: true, placeholder: "e.g. Priya" },
  { key: "phone", label: "Phone number", type: "tel", placeholder: "e.g. 9876543210" },
  { key: "salaryType", label: "Salary type", type: "select", options: ["Monthly", "Daily"] },
  { key: "salary", label: "Salary (Rs.) — per month, or per day for daily wage", type: "number", required: true, step: "1", min: "0" },
  { key: "joinDate", label: "Joining date", type: "date" },
  { key: "status", label: "Status", type: "select", options: ["Active", "Left"] }
];

const STORE_CONFIG = {
  customers: { fields: CUSTOMER_FIELDS, singular: "visit", titleField: "name", subField: "service" },
  expenses: { fields: EXPENSE_FIELDS, singular: "expense", titleField: "category", subField: "description" },
  staff: { fields: STAFF_FIELDS, singular: "staff member", titleField: "name", subField: "salaryType" }
};

// Attendance docs use the id `${staffId}_${date}` so each person has at most one mark per day.
const ATTENDANCE_STATUSES = [
  { key: "P", label: "P", name: "Present" },
  { key: "H", label: "½", name: "Half day" },
  { key: "A", label: "A", name: "Absent" },
  { key: "L", label: "L", name: "Paid leave" }
];

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

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayISO() {
  return toISO(new Date());
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ---------------- view switching ---------------- */

function setView(view) {
  currentView = view;
  $$(".view").forEach((v) => (v.hidden = true));
  $(`#view-${view}`).hidden = false;
  $$(".nav-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.view === view));
  $("#fab").hidden = !(view === "customers" || view === "expenses" || view === "staff");
  if (view === "dashboard") renderDashboard();
  if (view === "customers") renderCustomerList();
  if (view === "expenses") renderExpenseList();
  if (view === "staff") renderStaff();
  if (view === "analytics") renderAnalytics();
}

$$(".nav-btn").forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.view)));

// Overview, Customers and Expenses share one selected month.
$$("[data-month-step]").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + Number(btn.dataset.monthStep), 1);
    refreshAll();
  });
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

// showDate is off inside day groups, where the date is already in the group header.
function buildEntryItem(record, storeName, { showDate = true } = {}) {
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
  const parts = [record[cfg.subField]];
  if (showDate) parts.push(displayDate(record.date));
  else if (storeName === "customers") parts.push(record.paymentMode);
  sub.textContent = parts.filter(Boolean).join(" · ");

  main.append(title, sub);

  const amount = document.createElement("span");
  amount.className = "entry-amount";
  amount.textContent = money(record.amount);

  li.append(main, amount);
  li.addEventListener("click", () => openSheet(storeName, record));
  return li;
}

const byNewest = (a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0);
const sumAmount = (records) => records.reduce((s, r) => s + (Number(r.amount) || 0), 0);
const plural = (n, word, many = word + "s") => `${n} ${n === 1 ? word : many}`;

function dayHeading(iso) {
  if (!iso) return "No date";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (iso === todayISO()) return "Today";
  if (iso === toISO(yesterday)) return "Yesterday";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  const opts = { weekday: "short", day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-IN", opts);
}

/* Renders records (already sorted newest first) as day groups, each with a
   sticky header showing the day's count and total. */
function renderDayGroups(listEl, records, storeName, word) {
  listEl.innerHTML = "";
  const groups = new Map();
  records.forEach((r) => {
    const key = r.date || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  groups.forEach((items, date) => {
    const group = el("li", "day-group");
    const header = el("div", "day-header");
    header.append(
      el("span", "day-header-title", dayHeading(date)),
      el("span", "day-header-meta", `${plural(items.length, word)} · ${money(sumAmount(items))}`)
    );
    const ul = el("ul", "entry-list");
    items.forEach((r) => ul.appendChild(buildEntryItem(r, storeName, { showDate: false })));
    group.append(header, ul);
    listEl.appendChild(group);
  });
}

function showEmpty(emptyEl, text) {
  emptyEl.hidden = !text;
  emptyEl.textContent = text || "";
}

/* One profile per customer name (case-insensitive), across all time. */
function buildCustomerProfiles(visits) {
  const profiles = new Map();
  [...visits].sort((a, b) => -byNewest(a, b)).forEach((v) => {
    const name = (v.name || "").trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (!profiles.has(key)) profiles.set(key, { name, phone: "", visits: [], total: 0, lastDate: "" });
    const p = profiles.get(key);
    // Oldest → newest, so the latest spelling, phone and date win.
    p.name = name;
    if (v.phone) p.phone = v.phone;
    if (v.date) p.lastDate = v.date;
    p.visits.push(v);
    p.total += Number(v.amount) || 0;
  });
  return [...profiles.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

function buildProfileItem(p) {
  const li = el("li", "entry-item");
  const main = el("div", "entry-main");
  const last = p.lastDate ? ` · last ${displayDate(p.lastDate)}` : "";
  main.append(el("span", "entry-title", p.name), el("span", "entry-sub", `${plural(p.visits.length, "visit")}${last}`));
  li.append(main, el("span", "entry-amount", money(p.total)));
  li.addEventListener("click", () => openHistory(p));
  return li;
}

async function renderCustomerList() {
  const all = await DB.getAll("customers");
  const q = $("#customerSearch").value.trim().toLowerCase();
  const list = $("#customerList");
  const summary = $("#customerSummary");
  const empty = $("#customerEmpty");
  const isCustomersMode = customerMode === "customers";

  $$("[data-customer-mode]").forEach((b) => b.classList.toggle("is-active", b.dataset.customerMode === customerMode));
  $("#customerMonthSwitch").hidden = isCustomersMode;
  $("#customerMonthLabel").textContent = monthLabel(currentMonth);
  $("#customerSearch").placeholder = isCustomersMode ? "Search by name or phone" : "Search by name or service";

  if (all.length === 0) {
    list.innerHTML = "";
    summary.textContent = "";
    showEmpty(empty, "No visits logged yet. Tap + to add your first customer entry.");
    return;
  }

  if (isCustomersMode) {
    const profiles = buildCustomerProfiles(all)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.phone.includes(q));
    list.innerHTML = "";
    profiles.forEach((p) => list.appendChild(buildProfileItem(p)));
    summary.textContent = q ? `${plural(profiles.length, "match", "matches")}` : `${plural(profiles.length, "customer")} · most recent first`;
    showEmpty(empty, profiles.length ? "" : "No matching customers found.");
    return;
  }

  // Visits: the selected month, or every month while searching.
  const key = monthKey(currentMonth);
  const visits = all
    .filter((c) => q
      ? (c.name || "").toLowerCase().includes(q) || (c.service || "").toLowerCase().includes(q)
      : c.date && c.date.startsWith(key))
    .sort(byNewest);
  renderDayGroups(list, visits, "customers", "visit");
  summary.textContent = q
    ? `${plural(visits.length, "match", "matches")} across all months · ${money(sumAmount(visits))}`
    : `${plural(visits.length, "visit")} · ${money(sumAmount(visits))}`;
  showEmpty(empty, visits.length ? "" : q ? "No matching visits found." : `No visits in ${monthLabel(currentMonth)}.`);
}

async function renderExpenseList() {
  const all = await DB.getAll("expenses");
  const q = $("#expenseSearch").value.trim().toLowerCase();
  const key = monthKey(currentMonth);
  $("#expenseMonthLabel").textContent = monthLabel(currentMonth);

  const expenses = all
    .filter((e) => q
      ? (e.category || "").toLowerCase().includes(q) || (e.description || "").toLowerCase().includes(q)
      : e.date && e.date.startsWith(key))
    .sort(byNewest);
  renderDayGroups($("#expenseList"), expenses, "expenses", "expense");
  $("#expenseSummary").textContent = !all.length ? "" : q
    ? `${plural(expenses.length, "match", "matches")} across all months · ${money(sumAmount(expenses))}`
    : `${plural(expenses.length, "expense")} · ${money(sumAmount(expenses))}`;
  showEmpty($("#expenseEmpty"), expenses.length ? ""
    : !all.length ? "No expenses logged yet. Tap + to add your first expense."
    : q ? "No matching expenses found." : `No expenses in ${monthLabel(currentMonth)}.`);
}

$("#customerSearch").addEventListener("input", renderCustomerList);
$("#expenseSearch").addEventListener("input", renderExpenseList);

$$("[data-customer-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    customerMode = btn.dataset.customerMode;
    renderCustomerList();
  });
});

/* ---------------- customer history sheet ---------------- */

const historyOverlay = $("#historyOverlay");
let historyProfile = null;

function openHistory(profile) {
  historyProfile = profile;
  $("#historyName").textContent = profile.name;
  const phone = $("#historyPhone");
  phone.innerHTML = "";
  if (profile.phone) {
    const link = el("a", "", profile.phone);
    link.href = `tel:${profile.phone.replace(/[^\d+]/g, "")}`;
    phone.appendChild(link);
  } else {
    phone.textContent = "No phone number saved";
  }
  $("#historyVisits").textContent = String(profile.visits.length);
  $("#historyTotal").textContent = money(profile.total);
  const list = $("#historyList");
  list.innerHTML = "";
  [...profile.visits].sort(byNewest).forEach((v) => list.appendChild(buildEntryItem(v, "customers")));
  historyOverlay.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeHistory() {
  historyOverlay.hidden = true;
  document.body.style.overflow = "";
}

historyOverlay.addEventListener("click", (e) => {
  if (e.target === historyOverlay) closeHistory();
});

$("#historyAdd").addEventListener("click", () => {
  const { name, phone } = historyProfile;
  openSheet("customers", null, { name, phone });
});

/* ---------------- add / edit sheet ---------------- */

const overlay = $("#sheetOverlay");
const sheetForm = $("#sheetForm");
const sheetTitle = $("#sheetTitle");
const sheetDelete = $("#sheetDelete");

// prefill: starting values for a new record, e.g. { name, phone } from a customer's history.
function openSheet(storeName, record = null, prefill = {}) {
  historyOverlay.hidden = true;
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

    const val = record ? record[f.key]
      : prefill[f.key] !== undefined ? prefill[f.key]
      : (f.key === "date" ? todayISO() : "");
    if (val !== undefined && val !== null) input.value = val;

    wrap.appendChild(input);
    sheetForm.appendChild(wrap);
  });

  sheetDelete.hidden = !record;
  overlay.hidden = false;
  document.body.style.overflow = "hidden";

  if (storeName === "customers" && !record) {
    setupCustomerNameAutocomplete();
  }
}

async function setupCustomerNameAutocomplete() {
  const nameInput = $("#f_name");
  if (!nameInput) return;

  const customers = await DB.getAll("customers");
  // Sheet may have moved on (closed, or switched to editing/another store) while this loaded.
  if (!editingContext || editingContext.store !== "customers" || editingContext.id) return;
  if ($("#f_name") !== nameInput) return;

  const byName = new Map();
  customers
    .filter((c) => c.name && c.name.trim())
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .forEach((c) => byName.set(c.name.trim().toLowerCase(), c));

  let datalist = document.getElementById("customerNamesList");
  if (!datalist) {
    datalist = document.createElement("datalist");
    datalist.id = "customerNamesList";
    document.body.appendChild(datalist);
  }
  datalist.innerHTML = "";
  byName.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.name.trim();
    datalist.appendChild(opt);
  });
  nameInput.setAttribute("list", "customerNamesList");

  nameInput.addEventListener("input", () => {
    const match = byName.get(nameInput.value.trim().toLowerCase());
    const phoneInput = $("#f_phone");
    if (match && phoneInput && !phoneInput.value) {
      phoneInput.value = match.phone || "";
    }
  });
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
  openSheet(STORE_CONFIG[currentView] ? currentView : "customers");
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
  const { store, id } = editingContext;
  const message = store === "staff"
    ? "Delete this staff member and all their attendance? Salary payments already logged in Expenses are kept. Tip: set Status to \"Left\" instead to keep their history."
    : "Delete this entry? This cannot be undone.";
  if (!confirm(message)) return;
  if (store === "staff") {
    const attendance = await DB.getAll("attendance");
    await Promise.all(attendance.filter((a) => a.staffId === id).map((a) => DB.delete("attendance", a.id)));
  }
  await DB.delete(store, id);
  closeSheet();
  refreshAll();
});

function refreshAll() {
  renderDashboard();
  if (currentView === "customers") renderCustomerList();
  if (currentView === "expenses") renderExpenseList();
  if (currentView === "staff") renderStaff();
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
    let columns, rows;
    if (store === "attendance") {
      const [attendance, staff] = await Promise.all([DB.getAll("attendance"), DB.getAll("staff")]);
      const nameById = Object.fromEntries(staff.map((s) => [s.id, s.name]));
      const statusName = Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s.key, s.name]));
      columns = ["date", "staffName", "status"];
      rows = attendance
        .map((a) => ({ date: a.date || "", staffName: nameById[a.staffId] || "(deleted)", status: statusName[a.status] || a.status }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.staffName.localeCompare(b.staffName));
    } else {
      columns = STORE_CONFIG[store].fields.map((f) => f.key);
      rows = await DB.getAll(store);
    }
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
  if (!confirm("This erases every customer visit, expense, staff member and attendance record stored in your account, on every device. Continue?")) return;
  if (!confirm("Are you absolutely sure? This cannot be undone.")) return;
  await DB.clear("customers");
  await DB.clear("expenses");
  await DB.clear("staff");
  await DB.clear("attendance");
  refreshAll();
});

/* ---------------- staff: attendance + salary ---------------- */

function shiftStaffDate(days) {
  const d = new Date(staffDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  staffDate = toISO(d);
  renderStaff();
}

$("#prevDay").addEventListener("click", () => shiftStaffDate(-1));
$("#nextDay").addEventListener("click", () => shiftStaffDate(1));
$("#dayPicker").addEventListener("change", (e) => {
  if (!e.target.value) return;
  staffDate = e.target.value;
  renderStaff();
});

/* Works out one staff member's pay for a month.
   Monthly: salary / days-in-month per day; absent days are deducted, half days
   deduct half a day, paid leave and unmarked days are paid. Days before the
   joining date aren't paid. Staff marked "Left" are only paid for days actually
   marked, so the rest of the month after they leave isn't paid as "unmarked".
   Daily: wage x (present + paid leave + half x half days). */
function calcSalary(staff, attendance, monthDate) {
  const key = monthKey(monthDate);
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const join = staff.joinDate || "";

  let firstDay = 1;
  if (join.slice(0, 7) === key) firstDay = Number(join.slice(8, 10)) || 1;
  else if (join && join.slice(0, 7) > key) firstDay = daysInMonth + 1; // hadn't joined yet
  const workDays = Math.max(0, daysInMonth - firstDay + 1);

  const counts = { P: 0, H: 0, A: 0, L: 0 };
  attendance
    .filter((a) => a.staffId === staff.id && a.date && a.date.startsWith(key) && (!join || a.date >= join))
    .forEach((a) => { if (counts[a.status] !== undefined) counts[a.status]++; });

  const rate = Number(staff.salary) || 0;
  let perDay, paidDays;
  if (staff.salaryType === "Daily") {
    perDay = rate;
    paidDays = counts.P + counts.L + 0.5 * counts.H;
  } else {
    perDay = rate / daysInMonth;
    paidDays = staff.status === "Left"
      ? counts.P + counts.L + 0.5 * counts.H
      : Math.max(0, workDays - counts.A - 0.5 * counts.H);
  }

  return { counts, paidDays, workDays, daysInMonth, amount: Math.round(perDay * paidDays) };
}

function buildAttendanceItem(staff, mark) {
  const li = el("li", "entry-item att-item");
  const current = ATTENDANCE_STATUSES.find((s) => s.key === (mark && mark.status));

  const main = el("div", "entry-main");
  main.append(el("span", "entry-title", staff.name || "Unnamed"), el("span", "entry-sub", current ? current.name : "Not marked"));
  main.addEventListener("click", () => openSheet("staff", staff));

  const chips = el("div", "att-chips");
  ATTENDANCE_STATUSES.forEach((st) => {
    const active = current === st;
    const chip = el("button", `att-chip att-chip--${st.key}${active ? " is-active" : ""}`, st.label);
    chip.type = "button";
    chip.title = st.name;
    chip.setAttribute("aria-label", `${staff.name}: ${st.name}`);
    chip.setAttribute("aria-pressed", String(active));
    chip.addEventListener("click", async () => {
      chips.querySelectorAll("button").forEach((b) => (b.disabled = true));
      const docId = `${staff.id}_${staffDate}`;
      // Tapping the active status again clears the mark.
      if (active) await DB.delete("attendance", docId);
      else await DB.put("attendance", { id: docId, staffId: staff.id, date: staffDate, status: st.key });
      renderStaff();
    });
    chips.appendChild(chip);
  });

  li.append(main, chips);
  return li;
}

function buildSalaryItem(staff, salary, paid, monthName, salaryMonth) {
  const li = el("li", "salary-card");

  const top = el("div", "salary-top");
  const main = el("div", "entry-main");
  const rateText = staff.salaryType === "Daily" ? `${money(staff.salary)}/day` : `${money(staff.salary)}/month`;
  main.append(
    el("span", "entry-title", staff.name || "Unnamed"),
    el("span", "entry-sub", staff.status === "Left" ? `${rateText} · Left` : rateText)
  );
  main.addEventListener("click", () => openSheet("staff", staff));
  top.append(main, el("span", "entry-amount", money(salary.amount)));

  const c = salary.counts;
  const breakdown = el("div", "salary-breakdown");
  [["Present", c.P], ["Half day", c.H], ["Absent", c.A], ["Leave", c.L]].forEach(([label, n]) => {
    const cell = el("div", "salary-stat");
    cell.append(el("span", "salary-stat-num", String(n)), el("span", "salary-stat-label", label));
    breakdown.appendChild(cell);
  });

  const daysText = staff.salaryType === "Daily" || staff.status === "Left"
    ? `${salary.paidDays} paid day(s)`
    : `${salary.paidDays} of ${salary.daysInMonth} days paid`;
  const footer = el("div", "salary-footer");
  footer.appendChild(el("span", "salary-status", paid > 0 ? `${daysText} · Paid ${money(paid)}` : daysText));

  const due = salary.amount - paid;
  if (due > 0) {
    const payBtn = el("button", "pay-btn", paid > 0 ? `Pay ${money(due)} more` : `Pay ${money(due)}`);
    payBtn.type = "button";
    payBtn.addEventListener("click", async () => {
      if (!confirm(`Record ${money(due)} salary paid to ${staff.name} for ${monthName}? It will be added to Expenses under "Salaries".`)) return;
      payBtn.disabled = true;
      await DB.add("expenses", {
        date: todayISO(),
        category: "Salaries",
        description: `Salary – ${staff.name} (${monthName})`,
        amount: due,
        staffId: staff.id,
        salaryMonth
      });
      refreshAll();
    });
    footer.appendChild(payBtn);
  } else if (salary.amount > 0) {
    footer.appendChild(el("span", "paid-badge", "Paid ✓"));
  }

  li.append(top, breakdown, footer);
  return li;
}

async function renderStaff() {
  const day = new Date(staffDate + "T00:00:00");
  $("#dayLabel").textContent = day.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  $("#dayPicker").value = staffDate;
  const monthStart = new Date(day.getFullYear(), day.getMonth(), 1);
  const key = monthKey(monthStart);
  const monthName = monthLabel(monthStart);
  $("#salaryTitle").textContent = `Salary — ${monthName}`;

  const [staff, attendance, expenses] = await Promise.all([DB.getAll("staff"), DB.getAll("attendance"), DB.getAll("expenses")]);
  staff.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  // Attendance: active staff who had joined by this day.
  const marksToday = Object.fromEntries(attendance.filter((a) => a.date === staffDate).map((a) => [a.staffId, a]));
  const markable = staff.filter((s) => s.status !== "Left" && (!s.joinDate || s.joinDate <= staffDate));
  const attList = $("#attendanceList");
  attList.innerHTML = "";
  markable.forEach((s) => attList.appendChild(buildAttendanceItem(s, marksToday[s.id])));
  $("#staffEmpty").hidden = markable.length > 0;
  $("#staffEmpty").textContent = staff.length
    ? "No active staff on this date."
    : "No staff added yet. Tap + to add your first staff member.";

  // Salary payments are expenses tagged with staffId + salaryMonth by the Pay button.
  const paidByStaff = {};
  expenses
    .filter((e) => e.staffId && e.salaryMonth === key)
    .forEach((e) => { paidByStaff[e.staffId] = (paidByStaff[e.staffId] || 0) + (Number(e.amount) || 0); });

  let total = 0, totalDue = 0;
  const salList = $("#salaryList");
  salList.innerHTML = "";
  staff.forEach((s) => {
    const salary = calcSalary(s, attendance, monthStart);
    const paid = paidByStaff[s.id] || 0;
    // Skip people with nothing to show this month (not joined yet, or left with no marks).
    if (salary.amount === 0 && paid === 0 && (s.status === "Left" || salary.workDays === 0)) return;
    total += salary.amount;
    totalDue += Math.max(0, salary.amount - paid);
    salList.appendChild(buildSalaryItem(s, salary, paid, monthName, key));
  });
  $("#salaryTotal").textContent = money(total);
  $("#salaryDue").textContent = money(totalDue);
}

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
