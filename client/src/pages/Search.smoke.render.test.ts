/* eslint-disable no-console */
/** Rendered by Search.smoke.test.ts. Empty query is not a paste, so this crashes
 * if `summary` is read before it is declared.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SearchPage from "./Search";

const mem = new Map<string, string>();
const memoryStorage: Storage = {
  get length() {
    return mem.size;
  },
  clear() {
    mem.clear();
  },
  getItem(key: string) {
    return mem.has(key) ? mem.get(key)! : null;
  },
  key(index: number) {
    return Array.from(mem.keys())[index] ?? null;
  },
  removeItem(key: string) {
    mem.delete(key);
  },
  setItem(key: string, value: string) {
    mem.set(key, value);
  },
};

const g = globalThis as { window?: Window & typeof globalThis; document?: Document; sessionStorage?: Storage; localStorage?: Storage };
g.sessionStorage = memoryStorage;
g.localStorage = memoryStorage;
if (!g.window) {
  g.window = globalThis as Window & typeof globalThis;
}
g.window.sessionStorage = memoryStorage;
g.window.localStorage = memoryStorage;
g.window.location = { hash: "#/search", href: "http://localhost/#/search", pathname: "/" } as Location;
if (!g.document) {
  g.document = { querySelector: () => null } as unknown as Document;
}

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, queryFn: async () => null } },
});
let html = "";
try {
  html = renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(SearchPage)),
  );
} catch (err) {
  console.error("FAIL search page render", err);
  process.exit(1);
}

if (!html.includes("Search")) {
  console.error("FAIL search page render produced no Search heading");
  process.exit(1);
}
if (!html.includes("Save view")) {
  console.error("FAIL search page has no Save view button");
  process.exit(1);
}
if (html.includes("Save as…")) {
  console.error("FAIL search page still shows Save as…");
  process.exit(1);
}
if (!html.includes("No saved views yet — use Save view above")) {
  console.error("FAIL empty views hint missing");
  process.exit(1);
}
if (!html.includes("Pin a view to keep it here")) {
  console.error("FAIL pinned tile row missing");
  process.exit(1);
}
if (!html.includes("search-pinned-views")) {
  console.error("FAIL pinned tile row marker missing");
  process.exit(1);
}

console.log("1 passed, 0 failed");
