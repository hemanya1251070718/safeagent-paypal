import { executeSearchProducts } from '../tools/searchProducts.js';
import { executeGetProductDetails } from '../tools/getProductDetails.js';
import { executeBuildCart } from '../tools/buildCart.js';
import { executeSubmitIntent } from '../tools/submitIntent.js';

export interface ReasoningStep {
  step: number;
  timestamp: string;
  type: 'THOUGHT' | 'TOOL_CALL' | 'TOOL_RESULT' | 'GATEWAY_RESPONSE' | 'RECOVERY';
  content: string;
  payload?: any;
}

export interface PlanExecutionResult {
  goal: string;
  mandateId: string;
  success: boolean;
  finalStatus: string;
  trace: ReasoningStep[];
  intent?: any;
  gatewayDecision?: any;
}

export class CognitivePlanner {
  private gatewayUrl: string;

  constructor(gatewayUrl: string = process.env.GATEWAY_URL || "http://localhost:3000") {
    this.gatewayUrl = gatewayUrl;
  }

  public async planAndExecute(goal: string, mandateId: string = "mandate_active_001"): Promise<PlanExecutionResult> {
    const trace: ReasoningStep[] = [];
    let stepCount = 1;

    const log = (type: ReasoningStep['type'], content: string, payload?: any) => {
      trace.push({
        step: stepCount++,
        timestamp: new Date().toISOString(),
        type,
        content,
        payload
      });
    };

    log('THOUGHT', `Received user shopping goal: "${goal}". Formulating semantic discovery plan within cryptographic mandate ${mandateId}.`);

    // Step 1: Semantic Discovery
    let query = goal;
    let maxBudget: number | undefined;

    const lowerGoal = goal.toLowerCase();
    if (lowerGoal.includes("under $") || lowerGoal.includes("under ")) {
      const match = lowerGoal.match(/under\s*\$?(\d+(\.\d+)?)/);
      if (match && match[1]) {
        maxBudget = parseFloat(match[1]);
      }
    }

    log('TOOL_CALL', `Calling tool: search_products(query="${query}", maxPrice=${maxBudget ?? 'None'})`);
    const searchResult = await executeSearchProducts({ query, maxPrice: maxBudget });
    log('TOOL_RESULT', `Catalog returned ${searchResult.count} matching products.`, searchResult);

    if (searchResult.count === 0) {
      log('THOUGHT', `No products directly matched query "${query}". Broadening query to find related items.`);
      const fallbackSearch = await executeSearchProducts({ query: "accessories" });
      log('TOOL_RESULT', `Fallback search found ${fallbackSearch.count} items.`, fallbackSearch);
    }

    // Step 2: Product selection & inspection
    const chosenProduct = (searchResult.count > 0) ? searchResult.products[0] : null;
    if (!chosenProduct) {
      log('THOUGHT', `Unable to find any viable products matching "${goal}". Aborting cart composition.`);
      return {
        goal,
        mandateId,
        success: false,
        finalStatus: "NO_PRODUCTS_FOUND",
        trace
      };
    }

    log('THOUGHT', `Selecting best matching item: "${chosenProduct.name}" from merchant "${chosenProduct.merchant}" at $${chosenProduct.price} ${chosenProduct.currency}.`);
    log('TOOL_CALL', `Calling tool: get_product_details(productId="${chosenProduct.id}")`);
    const details = await executeGetProductDetails({ productId: chosenProduct.id });
    log('TOOL_RESULT', `Retrieved full product specifications and inventory status.`, details);

    // Step 3: Build Cart
    log('TOOL_CALL', `Calling tool: build_cart(items=[{productId: "${chosenProduct.id}", quantity: 1}])`);
    const cartResult = await executeBuildCart({
      items: [{ productId: chosenProduct.id, quantity: 1 }],
      taxRatePercent: 8.0
    });
    log('TOOL_RESULT', `Cart successfully composed: Subtotal=$${cartResult.cart?.subtotal}, Tax=$${cartResult.cart?.tax}, Total=$${cartResult.cart?.total}.`, cartResult);

    if (!cartResult.cart) {
      return {
        goal,
        mandateId,
        success: false,
        finalStatus: "CART_BUILD_FAILED",
        trace
      };
    }

    // Step 4: Submit Intent to Policy Gateway
    const reasoningText = `Selected '${chosenProduct.name}' ($${chosenProduct.price}) to fulfill user request '${goal}'. Total with tax is $${cartResult.cart.total}.`;
    log('TOOL_CALL', `Calling tool: submit_intent(mandateId="${mandateId}", merchant="${cartResult.cart.merchant}", total=$${cartResult.cart.total})`);
    
    let submission = await executeSubmitIntent({
      mandateId,
      merchant: cartResult.cart.merchant,
      items: cartResult.cart.items,
      subtotal: cartResult.cart.subtotal,
      tax: cartResult.cart.tax,
      total: cartResult.cart.total,
      currency: cartResult.cart.currency,
      agentReasoning: reasoningText
    }, this.gatewayUrl);

    log('GATEWAY_RESPONSE', `Gateway evaluated intent with policy status: ${submission.status}`, submission);

    // Step 5: Check if autonomous adaptation is needed (Scenario 4: Budget Recovery)
    if (submission.policyDecision === 'REJECTED' && submission.reason?.includes('BUDGET_EXCEEDED')) {
      log('RECOVERY', `Gateway blocked intent due to budget cap. Initiating autonomous fallback discovery for lower-cost alternatives.`);
      
      const budgetSearch = await executeSearchProducts({ query: "monitor", maxPrice: 95.0 });
      log('TOOL_RESULT', `Budget recovery search returned ${budgetSearch.count} options under $95.`, budgetSearch);

      if (budgetSearch.count > 0) {
        const altProduct = budgetSearch.products[0];
        log('THOUGHT', `Autonomous recovery: Found alternative "${altProduct.name}" for $${altProduct.price}. Composing replacement cart.`);

        const altCart = await executeBuildCart({
          items: [{ productId: altProduct.id, quantity: 1 }],
          taxRatePercent: 8.0
        });

        if (altCart.cart) {
          log('TOOL_CALL', `Resubmitting revised intent with budget alternative: Total=$${altCart.cart.total}`);
          submission = await executeSubmitIntent({
            mandateId,
            merchant: altCart.cart.merchant,
            items: altCart.cart.items,
            subtotal: altCart.cart.subtotal,
            tax: altCart.cart.tax,
            total: altCart.cart.total,
            currency: altCart.cart.currency,
            agentReasoning: `Autonomous recovery: Replaced over-budget monitor with compliant alternative '${altProduct.name}' ($${altProduct.price}).`
          }, this.gatewayUrl);

          log('GATEWAY_RESPONSE', `Revised intent evaluation: ${submission.status}`, submission);
        }
      }
    }

    return {
      goal,
      mandateId,
      success: submission.policyDecision !== 'BLOCKED' && submission.policyDecision !== 'REJECTED',
      finalStatus: submission.status,
      trace,
      intent: submission.intent,
      gatewayDecision: submission
    };
  }
}

export const cognitivePlanner = new CognitivePlanner();

