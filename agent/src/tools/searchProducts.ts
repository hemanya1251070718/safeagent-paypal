import { storeService } from '../catalog/storeService.js';
import { semanticSearchService } from '../catalog/semanticSearch.js';
import { MerchantProduct } from '../catalog/products.js';

export interface SearchProductsInput {
  query: string;
  maxPrice?: number;
  category?: string;
  merchant?: string;
  semantic?: boolean;
}

export const searchProductsToolDefinition = {
  name: "search_products",
  description: "Search structured merchant catalogs for products matching user criteria using keyword and dense vector semantic embeddings. Returns itemized listings with prices and merchant names. Does not execute purchases.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query or natural language description (e.g. 'ergonomic wireless pointing device' or 'mechanical keyboard')" },
      maxPrice: { type: "number", description: "Maximum price filter in INR" },
      category: { type: "string", description: "Product category (e.g. 'accessories', 'hardware', 'office')" },
      merchant: { type: "string", description: "Specific merchant store name" },
      semantic: { type: "boolean", description: "Enable vector semantic embedding search (defaults to true)" }
    },
    required: ["query"]
  }
};

export async function executeSearchProducts(input: SearchProductsInput) {
  const options = {
    maxPrice: input.maxPrice,
    category: input.category,
    merchant: input.merchant
  };

  // 1. Keyword relevance match
  const keywordResults = storeService.search(input.query, options);

  // 2. Vector semantic embedding match
  let semanticResults: { product: MerchantProduct; score: number; engine: string }[] = [];
  try {
    semanticResults = await semanticSearchService.search(input.query, options);
  } catch {
    semanticResults = [];
  }

  // 3. Deduplicate and merge results (preserving highest relevance rank)
  const productMap = new Map<string, { product: MerchantProduct; matchType: string; score?: number }>();

  // Add keyword results
  for (const p of keywordResults) {
    productMap.set(p.id, { product: p, matchType: 'keyword' });
  }

  // Add semantic results
  for (const s of semanticResults) {
    if (!productMap.has(s.product.id)) {
      productMap.set(s.product.id, { product: s.product, matchType: s.engine, score: Math.round(s.score * 100) / 100 });
    } else {
      const existing = productMap.get(s.product.id)!;
      existing.matchType = 'hybrid (keyword + ' + s.engine + ')';
      existing.score = Math.round(s.score * 100) / 100;
    }
  }

  const merged = Array.from(productMap.values());

  return {
    count: merged.length,
    products: merged.map(m => ({
      id: m.product.id,
      merchant: m.product.merchant,
      name: m.product.name,
      price: m.product.price,
      currency: m.product.currency,
      inStock: m.product.inStock,
      description: m.product.description,
      matchType: m.matchType,
      relevanceScore: m.score
    }))
  };
}

