import React, { useState, useEffect } from 'react';
import {
  ShoppingBag,
  X,
  Search,
  Star,
  Package,
  Store,
  ArrowUpRight,
  Sparkles,
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
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
          {/* Header */}
          <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <ShoppingBag className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white flex items-center gap-2">
                  <span>Merchant Product Feed</span>
                  <span className="text-[10px] font-mono font-normal px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                    Live MCP
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Structured feeds indexed across 5 whitelisted merchants
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              aria-label="Close drawer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Search & Filter Bar */}
          <div className="p-4 border-b border-slate-800 space-y-3 bg-slate-950/40">
            {/* Search Input */}
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products, keywords, categories..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans"
              />
            </div>

            {/* Merchant Filter Pills */}
            <div className="flex flex-wrap gap-1.5 overflow-x-auto pb-1 text-[11px]">
              <button
                type="button"
                onClick={() => setSelectedMerchant('ALL')}
                className={`px-2.5 py-1 rounded-lg border font-medium transition ${
                  selectedMerchant === 'ALL'
                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                All ({products.length})
              </button>
              {merchants.map((merchant) => (
                <button
                  key={merchant}
                  type="button"
                  onClick={() => setSelectedMerchant(merchant)}
                  className={`px-2.5 py-1 rounded-lg border font-medium transition ${
                    selectedMerchant === merchant
                      ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {merchant}
                </button>
              ))}
            </div>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="m-4 p-3 rounded-xl bg-red-950/80 border border-red-500/50 text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Product Cards List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {isLoading && (
              <div className="flex flex-col items-center justify-center h-48 text-cyan-400 space-y-2 animate-pulse">
                <RefreshCw className="h-6 w-6 animate-spin" />
                <span className="text-xs">Querying merchant store feeds...</span>
              </div>
            )}

            {!isLoading && filteredProducts.length === 0 && !errorMessage && (
              <div className="flex flex-col items-center justify-center h-48 text-slate-500 text-center space-y-2">
                <Package className="h-8 w-8 opacity-40" />
                <p className="text-xs">No matching products found.</p>
                <p className="text-[10px] text-slate-600">Try adjusting your search query or store filter.</p>
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
                  className={`p-3.5 rounded-xl border transition-all text-xs space-y-2 ${
                    isRogue
                      ? 'bg-red-950/20 border-red-500/30 hover:border-red-500/60'
                      : 'bg-slate-950/80 border-slate-800/80 hover:border-cyan-500/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-bold text-slate-100 text-xs leading-snug">
                        {product.name}
                      </h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="flex items-center gap-1 text-[10px] text-slate-400">
                          <Store className="h-3 w-3 text-cyan-400" />
                          <span>{product.merchant}</span>
                        </span>
                        <span className="text-slate-600">•</span>
                        <span className="text-[10px] font-mono text-slate-400 capitalize">
                          {product.category}
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="font-mono text-sm font-bold text-cyan-300">
                        {formatCurrency(product.price, product.currency)}
                      </p>
                      <div className="flex items-center gap-0.5 justify-end text-[10px] text-amber-400 mt-0.5">
                        <Star className="h-2.5 w-2.5 fill-current" />
                        <span>{product.rating || '4.5'}</span>
                      </div>
                    </div>
                  </div>

                  {product.description && (
                    <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                      {product.description}
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-1 border-t border-slate-900">
                    <span className="text-[10px] font-mono text-slate-500">
                      Stock: <strong className="text-slate-300">{product.inventory ?? 12}</strong> units
                    </span>

                    {onSelectProduct && (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectProduct(product.name);
                          onClose();
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 transition"
                      >
                        <span>Prompt Goal</span>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer Status */}
          <div className="p-3 border-t border-slate-800 bg-slate-950/60 text-center text-[11px] text-slate-500">
            SafeAgent Commerce Catalog • {products.length} Products Verified
          </div>
        </div>
      </div>
    </div>
  );
};
