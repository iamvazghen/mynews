// Optional MCP wrapper so OpenClaw agents can pull the feed as a tool call.
// It just proxies the REST API — the server must be running.
//   npm i @modelcontextprotocol/sdk zod
//   NEWS_API=http://localhost:3000 node mcp.js
// ponytail: the REST API is already the integration layer; this is a thin
// convenience shim for MCP-native clients. Skip it entirely if your agents
// can `curl /api/news` directly.

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const API = process.env.NEWS_API || "http://localhost:3000";
const server = new McpServer({ name: "newsfeed", version: "1.0.0" });

server.registerTool(
  "get_news",
  {
    description:
      "Fetch aggregated news headlines across topics. Returns title, link, source, " +
      "category, publishedAt, readingMinutes, snippet.",
    inputSchema: {
      category: z.string().optional().describe("comma-separated category slugs (omit = all). See list_categories."),
      since: z.number().optional().describe("only items from the past N hours (0 = all time)"),
      sort: z.enum(["newest", "category"]).optional(),
      q: z.string().optional().describe("keyword filter on title + snippet"),
      limit: z.number().optional(),
    },
  },
  async (args) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(args)) if (v != null) p.set(k, String(v));
    const data = await fetch(`${API}/api/news?${p}`).then((r) => r.json());
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.registerTool(
  "get_article",
  {
    description:
      "Fetch the full readable text of a single news article by URL (use the .link from get_news). " +
      "Returns clean body text with boilerplate stripped — what you need to read or summarize the story.",
    inputSchema: { url: z.string().describe("article URL from a get_news item's .link") },
  },
  async ({ url }) => {
    const data = await fetch(`${API}/api/article?url=${encodeURIComponent(url)}`).then((r) => r.json());
    return { content: [{ type: "text", text: data.content || JSON.stringify(data) }] };
  }
);

server.registerTool(
  "list_categories",
  { description: "List available news category slugs and labels.", inputSchema: {} },
  async () => {
    const data = await fetch(`${API}/api/categories`).then((r) => r.json());
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.connect(new StdioServerTransport());
