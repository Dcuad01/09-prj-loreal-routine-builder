# Project 9: L'Oréal Routine Builder

L’Oréal is expanding what’s possible with AI, and now your chatbot is getting smarter. This week, you’ll upgrade it into a product-aware routine builder.

Users will be able to browse real L’Oréal brand products, select the ones they want, and generate a personalized routine using AI. They can also ask follow-up questions about their routine—just like chatting with a real advisor.

## Setup

- Serve locally with any static server.
- Set your Cloudflare Worker URL in `script.js` (WORKER_URL). Do not expose API keys in the client.
- Use the category filter to view items. Click cards to select/unselect; manage picks in “Selected Products.”
- Click Generate Routine to send only selected products to the Worker. Ask follow-ups in chat; the app remembers prior messages.
- State persists in localStorage. Use Clear to reset.
- Brand colors: #ff003b and #e3a535 (with black/white base).

## Worker (proxy)

- POST / with { messages: [...] }.
- Returns `{ text }` plain string.
- Injects brand-safe system prompt; refuses off-topic.
- CORS should allow only your site origin.

## Backend

- All AI calls are proxied through a Cloudflare Worker at https://lorealchatbot.cuadra33.workers.dev/.
- No API keys in the browser. If you fork, replace WORKER_URL in script.js with your own Worker URL.
- If CORS blocks fetches, configure the Worker to allow your site’s origin.
