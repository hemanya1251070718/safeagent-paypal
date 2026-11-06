import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { CATALOG, MerchantProduct } from './products.js';
import { SearchOptions } from './storeService.js';

dotenv.config();

export interface SemanticSearchResult {
  product: MerchantProduct;
  score: number;
  engine: 'gemini-embedding' | 'vector-tfidf';
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// --- Local TF-IDF Vector Space Embedder (High-reliability isomorphic fallback) ---
class LocalTfidfEmbedder {
  private vocab: Map<string, number> = new Map();
  private idf: number[] = [];
  private docVectors: Map<string, number[]> = new Map();

  constructor(products: MerchantProduct[]) {
    this.buildIndex(products);
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
  }

  private buildIndex(products: MerchantProduct[]) {
    const docs = products.map(p => `${p.name} ${p.category} ${p.tags.join(' ')} ${p.description}`);
    const tokenizedDocs = docs.map(d => this.tokenize(d));

    // Build vocabulary
    let idx = 0;
    for (const tokens of tokenizedDocs) {
      for (const t of tokens) {
        if (!this.vocab.has(t)) {
          this.vocab.set(t, idx++);
        }
      }
    }

    const vocabSize = this.vocab.size;
    const docCount = products.length;
    this.idf = new Array(vocabSize).fill(0);

    // Compute document frequency
    for (const tokens of tokenizedDocs) {
      const seen = new Set(tokens);
      for (const t of seen) {
        const vIdx = this.vocab.get(t);
        if (vIdx !== undefined) this.idf[vIdx]++;
      }
    }

    // Inverted document frequency
    for (let i = 0; i < vocabSize; i++) {
      this.idf[i] = Math.log((docCount + 1) / (this.idf[i] + 1)) + 1;
    }

    // Embed all catalog documents
    for (let i = 0; i < products.length; i++) {
      const vec = this.embedText(tokenizedDocs[i]);
      this.docVectors.set(products[i].id, vec);
    }
  }

  public embedText(tokens: string[]): number[] {
    const vec = new Array(this.vocab.size).fill(0);
    for (const t of tokens) {
      const idx = this.vocab.get(t);
      if (idx !== undefined) vec[idx] += 1;
    }
    for (let i = 0; i < vec.length; i++) {
      if (vec[i] > 0) {
        vec[i] = (1 + Math.log(vec[i])) * this.idf[i];
      }
    }
    return vec;
  }

  public embedQuery(text: string): number[] {
    return this.embedText(this.tokenize(text));
  }

  public getDocVector(productId: string): number[] | undefined {
    return this.docVectors.get(productId);
  }
}

export class SemanticSearchService {
  private localEmbedder: LocalTfidfEmbedder;
  private genAI: GoogleGenerativeAI | null = null;
  private productEmbeddingCache: Map<string, number[]> = new Map();
  private hasApiKey: boolean = false;

  constructor() {
    this.localEmbedder = new LocalTfidfEmbedder(CATALOG);
    const key = process.env.GEMINI_API_KEY;
    if (key && !key.includes('PASTE_YOUR')) {
      try {
        this.genAI = new GoogleGenerativeAI(key);
        this.hasApiKey = true;
      } catch {
        this.hasApiKey = false;
      }
    }
  }

  private async getGeminiEmbedding(text: string): Promise<number[] | null> {
    if (!this.genAI || !this.hasApiKey) return null;
    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
      const res = await model.embedContent(text);
      return res.embedding.values;
    } catch {
      return null;
    }
  }

  private async ensureProductEmbeddingsGemini() {
    if (!this.genAI || !this.hasApiKey || this.productEmbeddingCache.size > 0) return;
    for (const p of CATALOG) {
      const text = `${p.name}. Category: ${p.category}. ${p.description}. Tags: ${p.tags.join(', ')}`;
      const vec = await this.getGeminiEmbedding(text);
      if (vec) {
        this.productEmbeddingCache.set(p.id, vec);
      }
    }
  }

  public async search(query: string, options: SearchOptions = {}): Promise<SemanticSearchResult[]> {
    // Attempt Gemini dense vector embedding first
    let queryVec: number[] | null = null;
    let engine: 'gemini-embedding' | 'vector-tfidf' = 'vector-tfidf';

    if (this.hasApiKey) {
      try {
        queryVec = await this.getGeminiEmbedding(query);
        if (queryVec) {
          await this.ensureProductEmbeddingsGemini();
          if (this.productEmbeddingCache.size === CATALOG.length) {
            engine = 'gemini-embedding';
          } else {
            queryVec = null;
          }
        }
      } catch {
        queryVec = null;
      }
    }

    // Fallback to isomorphic TF-IDF vector space embedding
    let localQueryVec: number[] = [];
    if (!queryVec) {
      localQueryVec = this.localEmbedder.embedQuery(query);
      engine = 'vector-tfidf';
    }

    const scored: SemanticSearchResult[] = [];

    for (const product of CATALOG) {
      // Stock filter
      if (!options.includeOutOfStock && !product.inStock) continue;
      // Price filter
      if (options.maxPrice !== undefined && product.price > options.maxPrice) continue;
      // Merchant filter
      if (options.merchant && product.merchant.toLowerCase() !== options.merchant.toLowerCase()) continue;
      // Category filter
      if (options.category && product.category.toLowerCase() !== options.category.toLowerCase()) continue;

      let score = 0;
      if (engine === 'gemini-embedding' && queryVec) {
        const prodVec = this.productEmbeddingCache.get(product.id);
        if (prodVec) {
          score = cosineSimilarity(queryVec, prodVec);
        }
      } else {
        const prodVec = this.localEmbedder.getDocVector(product.id);
        if (prodVec) {
          score = cosineSimilarity(localQueryVec, prodVec);
        }
      }

      if (score > 0.05) {
        scored.push({ product, score, engine });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }
}

export const semanticSearchService = new SemanticSearchService();

