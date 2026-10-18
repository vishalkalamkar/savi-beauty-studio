/* shop.js — Shop tab: items sold over the counter (hair clips, hair bands, nose
   pins …) and items given on rent, with their stock, sales, rentals and the
   revenue they bring in.

   Kept apart from app.js on purpose: it has its own Firestore collections
   (products, productSales, rentals), its own add/edit sheet and its own + button.
   It only borrows app.js helpers ($, el, money, monthKey, DB, toCSV …) and the
   month selected on the other tabs (currentMonth). */

let shopMode = "sales"; // Shop tab: "sales", "rentals" or "products"
let shopEditing = null; // { kind, record, ctx } while the shop sheet is open

const LOW_STOCK_AT = 2;
const SHOP_PAYMENT_MODES = ["Cash", "Card", "UPI", "Other"];
const SHOP_CATEGORY_SUGGESTIONS = [
  "Hair clips", "Hair bands", "Nose pins", "Earrings", "Bangles",
  "Necklace sets", "Bridal jewellery", "Lehenga / saree", "Cosmetics", "Other"
];

const num = (v) => Number(v) || 0;
const isOut = (rental) => rental.status !== "Returned";
const findProduct = (ctx, id) => ctx.products.find((p) => p.id === id);
const newestBy = (key) => (a, b) => (b[key] || "").localeCompare(a[key] || "") || (b.createdAt || 0) - (a.createdAt || 0);
const saleAmount = (s) => num(s.amount);
// Late / damage charges are earned on the day the item comes back.
const rentalAmount = (r) => num(r.rentAmount) + (isOut(r) ? 0 : num(r.extraCharges));

/* ---------------- data ---------------- */

async function loadShopData() {
  const [products, sales, rentals] = await Promise.all([
    DB.getAll("products"), DB.getAll("productSales"), DB.getAll("rentals")
  ]);
  const sold = {}, out = {};
  sales.forEach((s) => { sold[s.productId] = (sold[s.productId] || 0) + num(s.qty); });
  rentals.filter(isOut).forEach((r) => { out[r.productId] = (out[r.productId] || 0) + num(r.qty); });
  return { products, sales, rentals, sold, out };
}

/* Stock isn't kept as a running count. Each product stores stockIn (units
   received, for sale items; units owned, for rent items) and what's available
   is worked out from sales and open rentals, so editing or deleting a sale or
   rental puts stock right by itself. */
function availableQty(p, data) {
  const stockIn = num(p.stockIn);
  return p.type === "Rent" ? stockIn - (data.out[p.id] || 0) : stockIn - (data.sold[p.id] || 0);
}

// Active items of one type for the sale/rental pickers, plus the one already on the record.
function productOptions(ctx, type) {
  const currentId = ctx.record && ctx.record.productId;
  const opts = ctx.products
    .filter((p) => (p.type || "Sale") === type && (p.status !== "Discontinued" || p.id === currentId))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .map((p) => [p.id, `${p.name} — ${money(p.price)}`]);
  if (currentId && !opts.some(([id]) => id === currentId)) {
    opts.unshift([currentId, `${ctx.record.productName || "Item"} (deleted)`]);
  }
  return opts;
}

/* ---------------- record types ---------------- */

const PRODUCT_FIELDS = [
  { key: "name", label: "Item name", type: "text", required: true, placeholder: "e.g. Pearl hair clip" },
  { key: "type", label: "Sell or rent?", type: "select", options: [["Sale", "For sale"], ["Rent", "For rent"]] },
  { key: "category", label: "Category", type: "text", list: "shopCategoryList", placeholder: "e.g. Hair clips" },
  { key: "price", label: (v) => (v.type === "Rent" ? "Rent per booking (Rs.)" : "Selling price (Rs.)"),
    type: "number", required: true, step: "0.01", min: "0" },
  { key: "deposit", label: "Security deposit per unit (Rs.)", type: "number", step: "0.01", min: "0",
    placeholder: "Optional", showIf: (v) => v.type === "Rent" },
  { key: "costPrice", label: "Your purchase cost per unit (Rs.)", type: "number", step: "0.01", min: "0",
    placeholder: "Optional — used to work out profit" },
  { key: "stock", label: (v) => (v.type === "Rent" ? "Units you own" : "Quantity in stock now"),
    type: "number", required: true, step: "1", min: "0" },
  { key: "status", label: "Status", type: "select", options: ["Active", "Discontinued"] },
  { key: "notes", label: "Notes", type: "textarea", placeholder: "Optional" }
];

const SALE_FIELDS = [
  { key: "date", label: "Date", type: "date", required: true },
  { key: "productId", label: "Item", type: "select", required: true, options: (ctx) => productOptions(ctx, "Sale") },
  { key: "qty", label: "Quantity", type: "number", required: true, step: "1", min: "1" },
  { key: "unitPrice", label: "Price per unit (Rs.)", type: "number", required: true, step: "0.01", min: "0" },
  { key: "customerName", label: "Customer name", type: "text", placeholder: "Optional" },
  { key: "paymentMode", label: "Payment mode", type: "select", options: SHOP_PAYMENT_MODES },
  { key: "notes", label: "Notes", type: "textarea", placeholder: "Optional" }
];

const RENTAL_FIELDS = [
  { key: "productId", label: "Item", type: "select", required: true, options: (ctx) => productOptions(ctx, "Rent") },
  { key: "qty", label: "Quantity", type: "number", required: true, step: "1", min: "1" },
  { key: "customerName", label: "Customer name", type: "text", required: true, placeholder: "e.g. Anita Sharma" },
  { key: "phone", label: "Phone number", type: "tel", placeholder: "e.g. 9876543210" },
  { key: "rentDate", label: "Rented on", type: "date", required: true },
  { key: "dueDate", label: "Return by", type: "date" },
  { key: "rentAmount", label: "Rent charged (Rs.)", type: "number", required: true, step: "0.01", min: "0" },
  { key: "deposit", label: "Security deposit taken (Rs.)", type: "number", step: "0.01", min: "0" },
  { key: "paymentMode", label: "Payment mode", type: "select", options: SHOP_PAYMENT_MODES },
  { key: "status", label: "Status", type: "select", options: [["Out", "Out with customer"], ["Returned", "Returned"]],
    showIf: (v, ctx) => !!ctx.record },
  { key: "returnDate", label: "Returned on", type: "date", showIf: (v) => v.status === "Returned" },
  { key: "extraCharges", label: "Late / damage charges (Rs.)", type: "number", step: "0.01", min: "0",
    placeholder: "0", showIf: (v) => v.status === "Returned" },
  { key: "notes", label: "Notes", type: "textarea", placeholder: "Optional" }
];

/* Each kind of shop record:
   defaults    starting values for a new one
   toForm      stored record → form values
   onChange    fills related fields when one changes (e.g. price from the item)
   summary     line shown under the form
   toRecord    form values → stored record, or null to cancel the save */
const SHOP_KINDS = {
  products: {
    store: "products",
    singular: "item",
    fields: PRODUCT_FIELDS,
    defaults: () => ({ type: "Sale", status: "Active" }),
    toForm: (r, ctx) => ({ ...r, stock: r.type === "Rent" ? num(r.stockIn) : availableQty(r, ctx) }),
    summary: (v) => (v.type !== "Rent" && v.price && v.costPrice
      ? `Profit per unit sold: ${money(v.price - v.costPrice)}` : ""),
    toRecord(v, ctx) {
      const { stock, ...rec } = v;
      const id = ctx.record && ctx.record.id;
      rec.stockIn = rec.type === "Rent" ? stock : stock + (id ? ctx.sold[id] || 0 : 0);
      if (rec.type !== "Rent") rec.deposit = 0;
      return rec;
    }
  },

  sales: {
    store: "productSales",
    singular: "sale",
    fields: SALE_FIELDS,
    needsProducts: "Sale",
    defaults: () => ({ date: todayISO(), qty: 1, paymentMode: "Cash" }),
    onChange(key, v, ctx) {
      const p = findProduct(ctx, v.productId);
      if (key === "productId" && p) return { unitPrice: num(p.price) };
    },
    summary: (v) => `Total: ${money(v.qty * v.unitPrice)}`,
    toRecord(v, ctx) {
      const p = findProduct(ctx, v.productId);
      const old = ctx.record;
      const sameItem = old && old.productId === v.productId;
      if (p) {
        const avail = availableQty(p, ctx) + (sameItem ? num(old.qty) : 0);
        if (v.qty > avail && !confirm(`Only ${Math.max(0, avail)} of ${p.name} left in stock. Save this sale anyway?`)) return null;
      }
      // Cost is fixed at the time of sale, so later price changes don't rewrite old profit.
      const unitCost = sameItem && old.unitCost !== undefined ? num(old.unitCost) : num(p && p.costPrice);
      return {
        ...v,
        productName: p ? p.name : (old && old.productName) || "",
        amount: v.qty * v.unitPrice,
        unitCost,
        costAmount: v.qty * unitCost
      };
    }
  },

  rentals: {
    store: "rentals",
    singular: "rental",
    fields: RENTAL_FIELDS,
    needsProducts: "Rent",
    defaults: () => ({ rentDate: todayISO(), qty: 1, status: "Out", paymentMode: "Cash" }),
    onChange(key, v, ctx) {
      const p = findProduct(ctx, v.productId);
      if ((key === "productId" || key === "qty") && p) {
        const qty = v.qty || 1;
        return { rentAmount: num(p.price) * qty, deposit: num(p.deposit) * qty };
      }
      if (key === "status" && v.status === "Returned" && !v.returnDate) return { returnDate: todayISO() };
    },
    summary(v) {
      if (v.status !== "Returned") {
        return `Collect now: ${money(v.rentAmount + v.deposit)} (rent ${money(v.rentAmount)} + deposit ${money(v.deposit)})`;
      }
      const refund = v.deposit - v.extraCharges;
      return refund >= 0 ? `Deposit to give back: ${money(refund)}` : `Customer still owes: ${money(-refund)}`;
    },
    toRecord(v, ctx) {
      const p = findProduct(ctx, v.productId);
      const old = ctx.record;
      if (v.status === "Returned") {
        if (!v.returnDate) v.returnDate = todayISO();
      } else {
        v.status = "Out";
        v.returnDate = "";
        v.extraCharges = 0;
        if (p) {
          const avail = availableQty(p, ctx) + (old && isOut(old) && old.productId === p.id ? num(old.qty) : 0);
          if (v.qty > avail && !confirm(`Only ${Math.max(0, avail)} of ${p.name} free right now. Save this rental anyway?`)) return null;
        }
      }
      return { ...v, productName: p ? p.name : (old && old.productName) || "" };
    }
  }
};

/* ---------------- add / edit sheet ---------------- */

const shopOverlay = $("#shopSheetOverlay");
const shopForm = $("#shopSheetForm");
const shopTotal = $("#shopSheetTotal");
const shopDelete = $("#shopSheetDelete");

function ensureCategoryList(products) {
  let list = document.getElementById("shopCategoryList");
  if (!list) {
    list = document.createElement("datalist");
    list.id = "shopCategoryList";
    document.body.appendChild(list);
  }
  const cats = new Set([...products.map((p) => (p.category || "").trim()).filter(Boolean), ...SHOP_CATEGORY_SUGGESTIONS]);
  list.innerHTML = "";
  cats.forEach((c) => {
    const o = document.createElement("option");
    o.value = c;
    list.appendChild(o);
  });
}

function buildShopFields(fields, values, ctx) {
  shopForm.innerHTML = "";
  fields.forEach((f) => {
    const wrap = el("div", "field");
    const label = el("label");
    label.htmlFor = "sf_" + f.key;

    let input;
    if (f.type === "select") {
      input = document.createElement("select");
      const opts = typeof f.options === "function" ? f.options(ctx) : f.options;
      opts.forEach((opt) => {
        const [value, text] = Array.isArray(opt) ? opt : [opt, opt];
        const o = el("option", "", text);
        o.value = value;
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
      if (f.list) input.setAttribute("list", f.list);
    }
    input.id = "sf_" + f.key;
    input.name = f.key;

    const val = values[f.key];
    if (val !== undefined && val !== null && val !== "") input.value = val;

    wrap.append(label, input);
    shopForm.appendChild(wrap);
  });
}

function readShopForm(kind) {
  const values = {};
  SHOP_KINDS[kind].fields.forEach((f) => {
    const input = $("#sf_" + f.key, shopForm);
    values[f.key] = f.type === "number" ? num(input.value) : input.value.trim();
  });
  return values;
}

function applyShopPatch(patch) {
  Object.entries(patch || {}).forEach(([key, value]) => {
    const input = $("#sf_" + key, shopForm);
    if (input) input.value = value;
  });
}

// Updates labels, shown/hidden fields and the summary line to match the current values.
function syncShopForm() {
  const { kind, ctx } = shopEditing;
  const cfg = SHOP_KINDS[kind];
  const v = readShopForm(kind);
  cfg.fields.forEach((f) => {
    const input = $("#sf_" + f.key, shopForm);
    const wrap = input.closest(".field");
    const visible = !f.showIf || f.showIf(v, ctx);
    wrap.hidden = !visible;
    input.required = !!f.required && visible; // hidden required inputs would block saving
    $("label", wrap).textContent = typeof f.label === "function" ? f.label(v) : f.label;
  });
  const text = cfg.summary ? cfg.summary(v, ctx) : "";
  shopTotal.hidden = !text;
  shopTotal.textContent = text;
}

// prefill: values laid over the record or defaults, e.g. { status: "Returned" } from the Return button.
async function openShopSheet(kind, record = null, prefill = {}, title = "") {
  const cfg = SHOP_KINDS[kind];
  const ctx = { ...(await loadShopData()), record };

  if (cfg.needsProducts && !record && !productOptions(ctx, cfg.needsProducts).length) {
    const what = cfg.needsProducts === "Rent" ? "for rent" : "for sale";
    if (confirm(`You haven't added any items ${what} yet. Add one now?`)) {
      openShopSheet("products", null, { type: cfg.needsProducts });
    }
    return;
  }

  shopEditing = { kind, record, ctx };
  ensureCategoryList(ctx.products);
  $("#shopSheetTitle").textContent = title || (record ? `Edit ${cfg.singular}` : `Add ${cfg.singular}`);
  const base = record ? (cfg.toForm ? cfg.toForm(record, ctx) : record) : cfg.defaults();
  buildShopFields(cfg.fields, { ...base, ...prefill }, ctx);
  if (!record && cfg.onChange) applyShopPatch(cfg.onChange("productId", readShopForm(kind), ctx));
  syncShopForm();

  shopDelete.hidden = !record;
  shopOverlay.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeShopSheet() {
  shopOverlay.hidden = true;
  document.body.style.overflow = "";
  shopEditing = null;
}

shopOverlay.addEventListener("click", (e) => {
  if (e.target === shopOverlay) closeShopSheet();
});

shopForm.addEventListener("input", (e) => {
  if (!shopEditing) return;
  const { kind, ctx } = shopEditing;
  const cfg = SHOP_KINDS[kind];
  if (cfg.onChange) applyShopPatch(cfg.onChange(e.target.name, readShopForm(kind), ctx));
  syncShopForm();
});

shopForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!shopEditing) return;
  const { kind, record, ctx } = shopEditing;
  const cfg = SHOP_KINDS[kind];
  const rec = cfg.toRecord(readShopForm(kind), ctx);
  if (!rec) return;
  if (record) await DB.put(cfg.store, { id: record.id, ...rec });
  else await DB.add(cfg.store, rec);
  closeShopSheet();
  renderShop();
});

shopDelete.addEventListener("click", async () => {
  if (!shopEditing || !shopEditing.record) return;
  const { kind, record } = shopEditing;
  const message = {
    products: "Delete this item? Its past sales and rentals are kept. Tip: set Status to \"Discontinued\" instead to hide it from new sales.",
    sales: "Delete this sale? The quantity goes back into stock.",
    rentals: "Delete this rental? This cannot be undone."
  }[kind];
  if (!confirm(message)) return;
  await DB.delete(SHOP_KINDS[kind].store, record.id);
  closeShopSheet();
  renderShop();
});

/* ---------------- shop tab ---------------- */

const shopView = $("#view-shop");
const shopFab = $("#shopFab");

function statCard(label, value, { mod = "", big = false, sub = "" } = {}) {
  const card = el("div", "stat-card" + (mod ? " " + mod : ""));
  card.append(el("span", "stat-label", label), el("span", "stat-value" + (big ? " stat-value--big" : ""), value));
  if (sub) card.appendChild(el("span", "stat-sub", sub));
  return card;
}

function shopEntry(title, sub, amount, onClick, { subClass = "", itemClass = "", action = null } = {}) {
  const li = el("li", "entry-item" + (itemClass ? " " + itemClass : ""));
  const main = el("div", "entry-main");
  main.append(el("span", "entry-title", title), el("span", "entry-sub" + (subClass ? " " + subClass : ""), sub));
  const side = el("div", "shop-side");
  side.appendChild(el("span", "entry-amount", amount));
  if (action) side.appendChild(action);
  li.append(main, side);
  li.addEventListener("click", onClick);
  return li;
}

// Records (already sorted newest first) as day groups, like the Customers and Expenses tabs.
function shopDayGroups(records, dateKey, word, amountOf, buildItem) {
  const list = el("ul", "group-list");
  const groups = new Map();
  records.forEach((r) => {
    const key = r[dateKey] || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  groups.forEach((items, date) => {
    const group = el("li", "day-group");
    const header = el("div", "day-header");
    header.append(
      el("span", "day-header-title", dayHeading(date)),
      el("span", "day-header-meta", `${plural(items.length, word)} · ${money(items.reduce((s, r) => s + amountOf(r), 0))}`)
    );
    const ul = el("ul", "entry-list");
    items.forEach((r) => ul.appendChild(buildItem(r)));
    group.append(header, ul);
    list.appendChild(group);
  });
  return list;
}

function monthTotals(data, key) {
  const sales = data.sales.filter((s) => s.date && s.date.startsWith(key));
  const salesRevenue = sales.reduce((s, r) => s + saleAmount(r), 0);
  const salesCost = sales.reduce((s, r) => s + num(r.costAmount), 0);
  const itemsSold = sales.reduce((s, r) => s + num(r.qty), 0);
  let rentalIncome = 0, bookings = 0;
  data.rentals.forEach((r) => {
    if (r.rentDate && r.rentDate.startsWith(key)) { rentalIncome += num(r.rentAmount); bookings++; }
    if (!isOut(r) && r.returnDate && r.returnDate.startsWith(key)) rentalIncome += num(r.extraCharges);
  });
  return { salesRevenue, salesCost, itemsSold, rentalIncome, bookings };
}

function renderShopStats(data) {
  const stats = $("#shopStats");
  stats.innerHTML = "";

  if (shopMode === "products") {
    let saleUnits = 0, saleItems = 0, rentUnits = 0, rentOut = 0, stockValue = 0, low = 0;
    data.products.filter((p) => p.status !== "Discontinued").forEach((p) => {
      const avail = Math.max(0, availableQty(p, data));
      if (p.type === "Rent") {
        rentUnits += num(p.stockIn);
        rentOut += data.out[p.id] || 0;
      } else {
        saleItems++;
        saleUnits += avail;
        stockValue += avail * num(p.costPrice);
        if (avail <= LOW_STOCK_AT) low++;
      }
    });
    stats.append(
      statCard("Units for sale", String(saleUnits), { sub: plural(saleItems, "item") }),
      statCard("Units for rent", String(rentUnits), { sub: `${rentOut} out now` }),
      statCard("Stock value (at your cost)", money(stockValue), {
        mod: "stat-card--wide", big: true,
        sub: low ? `${plural(low, "item")} low on stock` : "Unsold stock for sale, at purchase cost"
      })
    );
    return;
  }

  const t = monthTotals(data, monthKey(currentMonth));
  const salesProfit = t.salesRevenue - t.salesCost;
  stats.append(
    statCard("Sales", money(t.salesRevenue), { mod: "stat-card--revenue", sub: `${plural(t.itemsSold, "item")} sold` }),
    statCard("Rentals", money(t.rentalIncome), { mod: "stat-card--revenue", sub: plural(t.bookings, "booking") }),
    statCard("Shop revenue", money(t.salesRevenue + t.rentalIncome), {
      mod: "stat-card--wide stat-card--revenue", big: true,
      sub: t.salesCost > 0 ? `${money(salesProfit)} profit on items sold, after their cost` : ""
    })
  );
}

function saleItem(s) {
  const sub = [`${num(s.qty)} × ${money(s.unitPrice)}`, s.customerName, s.paymentMode].filter(Boolean).join(" · ");
  return shopEntry(s.productName || "Item", sub, money(s.amount), () => openShopSheet("sales", s));
}

function rentalItem(r) {
  const today = todayISO();
  const what = num(r.qty) > 1 ? `${num(r.qty)} × ${r.productName || "Item"}` : r.productName || "Item";
  let status, subClass = "", action = null;
  if (!isOut(r)) {
    status = `Returned ${displayDate(r.returnDate)}`;
  } else {
    if (r.dueDate && r.dueDate < today) {
      status = `Overdue · was due ${displayDate(r.dueDate)}`;
      subClass = "shop-sub--alert";
    } else {
      status = r.dueDate ? `Due ${displayDate(r.dueDate)}` : "Out";
    }
    action = el("button", "pay-btn shop-return-btn", "Returned");
    action.type = "button";
    action.addEventListener("click", (e) => {
      e.stopPropagation();
      openShopSheet("rentals", r, { status: "Returned", returnDate: todayISO() }, "Mark as returned");
    });
  }
  return shopEntry(r.customerName || "Customer", `${what} · ${status}`, money(rentalAmount(r)),
    () => openShopSheet("rentals", r), { subClass, action });
}

function productItem(p, data) {
  const avail = availableQty(p, data);
  const inactive = p.status === "Discontinued";
  let stockText, alert = false;
  if (inactive) {
    stockText = "Discontinued";
  } else if (p.type === "Rent") {
    stockText = `${Math.max(0, avail)} of ${num(p.stockIn)} free`;
    alert = avail <= 0;
  } else {
    stockText = avail <= 0 ? "Out of stock" : avail <= LOW_STOCK_AT ? `Only ${avail} left` : `${avail} in stock`;
    alert = avail <= LOW_STOCK_AT;
  }
  const sub = [p.category, stockText].filter(Boolean).join(" · ");
  return shopEntry(p.name || "Item", sub, money(p.price), () => openShopSheet("products", p), {
    subClass: alert ? "shop-sub--alert" : "",
    itemClass: inactive ? "shop-item--inactive" : ""
  });
}

const matchesQuery = (q, ...texts) => texts.some((t) => (t || "").toLowerCase().includes(q));

function renderShopSales(data, q, content) {
  const key = monthKey(currentMonth);
  const sales = data.sales
    .filter((s) => (q ? matchesQuery(q, s.productName, s.customerName) : s.date && s.date.startsWith(key)))
    .sort(newestBy("date"));
  content.appendChild(shopDayGroups(sales, "date", "sale", saleAmount, saleItem));
  const total = money(sales.reduce((s, r) => s + saleAmount(r), 0));
  return {
    summary: !data.sales.length ? "" : q
      ? `${plural(sales.length, "match", "matches")} across all months · ${total}`
      : `${plural(sales.length, "sale")} · ${total}`,
    empty: sales.length ? ""
      : !data.sales.length ? "No sales yet. Tap + to log an item sold."
      : q ? "No matching sales found." : `No sales in ${monthLabel(currentMonth)}.`
  };
}

function renderShopRentals(data, q, content) {
  if (!data.rentals.length) {
    return { summary: "", empty: "No rentals yet. Tap + to log an item given on rent." };
  }

  if (q) {
    const found = data.rentals.filter((r) => matchesQuery(q, r.customerName, r.productName, r.phone)).sort(newestBy("rentDate"));
    content.appendChild(shopDayGroups(found, "rentDate", "rental", rentalAmount, rentalItem));
    return {
      summary: `${plural(found.length, "match", "matches")} across all months`,
      empty: found.length ? "" : "No matching rentals found."
    };
  }

  const today = todayISO();
  const out = data.rentals.filter(isOut)
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  const overdue = out.filter((r) => r.dueDate && r.dueDate < today).length;
  const deposits = out.reduce((s, r) => s + num(r.deposit), 0);

  if (out.length) {
    content.appendChild(el("h2", "section-title", "Out with customers"));
    const ul = el("ul", "entry-list");
    out.forEach((r) => ul.appendChild(rentalItem(r)));
    content.appendChild(ul);
  }

  const key = monthKey(currentMonth);
  const month = data.rentals.filter((r) => r.rentDate && r.rentDate.startsWith(key)).sort(newestBy("rentDate"));
  content.appendChild(el("h2", "section-title", `Rented in ${monthLabel(currentMonth)}`));
  if (month.length) content.appendChild(shopDayGroups(month, "rentDate", "rental", rentalAmount, rentalItem));
  else content.appendChild(el("p", "empty-hint shop-empty-inline", `No rentals in ${monthLabel(currentMonth)}.`));

  const parts = [`${out.length} out now`];
  if (overdue) parts.push(`${overdue} overdue`);
  if (deposits) parts.push(`${money(deposits)} deposits held`);
  return { summary: parts.join(" · "), empty: "" };
}

function renderShopProducts(data, q, content) {
  if (!data.products.length) {
    return { summary: "", empty: "No items yet. Tap + to add things you sell (hair clips, nose pins …) or give on rent." };
  }
  const found = data.products.filter((p) => !q || matchesQuery(q, p.name, p.category));
  [["Sale", "For sale"], ["Rent", "For rent"]].forEach(([type, title]) => {
    const items = found
      .filter((p) => (p.type || "Sale") === type)
      .sort((a, b) => (a.status === "Discontinued") - (b.status === "Discontinued") || (a.name || "").localeCompare(b.name || ""));
    if (!items.length) return;
    content.appendChild(el("h2", "section-title", title));
    const ul = el("ul", "entry-list");
    items.forEach((p) => ul.appendChild(productItem(p, data)));
    content.appendChild(ul);
  });
  return {
    summary: q ? plural(found.length, "match", "matches") : plural(data.products.length, "item"),
    empty: found.length ? "" : "No matching items found."
  };
}

async function renderShop() {
  $$("[data-shop-mode]").forEach((b) => b.classList.toggle("is-active", b.dataset.shopMode === shopMode));
  $("#shopMonthSwitch").hidden = shopMode === "products";
  $("#shopMonthLabel").textContent = monthLabel(currentMonth);
  $("#shopSearch").placeholder = {
    sales: "Search by item or customer",
    rentals: "Search by customer, item or phone",
    products: "Search by item or category"
  }[shopMode];

  const data = await loadShopData();
  const q = $("#shopSearch").value.trim().toLowerCase();
  renderShopStats(data);

  const content = $("#shopContent");
  content.innerHTML = "";
  const render = { sales: renderShopSales, rentals: renderShopRentals, products: renderShopProducts }[shopMode];
  const { summary, empty } = render(data, q, content);
  $("#shopSummary").textContent = summary;
  showEmpty($("#shopEmpty"), empty);
}

$$("[data-shop-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    shopMode = btn.dataset.shopMode;
    renderShop();
  });
});

// Same selected month as Overview, Customers and Expenses.
$$("[data-shop-month-step]").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + Number(btn.dataset.shopMonthStep), 1);
    renderShop();
  });
});

$("#shopSearch").addEventListener("input", renderShop);
shopFab.addEventListener("click", () => openShopSheet(shopMode));

/* app.js's setView() shows and hides views via their hidden attribute; follow
   that so the Shop tab renders and shows its own + button without app.js
   having to know about it. */
new MutationObserver(() => {
  const visible = !shopView.hidden;
  shopFab.hidden = !visible;
  if (visible) renderShop();
}).observe(shopView, { attributes: true, attributeFilter: ["hidden"] });

/* ---------------- CSV export ---------------- */

const SHOP_EXPORTS = {
  products: {
    file: "shop-items",
    columns: ["name", "type", "category", "price", "costPrice", "deposit", "inStock", "status", "notes"],
    rows: (data) => data.products.map((p) => ({ ...p, inStock: availableQty(p, data) }))
  },
  productSales: {
    file: "shop-sales",
    columns: ["date", "productName", "qty", "unitPrice", "amount", "unitCost", "costAmount", "customerName", "paymentMode", "notes"],
    rows: (data) => [...data.sales].sort((a, b) => (a.date || "").localeCompare(b.date || ""))
  },
  rentals: {
    file: "shop-rentals",
    columns: ["rentDate", "dueDate", "productName", "qty", "customerName", "phone", "rentAmount", "deposit",
      "paymentMode", "status", "returnDate", "extraCharges", "notes"],
    rows: (data) => [...data.rentals].sort((a, b) => (a.rentDate || "").localeCompare(b.rentDate || ""))
  }
};

$$("[data-shop-export]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const exp = SHOP_EXPORTS[btn.dataset.shopExport];
    const data = await loadShopData();
    downloadFile(`${exp.file}-${todayISO()}.csv`, toCSV(exp.rows(data), exp.columns));
  });
});
