import { storeService } from '../catalog/storeService.js';

export interface GetProductDetailsInput {
  productId: string;
}

export const getProductDetailsToolDefinition = {
  name: "get_product_details",
  description: "Retrieve comprehensive specifications, stock status, full description, and tags for a specific product ID.",
  parameters: {
    type: "object",
    properties: {
      productId: { type: "string", description: "The unique product SKU/ID (e.g. 'TECH-101')" }
    },
    required: ["productId"]
  }
};

export async function executeGetProductDetails(input: GetProductDetailsInput) {
  const product = storeService.getById(input.productId);
  if (!product) {
    return {
      error: `Product with ID '${input.productId}' not found in any merchant catalog.`
    };
  }

  return {
    product: {
      id: product.id,
      merchant: product.merchant,
      name: product.name,
      category: product.category,
      price: product.price,
      currency: product.currency,
      inStock: product.inStock,
      description: product.description,
      tags: product.tags
    }
  };
}

