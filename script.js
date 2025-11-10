/* =========================================
   L'Oréal Routine Builder – Frontend Logic
   Beginner-friendly: clear sections & comments
========================================= */

/* --- Constants & DOM references --- */
const WORKER_URL = "https://lorealchatbot.cuadra33.workers.dev/"; // Cloudflare Worker (all AI calls go here)

const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const selectedList = document.getElementById("selectedProductsList");
const clearSelectedBtn = document.getElementById("clearSelected");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const generateBtn = document.getElementById("generateRoutine");
const sendBtn = document.getElementById("sendBtn");

/* --- State --- */
const LS_KEY = "selectedProducts:v1";
let allProducts = [];
let selectedIds = new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]"));
let messages = []; // Chat history
let pendingBubble = null; // Loading bubble reference
let generating = false; // Debounce Generate routine
let wired = false; // Prevent duplicate handlers

/* --- Category mapping (filter dropdown -> product categories) --- */
const CATEGORY_MAP = {
  cleanser: ["cleanser"],
  moisturizer: ["moisturizer", "skincare"],
  haircare: ["haircare"],
  makeup: ["makeup"],
  "hair color": ["hair color"],
  "hair styling": ["hair styling"],
  "men's grooming": ["men's grooming"],
  suncare: ["suncare", "skincare"],
  fragrance: ["fragrance"],
};

/* --- Utility: persist selection --- */
function persistSelection() {
  localStorage.setItem(LS_KEY, JSON.stringify(Array.from(selectedIds)));
}

/* --- Worker call (ONLY network call) --- */
async function callWorker(body) {
  try {
    const r = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = await r.text();
    let data = {};
    try {
      data = JSON.parse(raw);
    } catch {}
    if (!r.ok) {
      return data?.text?.trim() || data?.error || `Worker error ${r.status}`;
    }
    const t = typeof data?.text === "string" ? data.text.trim() : "";
    if (t) return t;

    // Fallback extraction (Responses / Completions shapes)
    if (typeof data?.output_text === "string" && data.output_text.trim())
      return data.output_text.trim();
    const cc = data?.choices?.[0]?.message?.content;
    if (typeof cc === "string" && cc.trim()) return cc.trim();
    try {
      const items = Array.isArray(data?.output) ? data.output : [];
      for (const it of items) {
        const cs = Array.isArray(it?.content) ? it.content : [];
        for (const c of cs) {
          if (
            c?.type === "output_text" &&
            typeof c?.text === "string" &&
            c.text.trim()
          ) {
            return c.text.trim();
          }
        }
      }
    } catch {}
    return "I couldn’t generate that. Please try again.";
  } catch {
    return "Network error contacting Worker.";
  }
}

/* --- Simple Markdown -> HTML (safe subset) --- */
function escapeHtml(s) {
  return s.replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        m
      ])
  );
}
function mdToHtml(md) {
  let h = escapeHtml(md || "");
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/\*(.+?)\*/g, "<em>$1</em>");
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Simple paragraphs & line breaks
  h = h.replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");
  // Convert simple source list
  if (/Sources:\n/.test(md)) {
    const parts = md.split(/Sources:\n/);
    const main = parts[0];
    const rest = parts[1];
    const lines = rest
      .split(/\n/)
      .filter((l) => /^-\s+https?:\/\//.test(l.trim()));
    if (lines.length) {
      const list =
        "<ul>" +
        lines
          .map((l) => {
            const url = escapeHtml(l.trim().replace(/^-\s+/, ""));
            return `<li><a href="${url}" target="_blank" rel="noopener">${url}</a></li>`;
          })
          .join("") +
        "</ul>";
      h =
        mdToHtml(main).replace(/^<p>|<\/p>$/g, "") + "<h4>Sources</h4>" + list;
      return `<p>${h}</p>`;
    }
  }
  return `<p>${h}</p>`;
}

/* --- Chat bubble helpers --- */
function setBusy(on) {
  if (generateBtn) generateBtn.disabled = on;
  if (sendBtn) sendBtn.disabled = on;
}
function animateBubble(el) {
  el.classList.remove("animate-in");
  void el.offsetWidth; // reflow
  el.classList.add("animate-in");
}
function showPending() {
  if (pendingBubble) return;
  pendingBubble = document.createElement("div");
  pendingBubble.className = "chat-bubble assistant loading";
  pendingBubble.innerText = "Working…";
  chatWindow.appendChild(pendingBubble);
  animateBubble(pendingBubble);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  setBusy(true);
}
function resolvePending(text) {
  if (pendingBubble) {
    pendingBubble.innerHTML = mdToHtml(text || "No response.");
    pendingBubble.classList.remove("loading");
    animateBubble(pendingBubble);
    pendingBubble = null;
  }
  messages.push({ role: "assistant", content: text || "No response." });
  setBusy(false);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}
function addChat(role, content, allowHtml = false) {
  messages.push({ role, content });
  const div = document.createElement("div");
  div.className = `chat-bubble ${role === "user" ? "user" : "assistant"}`;
  if (allowHtml && role === "assistant") {
    div.innerHTML = mdToHtml(content);
  } else {
    div.innerText = content;
  }
  chatWindow.appendChild(div);
  animateBubble(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* --- Product rendering --- */
function displayProducts(products) {
  productsContainer.innerHTML = products
    .map((p) => {
      const sel = selectedIds.has(p.id);
      return `
      <div class="product-card ${sel ? "selected" : ""}" data-id="${p.id}">
        <img src="${p.image}" alt="${p.name}">
        <div class="product-info">
          <h3>${p.name}</h3>
          <p>${p.brand}</p>
          <small><button class="details-link more" data-id="${
            p.id
          }" type="button">Details</button></small>
          <div class="desc" id="desc-${
            p.id
          }" style="display:none;">${escapeHtml(p.description || "")}</div>
        </div>
      </div>`;
    })
    .join("");

  // Card click -> select/unselect
  productsContainer.querySelectorAll(".product-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".more")) return;
      const id = Number(card.dataset.id);
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      persistSelection();
      card.classList.toggle("selected");
      renderSelectedList();
    });
  });

  // Details toggle
  productsContainer.querySelectorAll(".more").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const panel = document.getElementById(`desc-${btn.dataset.id}`);
      if (panel)
        panel.style.display = panel.style.display === "none" ? "block" : "none";
    });
  });
}

/* --- Selected chips --- */
function renderSelectedList() {
  const items = Array.from(selectedIds)
    .map((id) => allProducts.find((p) => p.id === id))
    .filter(Boolean)
    .map(
      (p) =>
        `<span class="chip">${escapeHtml(
          p.name
        )}<button aria-label="Remove" data-id="${p.id}">&times;</button></span>`
    )
    .join("");
  selectedList.innerHTML =
    items || `<span class="placeholder-message">No products selected</span>`;
  selectedList.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedIds.delete(Number(btn.dataset.id));
      persistSelection();
      if (categoryFilter.value) filterAndRender(categoryFilter.value);
      renderSelectedList();
    });
  });
}

/* --- Filtering --- */
function filterAndRender(value) {
  const cats = CATEGORY_MAP[value] || [value];
  const filtered = allProducts.filter((p) => cats.includes(p.category));
  displayProducts(filtered);
}

/* --- Chat submit handler --- */
function handleChatSubmit(e) {
  e.preventDefault();
  const input = new FormData(chatForm).get("userInput")?.toString().trim();
  if (!input) return;
  chatForm.reset();
  addChat("user", input);

  showPending();
  callWorker({
    messages: [
      {
        role: "system",
        content:
          "You are L’Oréal Care Guide. On-topic only. Output 3–5 sentences: Considerations then Conclusion. On-label claims only. Refuse off-topic.",
      },
      ...messages,
    ],
  })
    .then(resolvePending)
    .catch(() => resolvePending("Error contacting Worker."));
}

/* --- Generate routine handler --- */
async function onGenerateRoutine() {
  if (generating) return;
  generating = true;
  try {
    const sel = Array.from(selectedIds)
      .slice(0, 10)
      .map((id) => allProducts.find((p) => p.id === id))
      .filter(Boolean);
    if (!sel.length) {
      addChat("assistant", "Select at least one product to build a routine.");
      generating = false;
      return;
    }
    addChat("user", "Generate a routine from my selected products.");

    const prompt = `Using only these products, build a simple morning/evening routine. If a step is missing, note it briefly.
Format:
Considerations: key factors from categories/concerns
Conclusion: ordered steps with exact product names and a one-sentence usage tip per step`;
    const selectedJson = JSON.stringify(sel).slice(0, 8000);
    const fullUser = `${prompt}\n\nSelected products JSON:\n${selectedJson}`;

    // Replace last user message with full prompt (single user turn)
    if (messages.length && messages[messages.length - 1].role === "user") {
      messages[messages.length - 1] = { role: "user", content: fullUser };
    } else {
      messages.push({ role: "user", content: fullUser });
    }

    showPending();
    const text = await callWorker({
      messages: [
        {
          role: "system",
          content:
            "You are L’Oréal Care Guide. On-topic only. Output 3–5 sentences: Considerations then Conclusion. On-label claims only. Refuse off-topic.",
        },
        ...messages,
      ],
    });
    resolvePending(text);
  } catch {
    resolvePending("Error generating routine.");
  } finally {
    generating = false;
  }
}

/* --- Clear selected products --- */
function clearSelection() {
  selectedIds = new Set();
  persistSelection();
  renderSelectedList();
  if (categoryFilter.value) filterAndRender(categoryFilter.value);
}

/* --- Wire event handlers safely (idempotent) --- */
function wireHandlers() {
  if (wired) return;
  if (chatForm) chatForm.addEventListener("submit", handleChatSubmit);
  if (generateBtn) generateBtn.addEventListener("click", onGenerateRoutine);
  if (clearSelectedBtn)
    clearSelectedBtn.addEventListener("click", clearSelection);
  wired = true;
}

/* --- Init sequence --- */
async function init() {
  try {
    await loadProducts();
    renderSelectedList();
    if (categoryFilter) {
      categoryFilter.addEventListener("change", (e) =>
        filterAndRender(e.target.value)
      );
      if (categoryFilter.value) filterAndRender(categoryFilter.value);
      else
        productsContainer.innerHTML = `<div class="placeholder-message">Select a category to view products</div>`;
    }
    wireHandlers();
  } catch (err) {
    addChat("assistant", "Initialization error. Please reload.");
    console.error("Init failed:", err);
  }
}

/* --- Load products from JSON (simple) --- */
async function loadProducts() {
  const res = await fetch("products.json");
  const data = await res.json();
  allProducts = data.products || [];
}

/* --- Start app --- */
init();
document.addEventListener("DOMContentLoaded", wireHandlers);

/* =========================================
   END
========================================= */
