import { storeService } from '../catalog/storeService.js';

export interface SearchProductsInput {
  query: string;
  maxPrice?: number;
  category?: string;
  merchant?: string;
}

export const searchProductsToolDefinition = {
  name: "search_products",
  description: "Search structured merchant catalogs for products matching user criteria. Returns itemized listings with prices and merchant names. Does not execute purchases.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query or keywords (e.g. 'ergonomic wireless mouse')" },
      maxPrice: { type: "number", description: "Maximum price filter in USD" },
      category: { type: "string", description: "Product category (e.g. 'accessories', 'hardware', 'office')" },
      merchant: { type: "string", description: "Specific merchant store name" }
    },
    required: ["query"]
  }
};

export async function executeSearchProducts(input: SearchProductsInput) {
  const results = storeService.search(input.query, {
    maxPrice: input.maxPrice,
    category: input.category,
    merchant: input.merchant
  });

  return {
    count: results.length,
    products: results.map(p => ({
      id: p.id,
      merchant: p.merchant,
      name: p.name,
      price: p.price,
      currency: p.currency,
      inStock: p.inStock,
      description: p.description
    }))
  };
}

