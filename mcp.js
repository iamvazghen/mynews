// MCP wrapper so agents can pull the feed as a tool call. It proxies the REST API, so the
// tools never go stale: categories are read live from /api/categories on every call.
//   stdio:  NEWS_API=http://localhost:3000 node mcp.js
//   HTTP:   POST /api/mcp on the deployed app (server.js) — same tools, no copy to keep in sync.
// ponytail: the REST API is already the integration layer; this is a thin
// convenience shim for MCP-native clients.

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod");

const category = z.string().optional().describe("comma-separated category slugs (omit = all). See list_categories.");

function buildServer(API) {
  const server = new McpServer({ name: "newsfeed", version: "1.0.0" });

  // A failed upstream call is a tool error the model can see, never a successful-looking result.
  async function get(pathAndQuery, render = (d) => JSON.stringify(d, null, 2)) {
    try {
      const r = await fetch(`${API}${pathAndQuery}`);
      const data = await r.json();
      return { content: [{ type: "text", text: r.ok ? render(data) : JSON.stringify(data) }], isError: !r.ok };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: String(e.message || e) }) }], isError: true };
    }
  }

  const query = (args) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(args)) if (v != null) p.set(k, String(v));
    return p;
  };

  server.registerTool(
    "get_news",
    {
      description:
        "Fetch aggregated news headlines across topics. Returns title, link, source, " +
        "category, publishedAt, readingMinutes, snippet.",
      inputSchema: {
        category,
        since: z.number().optional().describe("only items from the past N hours (0 = all time)"),
        sort: z.enum(["newest", "category"]).optional(),
        q: z.string().optional().describe("keyword filter on title + snippet"),
        limit: z.number().optional(),
      },
    },
    async (args) => get(`/api/news?${query(args)}`)
  );

  server.registerTool(
    "get_article",
    {
      description:
        "Fetch the full readable text of a single news article by URL (use the .link from get_news). " +
        "Returns clean body text with boilerplate stripped — what you need to read or summarize the story.",
      inputSchema: { url: z.string().describe("article URL from a get_news item's .link") },
    },
    async ({ url }) => get(`/api/article?url=${encodeURIComponent(url)}`, (d) => d.content || JSON.stringify(d))
  );

  server.registerTool(
    "list_categories",
    { description: "List available news category slugs and labels.", inputSchema: {} },
    async () => get("/api/categories")
  );

  server.registerTool(
    "check_feeds",
    {
      description:
        "Report the health of every configured RSS source: per category, per feed " +
        "whether it is alive, how many items it returned, and the last error. " +
        "Use this to explain a thin or empty category.",
      inputSchema: { category },
    },
    async (args) => get(`/api/health?${query(args)}`)
  );

  return server;
}

module.exports = { buildServer };

if (require.main === module) {
  const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
  buildServer(process.env.NEWS_API || "http://localhost:3000").connect(new StdioServerTransport());
}
