#!/usr/bin/env bun
import * as readline from "readline";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Perform a web search using DuckDuckGo Lite.
 */
async function searchDuckDuckGo(query: string, maxResults: number = 5): Promise<SearchResult[]> {
  const postBody = new URLSearchParams({ q: query }).toString();

  const response = await fetch("https://lite.duckduckgo.com/lite/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    },
    body: postBody
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo request failed with status ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  const results: SearchResult[] = [];

  // Match result links (href can appear before or after class)
  const linkMatches = Array.from(
    html.matchAll(/<a\s+[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g)
  );

  // Match result snippets
  const snippetMatches = Array.from(
    html.matchAll(/<td\s+[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g)
  );

  const count = Math.min(linkMatches.length, maxResults);

  for (let i = 0; i < count; i++) {
    const fullTag = linkMatches[i][0];
    const rawTitle = linkMatches[i][1];
    const rawSnippet = snippetMatches[i] ? snippetMatches[i][1] : "";

    const hrefMatch = fullTag.match(/href=['"]([^'"]+)['"]/);
    const rawUrl = hrefMatch ? hrefMatch[1] : "";

    // Clean HTML tags and entities
    const cleanTitle = rawTitle.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").trim();
    const cleanSnippet = rawSnippet.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").trim();

    // Decode URL if wrapped by DuckDuckGo redirect
    let targetUrl = rawUrl;
    try {
      const parsed = new URL(rawUrl, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) {
        targetUrl = decodeURIComponent(uddg);
      }
    } catch {
      // Keep raw url
    }

    if (cleanTitle) {
      results.push({
        title: cleanTitle,
        url: targetUrl,
        snippet: cleanSnippet
      });
    }
  }

  return results;
}

// Setup Stdio JSON-RPC 2.0 communication
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function sendResponse(id: number | string | null, result?: any, error?: any) {
  const payload: Record<string, any> = { jsonrpc: "2.0", id };
  if (error) {
    payload.error = error;
  } else {
    payload.result = result;
  }
  process.stdout.write(JSON.stringify(payload) + "\n");
}

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const msg = JSON.parse(trimmed);

    // 1. Handshake: initialize
    if (msg.method === "initialize") {
      sendResponse(msg.id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "duckduckgo-search",
          version: "1.0.0"
        }
      });
      return;
    }

    // 2. Initialized notification
    if (msg.method === "notifications/initialized") {
      return;
    }

    // 3. Tool Discovery: tools/list
    if (msg.method === "tools/list") {
      sendResponse(msg.id, {
        tools: [
          {
            name: "web_search",
            description: "Performs a live DuckDuckGo web search and returns top search results with titles, snippets, and links.",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "The search query terms to look up on the web"
                },
                max_results: {
                  type: "number",
                  description: "Maximum number of search results to return (default: 5)"
                }
              },
              required: ["query"]
            }
          }
        ]
      });
      return;
    }

    // 4. Tool Execution: tools/call
    if (msg.method === "tools/call") {
      const toolName = msg.params?.name;
      const args = msg.params?.arguments || {};

      if (toolName === "web_search") {
        const query = args.query;
        if (!query) {
          sendResponse(msg.id, undefined, {
            code: -32602,
            message: "Missing required parameter 'query'."
          });
          return;
        }

        const maxResults = typeof args.max_results === "number" ? args.max_results : 5;

        try {
          const results = await searchDuckDuckGo(query, maxResults);

          if (results.length === 0) {
            sendResponse(msg.id, {
              content: [{ type: "text", text: `No web results found for "${query}".` }],
              isError: false
            });
            return;
          }

          const formatted = results
            .map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`)
            .join("\n\n");

          sendResponse(msg.id, {
            content: [
              {
                type: "text",
                text: `DuckDuckGo Search Results for "${query}":\n\n${formatted}`
              }
            ],
            isError: false
          });
        } catch (searchErr: any) {
          sendResponse(msg.id, {
            content: [{ type: "text", text: `Web search failed: ${searchErr.message}` }],
            isError: true
          });
        }
        return;
      }

      sendResponse(msg.id, undefined, {
        code: -32601,
        message: `Unknown tool: ${toolName}`
      });
      return;
    }

    // Fallback for unhandled methods
    if (msg.id !== undefined) {
      sendResponse(msg.id, undefined, {
        code: -32601,
        message: `Method not supported: ${msg.method}`
      });
    }
  } catch (err: any) {
    // Ignore invalid JSON lines
  }
});
