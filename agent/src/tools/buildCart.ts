import { storeService } from '../catalog/storeService.js';
import { CartItem } from '../../../shared/dist/index.js';

export interface CartItemInput {
  productId: string;
  quantity: number;
}

export interface BuildCartInput {
  items: CartItemInput[];
  taxRatePercent?: number; // e.g. 8.25 for 8.25%
}

export const buildCartToolDefinition = {
  name: "build_cart",
  description: "Construct an itemized shopping cart from merchant products, calculating subtotal, applicable taxes, and total. Does not move funds.",
  parameters: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            productId: { type: "string" },
            quantity: { type: "integer", minimum: 1 }
          },
          required: ["productId", "quantity"]
        }
      },
      taxRatePercent: { type: "number", description: "Optional sales tax percentage (defaults to 8.0%)" }
    },
    required: ["items"]
  }
};

export async function executeBuildCart(input: BuildCartInput) {
  if (!input.items || input.items.length === 0) {
    return { error: "Cart cannot be empty." };
  }

  const taxRate = (input.taxRatePercent ?? 18.0) / 100; // 18% GST (Goods and Services Tax)
  const cartItems: CartItem[] = [];
  let subtotal = 0;
  let primaryMerchant: string | null = null;
  let orderCurrency = "INR";

  for (const item of input.items) {
    if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { error: `Invalid quantity '${item.quantity}' for item '${item.productId}'. Quantity must be a positive integer.` };
    }

    const product = storeService.getById(item.productId);
    if (!product) {
      return { error: `Product '${item.productId}' not found in catalog.` };
    }
    if (!product.inStock) {
      return { error: `Product '${product.name}' is out of stock.` };
    }

    orderCurrency = product.currency || "INR";

    if (!primaryMerchant) {
      primaryMerchant = product.merchant;
    } else if (primaryMerchant !== product.merchant) {
      return {
        error: `Cross-merchant carts are prohibited. Cart contains items from '${primaryMerchant}' and '${product.merchant}'. Please create separate orders.`
      };
    }

    const itemTotal = Math.round(product.price * item.quantity * 100) / 100;
    subtotal += itemTotal;

    cartItems.push({
      id: product.id,
      name: product.name,
      price: product.price,
      quantity: item.quantity,
      sku: product.id,
      description: product.description
    });
  }

  subtotal = Math.round(subtotal * 100) / 100;
  const tax = Math.round(subtotal * taxRate * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;

  return {
    cart: {
      merchant: primaryMerchant!,
      items: cartItems,
      subtotal,
      tax,
      total,
      currency: orderCurrency
    }
  };
}

