import { CATALOG, MerchantProduct } from './products.js';

export interface SearchOptions {
  maxPrice?: number;
  category?: string;
  merchant?: string;
  includeOutOfStock?: boolean;
}

const STOP_WORDS = new Set(["find", "me", "an", "a", "the", "for", "under", "with", "to", "buy", "i", "want", "of", "in"]);

export class StoreService {
  private products: MerchantProduct[] = CATALOG;

  public search(query: string, options: SearchOptions = {}): MerchantProduct[] {
    const q = query.toLowerCase().trim();
    const rawKeywords = q.split(/\s+/).filter(k => k.length > 0);
    // Filter out stop words unless all keywords are stop words
    const keywords = rawKeywords.filter(k => !STOP_WORDS.has(k) && !k.startsWith("$") && isNaN(Number(k)));
    const activeKeywords = keywords.length > 0 ? keywords : rawKeywords;

    const matched = this.products.map(product => {
      // Stock filter
      if (!options.includeOutOfStock && !product.inStock) {
        return { product, score: -1 };
      }

      // Price filter
      if (options.maxPrice !== undefined && product.price > options.maxPrice) {
        return { product, score: -1 };
      }

      // Merchant filter
      if (options.merchant && product.merchant.toLowerCase() !== options.merchant.toLowerCase()) {
        return { product, score: -1 };
      }

      // Category filter
      if (options.category && product.category.toLowerCase() !== options.category.toLowerCase()) {
        return { product, score: -1 };
      }

      if (activeKeywords.length === 0) {
        return { product, score: 1 };
      }

      // Score relevance: Title matches = 10 pts, Tag matches = 5 pts, Description matches = 2 pts
      let score = 0;
      const lowerName = product.name.toLowerCase();
      const lowerDesc = product.description.toLowerCase();
      const lowerTags = product.tags.map(t => t.toLowerCase());

      for (const kw of activeKeywords) {
        if (lowerName.includes(kw)) score += 10;
        if (lowerTags.some(t => t.includes(kw))) score += 5;
        if (lowerDesc.includes(kw)) score += 2;
      }

      return { product, score };
    }).filter(item => item.score > 0);

    // Sort by relevance score descending, then price ascending
    matched.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.product.price - b.product.price;
    });

    return matched.map(m => m.product);
  }

  public getById(productId: string): MerchantProduct | undefined {
    return this.products.find(p => p.id === productId);
  }

  public listMerchants(): string[] {
    const merchants = new Set(this.products.map(p => p.merchant));
    return Array.from(merchants);
  }

  public getAll(): MerchantProduct[] {
    return this.products;
  }
}

export const storeService = new StoreService();
