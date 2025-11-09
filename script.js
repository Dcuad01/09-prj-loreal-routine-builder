/* DOM refs */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const selectedList = document.getElementById("selectedProductsList");
const clearSelectedBtn = document.getElementById("clearSelected");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const lastQEl = document.getElementById("lastQuestion");
const generateBtn = document.getElementById("generateRoutine");

/* Config */
// Single source of truth for the Worker endpoint
const WORKER_URL = "https://lorealchatbot.cuadra33.workers.dev/";
const LS_KEY = "selectedProducts:v1";

/* State */
let allProducts = [];
let selectedIds = new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]"));
let messages = [];

/* Category map */
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

/* Init */
(async function init() {
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
  if (clearSelectedBtn)
    clearSelectedBtn.addEventListener("click", clearSelection);
  if (generateBtn) generateBtn.addEventListener("click", onGenerateRoutine);
  if (chatForm) {
    chatForm.addEventListener("submit", onChatSubmit);
    // Ensure chat form picks up existing .chat-form CSS styles
    chatForm.classList.add("chat-form");
  }
})();

/* Data */
async function loadProducts() {
  const res = await fetch("products.json");
  const data = await res.json();
  allProducts = data.products || [];
}

/* Filter */
async function filterAndRender(value) {
  const cats = CATEGORY_MAP[value] || [value];
  const filtered = allProducts.filter((p) => cats.includes(p.category));
  displayProducts(filtered);
}

/* Render products */
function displayProducts(products) {
  productsContainer.innerHTML = products
    .map((p) => {
      const isSel = selectedIds.has(p.id);
      return `
      <div class="product-card ${isSel ? "selected" : ""}" data-id="${p.id}">
        <img src="${p.image}" alt="${p.name}">
        <div class="product-info">
          <h3>${p.name}</h3>
          <p>${p.brand}</p>
          <small>
            <button class="more" data-id="${
              p.id
            }" type="button" aria-expanded="false">Details</button>
          </small>
        </div>
        <div class="product-desc" hidden>
          <p>${p.description || ""}</p>
        </div>
      </div>`;
    })
    .join("");

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

  // Toggle inline description instead of dumping into chat
  productsContainer.querySelectorAll(".more").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const card = btn.closest(".product-card");
      const desc = card?.querySelector(".product-desc");
      if (!desc) return;
      const isHidden = desc.hasAttribute("hidden");
      if (isHidden) {
        desc.removeAttribute("hidden");
        btn.textContent = "Hide";
        btn.setAttribute("aria-expanded", "true");
      } else {
        desc.setAttribute("hidden", "");
        btn.textContent = "Details";
        btn.setAttribute("aria-expanded", "false");
      }
    });
  });
}

/* Selected list */
function renderSelectedList() {
  if (!selectedList) return;
  const items = Array.from(selectedIds)
    .map((id) => allProducts.find((p) => p.id === id))
    .filter(Boolean)
    .map(
      (p) =>
        `<span class="chip">${p.name}<button aria-label="Remove" data-id="${p.id}">&times;</button></span>`
    )
    .join("");
  selectedList.innerHTML =
    items || `<span class="placeholder-message">No products selected</span>`;
  selectedList.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedIds.delete(Number(btn.dataset.id));
      persistSelection();
      const cur = categoryFilter.value;
      if (cur) filterAndRender(cur);
      renderSelectedList();
    });
  });
}

function persistSelection() {
  localStorage.setItem(LS_KEY, JSON.stringify(Array.from(selectedIds)));
}
function clearSelection() {
  selectedIds = new Set();
  persistSelection();
  renderSelectedList();
  const cur = categoryFilter.value;
  if (cur) filterAndRender(cur);
}

/* Utility to ensure we always display a string (prevents [object Object]) */
function ensureString(val) {
  if (typeof val === "string") return val;
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

/* Robust extractor: safely get assistant text from any Worker shape */
function extractAssistantText(data) {
  // 1) Our Worker preferred shape
  if (typeof data?.text === "string" && data.text.trim()) return data.text;

  // 2) Responses API convenience
  if (typeof data?.output_text === "string" && data.output_text.trim())
    return data.output_text;

  // 3) Chat Completions
  const cc = data?.choices?.[0]?.message?.content;
  if (typeof cc === "string" && cc.trim()) return cc;

  // 4) Responses API structured output fallback
  try {
    const items = Array.isArray(data?.output) ? data.output : [];
    for (const it of items) {
      const parts = Array.isArray(it?.content) ? it.content : [];
      for (const part of parts) {
        if (
          part?.type === "output_text" &&
          typeof part?.text === "string" &&
          part.text.trim()
        ) {
          return part.text;
        }
      }
    }
  } catch {}

  // 5) If Worker accidentally returned an object like {format, verbosity}, do NOT surface it to users.
  return "";
}

/* Worker call helper: send payload to the Cloudflare Worker and safely parse reply */
async function callWorker(body) {
  try {
    const r = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    const text = extractAssistantText(data);
    return text || "I couldn’t generate that. Please try again.";
  } catch {
    return "Error contacting the assistant.";
  }
}

/* Generate routine */
async function onGenerateRoutine() {
  const selected = Array.from(selectedIds)
    .map((id) => allProducts.find((p) => p.id === id))
    .filter(Boolean);
  if (!selected.length) {
    addChat("assistant", "Select at least one product to build a routine.");
    return;
  }

  // Friendly bubble for the UI
  const userVisible = "Generate a routine from my selected products.";
  addChat("user", userVisible);
  lastQEl.textContent = "Last question: " + userVisible;

  // Replace the just-added user message with the full prompt so we only send ONE user message
  const fullPrompt =
    "Using only these products, build a simple morning/evening routine. If a step is missing, note it briefly.\n" +
    "Format:\n" +
    "Considerations: key factors from product categories and any obvious conflicts\n" +
    "Conclusion: ordered steps with exact product names and a one-sentence usage tip per step\n\n" +
    "Selected products JSON:\n" +
    JSON.stringify(selected);
  // Mutate the last history entry to be the actual content we want to send
  if (messages.length && messages[messages.length - 1].role === "user") {
    messages[messages.length - 1] = { role: "user", content: fullPrompt };
  }

  // Build payload: system + history (no extra user appended)
  const payload = {
    messages: [
      {
        role: "system",
        content:
          "You are L’Oréal Care Guide. On-topic only. Output 3–5 sentences: Considerations then Conclusion. On-label claims only. Refuse off-topic.",
      },
      ...messages,
    ],
  };

  const text = await callWorker(payload);
  addChat("assistant", text || "No response.");
}

/* Chat submit */
async function onChatSubmit(e) {
  e.preventDefault();
  const input = new FormData(chatForm).get("userInput")?.toString().trim();
  if (!input) return;

  // Add the user's message and update last question banner
  chatForm.reset();
  addChat("user", input);
  lastQEl.textContent = `Last question: ${input}`;

  // Build payload: system + history ONLY (avoid double-sending the same user msg)
  const payload = {
    messages: [
      {
        role: "system",
        content:
          "You are L’Oréal Care Guide. On-topic only. Output 3–5 sentences: Considerations then Conclusion. On-label claims only. Refuse off-topic.",
      },
      ...messages,
    ],
  };
  const text = await callWorker(payload);
  addChat("assistant", text || "No response.");
}

/* Chat render */
function addChat(role, md) {
  md = ensureString(md);
  messages.push({ role, content: md });
  const div = document.createElement("div");
  div.className = `chat-bubble ${role === "user" ? "user" : "assistant"}`;
  div.innerText = md;
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}
