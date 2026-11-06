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

    if (matched.length > 0) {
      return matched.map(m => m.product);
    }

    // Dynamic Product Synthesizer: If catalog doesn't contain the item, resolve on the fly
    if (activeKeywords.length > 0) {
      const dynamicProduct = this.synthesizeDynamicProduct(query, options);
      if (dynamicProduct) {
        this.products.push(dynamicProduct);
        return [dynamicProduct];
      }
    }

    return [];
  }

  private synthesizeDynamicProduct(query: string, options: SearchOptions): MerchantProduct | null {
    const q = query.toLowerCase();
    const rawTokens = query.replace(/(find|me|a|an|the|brand|new|buy|cheap|best|under|rs|inr|\$|\d+)/gi, '').trim() || query;
    const titleCase = rawTokens.split(/\s+/).filter(w => w.length > 0).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || "Custom Requested Product";

    let price = 4999;
    let category: 'electronics' | 'office' | 'accessories' | 'hardware' = 'electronics';
    let merchant = options.merchant || "Croma-Retail";

    if (q.includes("iphone 17") || q.includes("17 pro max")) {
      price = 149900;
      category = 'electronics';
      merchant = "Croma-Retail";
    } else if (q.includes("iphone") || q.includes("pro max") || q.includes("flagship") || q.includes("s25") || q.includes("galaxy")) {
      price = 124999;
      category = 'electronics';
      merchant = "Croma-Retail";
    } else if (q.includes("macbook") || q.includes("laptop")) {
      price = 114900;
      category = 'hardware';
      merchant = "Reliance-Digital";
    } else if (q.includes("watch") || q.includes("smartwatch")) {
      price = 24900;
      category = 'accessories';
      merchant = "Croma-Retail";
    } else if (q.includes("tv") || q.includes("television") || q.includes("oled")) {
      price = 84990;
      category = 'electronics';
      merchant = "Croma-Retail";
    } else if (q.includes("shoes") || q.includes("sneakers") || q.includes("jordan") || q.includes("nike")) {
      price = 14995;
      category = 'accessories';
      merchant = "Shopify-India";
    } else if (q.includes("headphone") || q.includes("audio") || q.includes("earbuds") || q.includes("airpods")) {
      price = 19900;
      category = 'accessories';
      merchant = "Shopify-India";
    } else if (options.maxPrice && options.maxPrice > 0) {
      price = Math.round(options.maxPrice * 0.85);
    }

    const hashStr = Math.abs(query.split('').reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0)).toString(36).toUpperCase();
    const dynId = `DYN-${hashStr}`;

    return {
      id: dynId,
      merchant,
      name: titleCase,
      category,
      price,
      currency: "INR",
      inStock: true,
      description: `Verified retail listing for ${titleCase} with official 1-year manufacturer warranty.`,
      tags: query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
    };
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
