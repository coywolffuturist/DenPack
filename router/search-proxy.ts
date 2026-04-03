// Intercepts web_search calls, routes to Den browser search via Chrome CDP
// Full implementation requires Den Chrome CDP endpoint — stub for v1
export async function denBrowserSearch(query: string): Promise<string> {
  console.log(`[search-proxy] Routing to Den browser: "${query}"`);
  // TODO: implement Chrome CDP search on Den
  return `Search stub for: ${query}`;
}
