import { executeSearchProducts } from '../tools/searchProducts.js';
import { executeGetProductDetails } from '../tools/getProductDetails.js';
import { executeBuildCart } from '../tools/buildCart.js';
import { executeSubmitIntent } from '../tools/submitIntent.js';
import { runGeminiPlanner } from './geminiPlanner.js';

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
  availableOptions?: any[];
}

export class CognitivePlanner {
  private gatewayUrl: string;
  private static lastGeminiErrorTime: number = 0;

  constructor(gatewayUrl: string = process.env.GATEWAY_URL || "http://localhost:3000") {
    this.gatewayUrl = gatewayUrl;
  }

  public async planAndExecute(goal: string, mandateId: string = "mandate_active_001"): Promise<PlanExecutionResult> {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const now = Date.now();
    const isCircuitOpen = (now - CognitivePlanner.lastGeminiErrorTime) < 60_000;

    if (geminiApiKey && geminiApiKey.trim() !== '' && !geminiApiKey.includes('PASTE_YOUR') && !isCircuitOpen) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Gemini live API call timeout (4000ms)")), 4000)
        );
        return await Promise.race([
          runGeminiPlanner(goal, mandateId, geminiApiKey, this.gatewayUrl),
          timeoutPromise
        ]);
      } catch (err: any) {
        CognitivePlanner.lastGeminiErrorTime = Date.now();
        console.warn(`[Planner] Live Gemini call encountered error (${err.message}). Circuit breaker active for 60s; falling back to autonomous heuristic planner.`);
      }
    }

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
    const budgetMatch = lowerGoal.match(/(?:under|below|less than|within)\s*(?:₹|rs\.?|inr|\$)?\s*(\d+(?:,\d+)*(?:\.\d+)?)/);
    if (budgetMatch && budgetMatch[1]) {
      maxBudget = parseFloat(budgetMatch[1].replace(/,/g, ''));
      query = goal.replace(/(?:under|below|less than|within)\s*(?:₹|rs\.?|inr|\$)?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i, '').trim();
    }

    log('TOOL_CALL', `Calling tool: search_products(query="${query}", maxPrice=${maxBudget ? `₹${maxBudget}` : 'None'})`);
    const searchResult = await executeSearchProducts({ query, maxPrice: maxBudget });

    const candidateSummary = searchResult.products.slice(0, 5).map((p, idx) => 
      `[${idx + 1}] ${p.name} (₹${p.price.toLocaleString('en-IN')}, ${p.merchant})`
    ).join('  •  ');

    log('TOOL_RESULT', `Discovered ${searchResult.count} matching options within budget:\n${candidateSummary}`, searchResult);

    if (searchResult.count === 0) {
      log('THOUGHT', `Zero products in whitelisted merchant catalogs matched user shopping goal "${goal}". Aborting checkout execution to protect user funds from unintended purchases.`);
      return {
        goal,
        mandateId,
        success: false,
        finalStatus: "UNMATCHED_INTENT",
        trace
      };
    }

    // Step 2: Product selection & inspection
    const chosenProduct = searchResult.products[0];

    // Intent Relevance Verification Guardrail:
    // Prevent semantic drift (e.g. buying running shoes when user requested apparel, or buying regular items when a specific collab was requested)
    const apparelKeywords = ['shirt', 'tshirt', 't-shirt', 'tee', 'top', 'pant', 'pants', 'boxer', 'shorts', 'hoodie', 'jacket', 'clothing', 'apparel'];
    const isApparelQuery = apparelKeywords.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(lowerGoal));
    const isShoeProduct = chosenProduct.tags?.some((t: string) => ['shoes', 'sneakers', 'running', 'footwear'].includes(t.toLowerCase())) || chosenProduct.name?.toLowerCase().includes('shoe');

    const collabTerms = ['pokemon', 'pokémon', 'pikachu', 'anime', 'marvel', 'disney', 'naruto', 'one piece'];
    const activeCollabTerms = collabTerms.filter(term => lowerGoal.includes(term));
    const isCollabQuery = activeCollabTerms.length > 0;
    const prodCollabText = `${chosenProduct.name} ${chosenProduct.description} ${(chosenProduct.tags || []).join(' ')}`.toLowerCase();
    const hasCollabMatch = isCollabQuery && activeCollabTerms.some(term => prodCollabText.includes(term));

    // Keyword coverage verification: ensure candidate product matches at least 50% of distinct user query terms
    const queryTokens = lowerGoal
      .replace(/[\(\)\[\]\{\}",'₹\$]/g, ' ')
      .split(/\s+/)
      .filter(k => k.length > 2 && !['buy', 'find', 'get', 'want', 'need', 'the', 'for', 'with', 'under', 'from', 'best', 'some'].includes(k));
    
    let isCoverageDeficient = false;
    let coverageDetails = '';
    if (queryTokens.length >= 2) {
      const prodSearchText = `${chosenProduct.name} ${chosenProduct.description} ${(chosenProduct.tags || []).join(' ')}`.toLowerCase();
      const matchedTokens = queryTokens.filter(token => prodSearchText.includes(token));
      const matchRatio = matchedTokens.length / queryTokens.length;
      if (matchRatio < 0.5) {
        isCoverageDeficient = true;
        coverageDetails = `matches only ${matchedTokens.length}/${queryTokens.length} key query terms`;
      }
    }

    if ((isApparelQuery && isShoeProduct) || (isCollabQuery && !hasCollabMatch) || isCoverageDeficient) {
      const reasonDetail = (isApparelQuery && isShoeProduct)
        ? `candidate is footwear while user specified apparel`
        : (isCollabQuery && !hasCollabMatch)
        ? `no inventory matches required collab/character ("${activeCollabTerms.join(', ')}")`
        : coverageDetails;

      log('THOUGHT', `Intent Relevance Guardrail: Top catalog candidate "${chosenProduct.name}" from ${chosenProduct.merchant} does not satisfy user's specific request (${reasonDetail}). Aborting checkout to safeguard user funds against unintended spending.`);
      return {
        goal,
        mandateId,
        success: false,
        finalStatus: "UNMATCHED_INTENT",
        trace
      };
    }

    const sym = chosenProduct.currency === 'INR' ? '₹' : '$';
    log('THOUGHT', `Evaluated ${searchResult.count} candidate options. Selecting top-ranked candidate: "${chosenProduct.name}" from ${chosenProduct.merchant} at ${sym}${chosenProduct.price.toLocaleString('en-IN')} ${chosenProduct.currency}.`);
    log('TOOL_CALL', `Calling tool: get_product_details(productId="${chosenProduct.id}")`);
    const details = await executeGetProductDetails({ productId: chosenProduct.id });
    log('TOOL_RESULT', `Retrieved full product specifications and inventory status.`, details);

    // Step 3: Build Cart
    log('TOOL_CALL', `Calling tool: build_cart(items=[{productId: "${chosenProduct.id}", quantity: 1}])`);
    const cartResult = await executeBuildCart({
      items: [{ productId: chosenProduct.id, quantity: 1 }],
      taxRatePercent: 18.0
    });
    log('TOOL_RESULT', `Cart successfully composed: Subtotal=₹${cartResult.cart?.subtotal?.toLocaleString('en-IN')}, 18% GST=₹${cartResult.cart?.tax?.toLocaleString('en-IN')}, Total=₹${cartResult.cart?.total?.toLocaleString('en-IN')} INR.`, cartResult);

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
    const reasoningText = `Selected '${chosenProduct.name}' (₹${chosenProduct.price}) to fulfill user request '${goal}'. Total with 18% GST is ₹${cartResult.cart.total}.`;
    log('TOOL_CALL', `Calling tool: submit_intent(mandateId="${mandateId}", merchant="${cartResult.cart.merchant}", total=₹${cartResult.cart.total.toLocaleString('en-IN')})`);
    
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
    const isBudgetRejection = submission.policyDecision === 'REJECTED' && (
      submission.reason?.includes('BUDGET_EXCEEDED') ||
      submission.reason?.toLowerCase().includes('exceeds remaining mandate balance') ||
      submission.reason?.toLowerCase().includes('budget') ||
      submission.reason?.toLowerCase().includes('balance') ||
      submission.reason?.toLowerCase().includes('max spend')
    );

    if (isBudgetRejection) {
      log('RECOVERY', `Gateway blocked intent due to budget cap. Initiating autonomous fallback discovery for lower-cost alternatives.`);
      
      // Determine allowed spending ceiling from Gateway feedback or mandate constraints
      let allowedSpend = 15000.0;
      const budgetCapMatch = submission.reason?.match(/(?:max spend|balance|limit|cap)\s*(?:\()?(?:₹|rs\.?|inr|\$)?\s*([0-9,]+(?:\.[0-9]+)?)/i);
      if (budgetCapMatch && budgetCapMatch[1]) {
        allowedSpend = parseFloat(budgetCapMatch[1].replace(/,/g, ''));
      } else if (maxBudget) {
        allowedSpend = maxBudget;
      }

      // Pre-tax ceiling taking into account 18% GST (price * 1.18 <= allowedSpend)
      const maxPreTaxPrice = Math.floor((allowedSpend / 1.18) * 100) / 100;

      // Check if user specifically requested a branded flagship (e.g. iPhone / Apple) or a flagship device with no sub-budget counterpart
      const productTags: string[] = (chosenProduct as any).tags || (details.product as any)?.tags || [];
      const productCategory: string = (chosenProduct as any).category || (details.product as any)?.category || "accessories";

      const isBrandSpecificFlagship = 
        goal.toLowerCase().includes('iphone') || 
        goal.toLowerCase().includes('apple') ||
        (chosenProduct as any).name?.toLowerCase().includes('iphone') ||
        productTags.includes('iphone') ||
        (chosenProduct.price > 45000 && productCategory === 'electronics' && !goal.toLowerCase().includes('monitor'));

      if (isBrandSpecificFlagship) {
        log('THOUGHT', `Policy Gateway Hard Stop: Flagship device "${chosenProduct.name}" exceeds mandate spend limit (₹${allowedSpend.toLocaleString('en-IN')}). Policy disallows autonomous substitution of flagship hardware. Deterministic Gateway rejection preserved.`);
        return {
          goal,
          mandateId,
          success: false,
          finalStatus: submission.status,
          trace,
          intent: submission.intent,
          gatewayDecision: submission
        };
      }

      let searchKeyword = "";
      const primaryTag = productTags.find((t: string) => 
        !['budget', 'cheap', 'flagship', 'luxury', 'expensive', '4k', 'android', '5g', 'apple', 'sony', 'samsung'].includes(t.toLowerCase())
      );
      if (primaryTag) {
        searchKeyword = primaryTag;
      } else if (productCategory === 'electronics') {
        searchKeyword = "display";
      } else {
        searchKeyword = productCategory;
      }

      log('THOUGHT', `Autonomous recovery target: Searching for '${searchKeyword}' alternatives priced under pre-tax ceiling ₹${maxPreTaxPrice.toLocaleString('en-IN')} (to ensure total with 18% GST stays under ₹${allowedSpend.toLocaleString('en-IN')}).`);

      let budgetSearch = await executeSearchProducts({ query: searchKeyword, maxPrice: maxPreTaxPrice });
      // If direct keyword search returned nothing, fall back to product category only if broad electronics is avoided
      if (budgetSearch.count === 0 && productCategory && productCategory !== 'electronics') {
        budgetSearch = await executeSearchProducts({ query: productCategory, category: productCategory, maxPrice: maxPreTaxPrice });
      }

      // Filter out the over-budget product itself and enforce strict product type matching
      // Alternative product MUST belong to the exact same product type as original (e.g. laptop -> laptop only, never accessories/chargers)
      const productTypeTokens = ['laptop', 'notebook', 'phone', 'smartphone', 'monitor', 'keyboard', 'mouse', 'shoes', 'shirt', 'charger', 'headphones'];
      const targetType = productTypeTokens.find(token => 
        goal.toLowerCase().includes(token) || 
        productTags.some(t => t.toLowerCase() === token) ||
        chosenProduct.name.toLowerCase().includes(token)
      );

      const validAlternatives = budgetSearch.products.filter(p => {
        if (p.id === chosenProduct.id || p.price > maxPreTaxPrice) return false;

        if (targetType) {
          const altHasType = (p.tags || []).some((t: string) => t.toLowerCase() === targetType) || p.name.toLowerCase().includes(targetType);
          if (!altHasType) return false;
        } else if (p.category !== chosenProduct.category) {
          return false;
        }

        return true;
      });

      log('TOOL_RESULT', `Budget recovery search discovered ${validAlternatives.length} compliant options within policy limits.`, { count: validAlternatives.length, alternatives: validAlternatives });

      if (validAlternatives.length > 0) {
        const altProduct = validAlternatives[0];
        const estTax = Math.round(altProduct.price * 0.18 * 100) / 100;
        const estTotal = Math.round((altProduct.price + estTax) * 100) / 100;

        log('THOUGHT', `Autonomous recovery decision: Selected compliant alternative "${altProduct.name}" from ${altProduct.merchant} at ₹${altProduct.price.toLocaleString('en-IN')} (Estimated total with 18% GST: ₹${estTotal.toLocaleString('en-IN')} <= ₹${allowedSpend.toLocaleString('en-IN')}). Composing replacement cart.`);

        const altCart = await executeBuildCart({
          items: [{ productId: altProduct.id, quantity: 1 }],
          taxRatePercent: 18.0
        });

        if (altCart.cart) {
          log('TOOL_CALL', `Resubmitting revised intent with budget alternative: Total=₹${altCart.cart.total.toLocaleString('en-IN')}`);
          submission = await executeSubmitIntent({
            mandateId,
            merchant: altCart.cart.merchant,
            items: altCart.cart.items,
            subtotal: altCart.cart.subtotal,
            tax: altCart.cart.tax,
            total: altCart.cart.total,
            currency: altCart.cart.currency,
            agentReasoning: `Autonomous recovery: Replaced over-budget item '${chosenProduct.name}' with compliant alternative '${altProduct.name}' (₹${altProduct.price} + 18% GST = ₹${altCart.cart.total}).`
          }, this.gatewayUrl);

          log('GATEWAY_RESPONSE', `Revised intent evaluation: ${submission.status}`, submission);
        }
      } else {
        log('THOUGHT', `Autonomous recovery unable to locate alternative '${searchKeyword}' items under budget ceiling ₹${maxPreTaxPrice.toLocaleString('en-IN')}. Mandate spend ceiling policy rejection stands.`);
      }
    }

    return {
      goal,
      mandateId,
      success: submission.policyDecision !== 'BLOCKED' && submission.policyDecision !== 'REJECTED',
      finalStatus: submission.status,
      trace,
      intent: submission.intent,
      gatewayDecision: submission,
      availableOptions: searchResult.products.slice(0, 5)
    };
  }
}

export const cognitivePlanner = new CognitivePlanner();

