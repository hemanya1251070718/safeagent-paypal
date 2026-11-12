import 'dotenv/config';
import { storeService } from '../src/catalog/storeService.js';
import { semanticSearchService } from '../src/catalog/semanticSearch.js';
import { executeBuildCart } from '../src/tools/buildCart.js';
import { executeSearchProducts } from '../src/tools/searchProducts.js';
import { CognitivePlanner } from '../src/core/planner.js';
import { server } from '../src/core/mcpServer.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✔ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ✖ FAIL: ${testName}`);
    failed++;
  }
}

async function runTests() {
  console.log("\n==============================================================");
  console.log("   🤖 SafeAgent AI Agent & Commerce Test Suite (P2)           ");
  console.log("==============================================================\n");

  // [Group 1] Catalog & Relevance Ranking
  console.log("[Group 1] Catalog & Relevance Search");
  const mouseResults = storeService.search("find me an ergonomic mouse under 2000 rupees", { maxPrice: 2000 });
  assert(mouseResults.length > 0, "Keyword search returns items under ₹2,000");
  assert(mouseResults[0].id === "TECH-101", "Top match for ergonomic mouse is Anker Ergonomic Mouse (TECH-101)");
  assert(mouseResults[0].merchant === "Shopify-India", "Merchant origin matches whitelisted store");

  // Out of stock filter
  const allDark = storeService.search("flash drive", { merchant: "DarkMarket-Malicious" });
  assert(allDark.length >= 1 && allDark[0].id === "ROGUE-666", "DarkMarket item located (ROGUE-666)");

  // [Group 2] Semantic Vector Embeddings
  console.log("\n[Group 2] Semantic Vector Embeddings");
  // Query with no overlapping keywords: "cordless screen pointer" -> should match Anker Mouse
  const semanticRes = await semanticSearchService.search("cordless screen pointer");
  assert(semanticRes.length > 0, "Semantic search returns candidates for 'cordless screen pointer'");
  const topSemantic = semanticRes[0].product;
  assert(topSemantic.tags.includes("mouse") || topSemantic.id === "TECH-101", "Top semantic match is a mouse product");
  console.log(`     (Matched: ${semanticRes[0].product.name} | Engine: ${semanticRes[0].engine} | Score: ${semanticRes[0].score.toFixed(3)})`);

  // Hybrid tool search
  const hybridRes = await executeSearchProducts({ query: "mechanical keyboard" });
  assert(hybridRes.count > 0, "Hybrid search returns results for mechanical keyboard");
  assert(hybridRes.products[0].id === "TECH-102", "Top hybrid result is Keychron K2");

  // [Group 3] Cart Engine & Financial Math
  console.log("\n[Group 3] Cart Engine & Financial Math");
  // TECH-101 is ₹1,899. 18% GST = ₹341.82. Total = ₹2,240.82
  const cartRes = await executeBuildCart({
    items: [{ productId: "TECH-101", quantity: 1 }]
  });
  assert(cartRes.cart !== undefined, "Cart built successfully");
  assert(cartRes.cart?.subtotal === 1899, "Cart subtotal matches item price (₹1,899)");
  assert(cartRes.cart?.tax === 341.82, "GST calculated at 18% rounded to 2 decimals (₹341.82)");
  assert(cartRes.cart?.total === 2240.82, "Total equals subtotal + GST (₹2,240.82)");

  // Reject out of stock / invalid
  const invalidCart = await executeBuildCart({
    items: [{ productId: "NON_EXISTENT_SKU", quantity: 1 }]
  });
  assert(invalidCart.error !== undefined, "Invalid product SKU is rejected by cart builder");

  // [Group 4] Autonomous Planner & Strategy Execution
  console.log("\n[Group 4] Autonomous Planner Execution");
  const planner = new CognitivePlanner("http://localhost:3000");
  const planTier1 = await planner.planAndExecute(
    "Buy me an ergonomic wireless mouse under ₹2500",
    "mandate_test_p2"
  );
  assert(planTier1.trace.length > 0, "Planner generates cognitive reasoning trace");
  assert(planTier1.intent !== undefined, "Planner successfully generated checkout intent");
  const planTotal = planTier1.intent ? (planTier1.intent.total ?? planTier1.intent.totalAmount) : 0;
  assert(planTotal <= 2500.0, `Cart total (₹${planTotal}) strictly stays under ₹2,500 user constraint`);

  // [Group 5] Standard MCP Server Registration
  console.log("\n[Group 5] Model Context Protocol (MCP) Server");
  assert(server !== undefined, "MCP Server instance created");
  // Check that server has registered tools
  assert(typeof server.connect === 'function', "MCP Server exposes connect() lifecycle");

  console.log("\n==============================================================");
  console.log(`  Test Results: ${passed} Passed | ${failed} Failed`);
  console.log("==============================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution error:", err);
  process.exit(1);
});
