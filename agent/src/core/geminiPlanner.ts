import { GoogleGenerativeAI, FunctionDeclaration, Tool, SchemaType } from '@google/generative-ai';
import { executeSearchProducts, searchProductsToolDefinition } from '../tools/searchProducts.js';
import { executeGetProductDetails, getProductDetailsToolDefinition } from '../tools/getProductDetails.js';
import { executeBuildCart, buildCartToolDefinition } from '../tools/buildCart.js';
import { executeSubmitIntent, submitIntentToolDefinition } from '../tools/submitIntent.js';
import { ReasoningStep, PlanExecutionResult } from './planner.js';

export async function runGeminiPlanner(
  goal: string,
  mandateId: string,
  apiKey: string,
  gatewayUrl: string
): Promise<PlanExecutionResult> {
  const genAI = new GoogleGenerativeAI(apiKey);

  const searchDecl: FunctionDeclaration = {
    name: "search_products",
    description: "Search merchant product catalogs by query and price cap. Does not execute payment.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: { type: SchemaType.STRING, description: "Search query or keywords" },
        maxPrice: { type: SchemaType.NUMBER, description: "Maximum budget filter in USD" }
      },
      required: ["query"]
    }
  };

  const detailsDecl: FunctionDeclaration = {
    name: "get_product_details",
    description: "Retrieve complete specifications and inventory status for a specific product SKU/ID.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        productId: { type: SchemaType.STRING, description: "Product SKU (e.g. 'TECH-101')" }
      },
      required: ["productId"]
    }
  };

  const cartDecl: FunctionDeclaration = {
    name: "build_cart",
    description: "Construct an itemized cart from merchant items, calculating subtotal and taxes. Does not execute payment.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        items: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              productId: { type: SchemaType.STRING },
              quantity: { type: SchemaType.INTEGER }
            },
            required: ["productId", "quantity"]
          }
        }
      },
      required: ["items"]
    }
  };

  const submitDecl: FunctionDeclaration = {
    name: "submit_intent",
    description: "Submits a composed cart to the Policy Gateway for deterministic verification. You have no direct payment credentials.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        mandateId: { type: SchemaType.STRING },
        merchant: { type: SchemaType.STRING },
        items: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              id: { type: SchemaType.STRING },
              name: { type: SchemaType.STRING },
              price: { type: SchemaType.NUMBER },
              quantity: { type: SchemaType.INTEGER }
            },
            required: ["id", "name", "price", "quantity"]
          }
        },
        subtotal: { type: SchemaType.NUMBER },
        tax: { type: SchemaType.NUMBER },
        total: { type: SchemaType.NUMBER },
        currency: { type: SchemaType.STRING },
        agentReasoning: { type: SchemaType.STRING }
      },
      required: ["mandateId", "merchant", "items", "subtotal", "tax", "total", "currency", "agentReasoning"]
    }
  };

  const tools: Tool[] = [{ functionDeclarations: [searchDecl, detailsDecl, cartDecl, submitDecl] }];

  const model = genAI.getGenerativeModel({
    model: "gemini-3.8-flash",
    tools,
    systemInstruction: `You are SafeAgent Cognitive Planner (P2), an untrusted autonomous shopping AI.
Your objective: Fulfill the user's shopping goal within delegated spending boundaries.
RULES:
1. You have ZERO payment authority and NO credit card credentials.
2. Use 'search_products' to discover items.
3. Use 'get_product_details' to inspect specifications.
4. Use 'build_cart' to compose the itemized basket with taxes.
5. Use 'submit_intent' to propose the cart to the SafeAgent Policy Gateway.
6. If the Gateway rejects an intent (e.g. budget cap), adapt autonomously to select a budget-compliant alternative.`
  });

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

  log('THOUGHT', `[Gemini LLM] Connected to Gemini 1.5 Flash. Processing shopping goal: "${goal}" with mandate ${mandateId}.`);

  const chat = model.startChat();
  let promptMsg = `Goal: "${goal}". Active Mandate ID: "${mandateId}". Please find the best item and submit the intent.`;

  let lastSubmissionResult: any = null;

  for (let turn = 0; turn < 6; turn++) {
    const result = await chat.sendMessage(promptMsg);
    const response = result.response;
    const functionCalls = response.functionCalls();

    if (!functionCalls || functionCalls.length === 0) {
      log('THOUGHT', `[Gemini LLM] Completed task: ${response.text()}`);
      break;
    }

    const call = functionCalls[0];
    const name = call.name;
    const args: any = call.args;

    log('TOOL_CALL', `[Gemini LLM] Calling tool: ${name}(${JSON.stringify(args)})`);

    let functionResponseData: any;

    if (name === 'search_products') {
      functionResponseData = await executeSearchProducts(args);
    } else if (name === 'get_product_details') {
      functionResponseData = await executeGetProductDetails(args);
    } else if (name === 'build_cart') {
      functionResponseData = await executeBuildCart(args);
    } else if (name === 'submit_intent') {
      functionResponseData = await executeSubmitIntent(args, gatewayUrl);
      lastSubmissionResult = functionResponseData;
      log('GATEWAY_RESPONSE', `Gateway evaluated submitted intent: ${functionResponseData.status}`, functionResponseData);
    } else {
      functionResponseData = { error: `Unknown function '${name}'` };
    }

    log('TOOL_RESULT', `Tool '${name}' response received.`, functionResponseData);

    // Send function response back to Gemini
    promptMsg = JSON.stringify({
      functionResponse: {
        name,
        response: functionResponseData
      }
    });
  }

  return {
    goal,
    mandateId,
    success: lastSubmissionResult?.policyDecision !== 'BLOCKED' && lastSubmissionResult?.policyDecision !== 'REJECTED',
    finalStatus: lastSubmissionResult?.status || 'COMPLETED',
    trace,
    intent: lastSubmissionResult?.intent,
    gatewayDecision: lastSubmissionResult
  };
}

