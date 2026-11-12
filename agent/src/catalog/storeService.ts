import { CATALOG, MerchantProduct } from './products.js';

export interface SearchOptions {
  maxPrice?: number;
  category?: string;
  merchant?: string;
  includeOutOfStock?: boolean;
}

const STOP_WORDS = new Set(["find", "me", "an", "a", "the", "for", "under", "with", "to", "buy", "by", "get", "give", "i", "want", "of", "in", "best", "cheap", "good", "some"]);
const MODIFIER_WORDS = new Set(["pro", "max", "plus", "ultra", "mini", "lite", "gen", "edition", "series", "v2", "v3", "2nd", "3rd", "4th", "5th"]);

export class StoreService {
  private products: MerchantProduct[] = [...CATALOG];

  public search(query: string, options: SearchOptions = {}): MerchantProduct[] {
    const q = query.toLowerCase().trim();
    // Sanitize punctuation so searches like "Puma Velocity NITRO 3 (₹7,499, Myntra)" parse cleanly
    const sanitizedQuery = q.replace(/[\(\)\[\]\{\}",'₹\$]/g, ' ');
    const rawKeywords = sanitizedQuery.split(/\s+/).filter(k => k.length > 0);
    // Filter out stop words and single-letter characters (e.g. 'x' in 'Puma x Collab')
    const keywords = rawKeywords.filter(k => !STOP_WORDS.has(k) && isNaN(Number(k)) && k.length > 1);
    const activeKeywords = keywords.length > 0 ? keywords : rawKeywords.filter(k => k.length > 1);

    const substantiveKeywords = activeKeywords.filter(k => !MODIFIER_WORDS.has(k));
    const requireSubstantiveMatch = substantiveKeywords.length > 0;

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

      // Score relevance: Title matches = 10 pts, Tag matches = 5 pts, Description matches = 1 bonus pt
      // STRICT GROUNDING: Must match on Name or Tags. Description-only occurrence (e.g. "charges laptops") is NOT a product match.
      let score = 0;
      let hasCoreMatch = false;
      let hasSubstantiveMatch = false;
      const lowerName = product.name.toLowerCase();
      const lowerDesc = product.description.toLowerCase();
      const lowerTags = product.tags.map(t => t.toLowerCase());

      for (const kw of activeKeywords) {
        const wordRegex = new RegExp(`\\b${kw}`, 'i');
        const nameMatch = wordRegex.test(lowerName);
        const tagMatch = lowerTags.some(t => t === kw || t.startsWith(kw));

        if (nameMatch) {
          score += 10;
          hasCoreMatch = true;
          if (!MODIFIER_WORDS.has(kw)) hasSubstantiveMatch = true;
        }
        if (tagMatch) {
          score += 5;
          hasCoreMatch = true;
          if (!MODIFIER_WORDS.has(kw)) hasSubstantiveMatch = true;
        }
        if (hasCoreMatch && wordRegex.test(lowerDesc)) {
          score += 1;
        }
      }

      if (!hasCoreMatch || (requireSubstantiveMatch && !hasSubstantiveMatch)) {
        return { product, score: 0 };
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

    const results = matched.map(m => m.product);
    return results.slice(0, 6);
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
