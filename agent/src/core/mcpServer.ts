import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { executeSearchProducts } from '../tools/searchProducts.js';
import { executeGetProductDetails } from '../tools/getProductDetails.js';
import { executeBuildCart } from '../tools/buildCart.js';
import { executeSubmitIntent } from '../tools/submitIntent.js';
import { CATALOG } from '../catalog/products.js';

// Instantiate SafeAgent Standard MCP Server
export const server = new McpServer({
  name: "SafeAgent-Commerce-MCP",
  version: "1.0.0"
});

// Tool 1: search_products
server.tool(
  "search_products",
  "Search merchant catalog with keyword relevance and Gemini semantic embeddings",
  {
    query: z.string().describe("Search query or natural language description"),
    maxPrice: z.number().optional().describe("Maximum budget cap in USD"),
    category: z.string().optional().describe("Category filter: accessories, hardware, office, electronics"),
    merchant: z.string().optional().describe("Target merchant store name")
  },
  async ({ query, maxPrice, category, merchant }) => {
    const result = await executeSearchProducts({ query, maxPrice, category, merchant });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

// Tool 2: get_product_details
server.tool(
  "get_product_details",
  "Retrieve comprehensive specifications, stock status, and merchant origin for a product SKU",
  {
    productId: z.string().describe("Merchant SKU or Product ID (e.g. TECH-101)")
  },
  async ({ productId }) => {
    const result = executeGetProductDetails({ productId });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

// Tool 3: build_cart
server.tool(
  "build_cart",
  "Validate merchant inventory, calculate sales tax (8%), and construct a deterministic cart",
  {
    items: z.array(
      z.object({
        productId: z.string().describe("Product ID"),
        quantity: z.number().int().positive().describe("Quantity desired")
      })
    ).describe("Items to place in cart")
  },
  async ({ items }) => {
    const result = executeBuildCart({ items });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

// Tool 4: submit_intent
server.tool(
  "submit_intent",
  "Submit a checkout intent bound by an ML-DSA signed spending mandate to the SafeAgent Gateway. Does NOT have access to raw credit cards.",
  {
    mandateId: z.string().describe("Target spending mandate identifier"),
    merchant: z.string().describe("Target merchant store name"),
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        price: z.number(),
        quantity: z.number()
      })
    ).describe("Cart items to submit"),
    subtotal: z.number().describe("Subtotal amount in USD"),
    tax: z.number().describe("Calculated tax amount in USD"),
    total: z.number().describe("Total amount matching cart validation"),
    currency: z.string().default("USD").describe("Currency code"),
    agentReasoning: z.string().describe("Explanation for autonomous choice"),
    gatewayUrl: z.string().optional().describe("Override gateway URL (default http://localhost:3000)")
  },
  async ({ mandateId, merchant, items, subtotal, tax, total, currency, agentReasoning, gatewayUrl }) => {
    const result = await executeSubmitIntent({
      mandateId,
      merchant,
      items: items.map(i => ({ ...i, sku: i.id })),
      subtotal,
      tax,
      total,
      currency,
      agentReasoning
    }, gatewayUrl);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

// Resource 1: Catalog
server.resource(
  "catalog",
  "safeagent://catalog/products",
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: JSON.stringify(CATALOG, null, 2),
        mimeType: "application/json"
      }
    ]
  })
);

// Prompt 1: Safe procurement template
server.prompt(
  "autonomous-procurement",
  {
    userGoal: z.string().describe("User shopping instruction"),
    mandateBudget: z.string().describe("Authorized spending mandate limit")
  },
  ({ userGoal, mandateBudget }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are SafeAgent autonomous procurement assistant. The user wants: "${userGoal}". The signed mandate budget cap is $${mandateBudget}. Find the best matching item, build a verified cart, and submit checkout intent through the SafeAgent Gateway. Never exceed the mandate.`
        }
      }
    ]
  })
);

// Start server on stdio when executed as entry point
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("SafeAgent MCP Server running on stdio");
}

if (process.argv[1]?.endsWith('mcpServer.ts') || process.argv[1]?.endsWith('mcpServer.js')) {
  main().catch(err => {
    console.error("MCP Server fatal error:", err);
    process.exit(1);
  });
}
