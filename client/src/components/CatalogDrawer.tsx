import React, { useState, useEffect } from 'react';
import {
  ShoppingBag,
  X,
  Search,
  Star,
  Package,
  Store,
  ArrowUpRight,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { getCatalog, CatalogProduct } from '../services/api';
import { formatCurrency } from '../utils/formatters';

interface CatalogDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProduct?: (productName: string) => void;
}

export const CatalogDrawer: React.FC<CatalogDrawerProps> = ({
  isOpen,
  onClose,
  onSelectProduct
}) => {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [merchants, setMerchants] = useState<string[]>([]);
  const [selectedMerchant, setSelectedMerchant] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadCatalog();
    }
  }, [isOpen]);

  const loadCatalog = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await getCatalog();
      setProducts(data.products || []);
      setMerchants(data.merchants || []);
    } catch (err: any) {
      console.error('Catalog fetch error:', err);
      setErrorMessage(
        'Agent service offline (:4001). Start services with start-all.ps1 to view live feeds.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const filteredProducts = products.filter((product) => {
    const matchesMerchant =
      selectedMerchant === 'ALL' || product.merchant === selectedMerchant;
    const query = searchQuery.toLowerCase().trim();
    const matchesQuery =
      !query ||
      product.name.toLowerCase().includes(query) ||
      product.description?.toLowerCase().includes(query) ||
      product.category?.toLowerCase().includes(query) ||
      product.tags?.some((t) => t.toLowerCase().includes(query));
    return matchesMerchant && matchesQuery;
  });

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-ink/40 animate-in fade-in duration-150">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-surface border-l border-border shadow-floating flex flex-col animate-in slide-in-from-right duration-200">
          {/* Header */}
          <div className="p-5 border-b border-border flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 shadow-2xs">
                <ShoppingBag className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-serif text-lg font-semibold text-ink">
                    Merchant product feed
                  </h3>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-mono font-semibold border border-indigo-200">
                    Live MCP
                  </span>
                </div>
                <p className="text-xs text-ink-muted mt-0.5">
                  Structured feeds indexed across whitelisted merchants
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-page transition"
              aria-label="Close drawer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Search & Filter Bar */}
          <div className="p-4 border-b border-border space-y-3 bg-page/40">
            {/* Search Input */}
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products, keywords, categories..."
                className="input-text w-full pl-9 pr-3 py-1.5 text-xs font-sans"
              />
            </div>

            {/* Merchant Filter Pills */}
            <div className="flex flex-wrap gap-1.5 overflow-x-auto pb-1 text-[11px]">
              <button
                type="button"
                onClick={() => setSelectedMerchant('ALL')}
                className={`px-2.5 py-1 rounded-md border font-medium transition ${
                  selectedMerchant === 'ALL'
                    ? 'bg-accent text-white border-accent shadow-xs'
                    : 'bg-white text-ink-muted border-border hover:text-ink hover:bg-stone-50'
                }`}
              >
                All ({products.length})
              </button>
              {merchants.map((merchant) => (
                <button
                  key={merchant}
                  type="button"
                  onClick={() => setSelectedMerchant(merchant)}
                  className={`px-2.5 py-1 rounded-md border font-medium transition ${
                    selectedMerchant === merchant
                      ? 'bg-accent text-white border-accent shadow-xs'
                      : 'bg-white text-ink-muted border-border hover:text-ink hover:bg-stone-50'
                  }`}
                >
                  {merchant}
                </button>
              ))}
            </div>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="m-4 p-3 rounded-md bg-danger/10 border border-danger/30 text-danger text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Product Cards List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {isLoading && (
              <div className="flex flex-col items-center justify-center h-48 text-ink-muted space-y-2">
                <RefreshCw className="h-5 w-5 animate-spin text-accent" />
                <span className="text-xs">Querying merchant store feeds...</span>
              </div>
            )}

            {!isLoading && filteredProducts.length === 0 && !errorMessage && (
              <div className="flex flex-col items-center justify-center h-48 text-ink-muted text-center space-y-2">
                <Package className="h-8 w-8 stroke-1 text-ink-muted/50" />
                <p className="text-xs">No matching products found.</p>
                <p className="text-[11px] text-ink-muted/80">Try adjusting your search query or store filter.</p>
              </div>
            )}

            {filteredProducts.map((product) => {
              const isRogue =
                product.merchant.includes('Dark') ||
                product.description?.includes('SYSTEM_OVERRIDE') ||
                product.name.includes('PROMO');

              return (
                <div
                  key={product.id}
                  className={`p-3.5 rounded-md border transition-all text-xs space-y-2 ${
                    isRogue
                      ? 'bg-danger/5 border-danger/40'
                      : 'bg-surface border-border hover:border-accent/40 shadow-xs'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-medium text-ink text-xs leading-snug">
                        {product.name}
                      </h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="flex items-center gap-1 text-[11px] text-ink-muted">
                          <Store className="h-3 w-3 text-ink-muted" />
                          <span>{product.merchant}</span>
                        </span>
                        <span className="text-border">•</span>
                        <span className="text-[10px] font-mono text-ink-muted capitalize">
                          {product.category}
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="font-mono text-xs font-semibold text-accent">
                        {formatCurrency(product.price, product.currency)}
                      </p>
                      <div className="flex items-center gap-0.5 justify-end text-[10px] text-saffron mt-0.5">
                        <Star className="h-2.5 w-2.5 fill-current" />
                        <span>{product.rating || '4.5'}</span>
                      </div>
                    </div>
                  </div>

                  {product.description && (
                    <p className="text-[11px] text-ink-muted line-clamp-2 leading-relaxed">
                      {product.description}
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <span className="text-[10px] font-mono text-ink-muted">
                      Stock: <strong className="text-ink font-medium">{product.inventory ?? 12}</strong> units
                    </span>

                    {onSelectProduct && (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectProduct(product.name);
                          onClose();
                        }}
                        className="btn-secondary text-[11px] py-1 px-2.5 flex items-center gap-1"
                      >
                        <span>Prompt goal</span>
                        <ArrowUpRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer Status */}
          <div className="p-3 border-t border-border bg-page/60 text-center text-[11px] text-ink-muted font-mono">
            SafeAgent commerce catalog • {products.length} products verified
          </div>
        </div>
      </div>
    </div>
  );
};
