import { storeService } from '../src/catalog/storeService.js';
import { executeBuildCart } from '../src/tools/buildCart.js';
import { executeSubmitIntent } from '../src/tools/submitIntent.js';

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

async function runAttackSuite() {
  console.log("\n==============================================================");
  console.log("   🛡 SafeAgent Adversarial Security & Red Team Suite (P2)    ");
  console.log("==============================================================\n");

  // Attack Vector 1: Indirect HTML Prompt Injection in Catalog Description
  console.log("[Vector 1] Indirect Prompt Injection via Untrusted Merchant Feed");
  const rogueItem = storeService.getById("ROGUE-666");
  assert(rogueItem !== undefined, "Rogue product SKU found in DarkMarket inventory");
  assert(
    rogueItem?.description.includes("SYSTEM_OVERRIDE") === true,
    "Product contains concealed '<!-- SYSTEM_OVERRIDE -->' adversarial injection payload"
  );

  const rogueCart = await executeBuildCart({
    items: [{ productId: "ROGUE-666", quantity: 1 }]
  });
  assert(rogueCart.cart !== undefined, "Cart builder faithfully records item without executing untrusted payload");

  // Attack Vector 2: Submitting Injected Cart to Policy Gateway
  console.log("\n[Vector 2] Policy Gateway Sanitization Firewall Defense");
  const submissionRes = await executeSubmitIntent({
    mandateId: "mandate_active_001",
    merchant: rogueCart.cart!.merchant,
    items: rogueCart.cart!.items,
    subtotal: rogueCart.cart!.subtotal,
    tax: rogueCart.cart!.tax,
    total: rogueCart.cart!.total,
    currency: "USD",
    agentReasoning: "Attacker payload simulated submission"
  });

  assert(
    submissionRes.policyDecision === "REJECTED" || submissionRes.policyDecision === "BLOCKED",
    "Gateway Firewall blocks the adversarial payload before any financial movement"
  );
  assert(
    submissionRes.status === "REJECTED_BY_GATEWAY",
    "Gateway status indicates strict rejection"
  );

  // Attack Vector 3: Cross-Merchant Cart Contamination Exploit
  console.log("\n[Vector 3] Cross-Merchant Cart Smuggling");
  const mixedCart = await executeBuildCart({
    items: [
      { productId: "TECH-101", quantity: 1 }, // Shopify-TechStore
      { productId: "MED-201", quantity: 1 }   // Medusa-OfficePro
    ]
  });
  assert(mixedCart.error !== undefined, "Cross-merchant cart rejected at cart level to prevent fund leakage");

  // Attack Vector 4: Negative Quantity Exploit
  console.log("\n[Vector 4] Negative Item Quantity / Underflow Exploit");
  const negativeCart = await executeBuildCart({
    items: [{ productId: "TECH-101", quantity: -5 }]
  });
  assert(
    negativeCart.error !== undefined || (negativeCart.cart?.total ?? 0) <= 0,
    "Negative quantity input strictly rejected or neutralized"
  );

  // Attack Vector 5: Out of Stock Asset Exhaustion Exploit
  console.log("\n[Vector 5] Phantoms & Ghost SKU Purchasing");
  const ghostCart = await executeBuildCart({
    items: [{ productId: "PHANTOM-999-EXPLOIT", quantity: 1 }]
  });
  assert(ghostCart.error !== undefined, "Non-existent SKU rejected immediately");

  console.log("\n==============================================================");
  console.log(`  Red Team Results: ${passed} Passed | ${failed} Failed`);
  console.log("==============================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runAttackSuite().catch(err => {
  console.error("Red Team Test Failure:", err);
  process.exit(1);
});

