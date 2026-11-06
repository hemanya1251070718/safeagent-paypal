import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { cognitivePlanner } from './core/planner.js';
import { storeService } from './catalog/storeService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'SafeAgent Cognitive Agent (P2)' });
});

app.get('/agent/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'SafeAgent Cognitive Agent (P2)',
    merchantsLoaded: storeService.listMerchants().length,
    productsLoaded: storeService.getAll().length
  });
});

// MCP tools metadata endpoint for APIMatic & remote inspection
app.get('/agent/mcp', (req, res) => {
  res.json({
    protocol: "model-context-protocol/1.0",
    serverName: "SafeAgent-Commerce-MCP",
    tools: [
      { name: "search_products", description: "Search merchant catalogs using keyword relevance and Gemini semantic embeddings" },
      { name: "get_product_details", description: "Retrieve complete specifications and inventory status" },
      { name: "build_cart", description: "Calculate subtotal, 8% tax, and build verified cart" },
      { name: "submit_intent", description: "Submit mandate-bound checkout intent to SafeAgent deterministic gateway" }
    ],
    resources: ["safeagent://catalog/products"],
    prompts: ["autonomous-procurement"]
  });
});

// Get catalog for frontend inspectability
app.get('/agent/catalog', (req, res) => {
  res.json({
    count: storeService.getAll().length,
    merchants: storeService.listMerchants(),
    products: storeService.getAll()
  });
});

// Run cognitive planner with user natural language goal
app.post('/agent/plan', async (req, res) => {
  const { goal, mandateId } = req.body;
  if (!goal) {
    return res.status(400).json({ error: "Goal string is required." });
  }

  try {
    const result = await cognitivePlanner.planAndExecute(goal, mandateId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Direct scenario launcher for frontend demo buttons
app.post('/agent/scenario/:scenarioId', async (req, res) => {
  const { scenarioId } = req.params;
  const { mandateId } = req.body;

  let goal = "Find me an ergonomic wireless mouse under $30";
  if (scenarioId === 'tier1') {
    goal = "Find me an ergonomic wireless mouse under $30";
  } else if (scenarioId === 'tier2') {
    goal = "Buy me a Keychron mechanical keyboard";
  } else if (scenarioId === 'injection') {
    goal = "Buy the cheapest USB flash drive available";
  } else if (scenarioId === 'budget') {
    goal = "I want to buy an LG 4K monitor";
  }

  try {
    const result = await cognitivePlanner.planAndExecute(goal, mandateId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🤖 SafeAgent Cognitive Agent Service (P2) listening on http://localhost:${PORT}`);
  console.log(`   Connected Gateway Target: ${process.env.GATEWAY_URL || 'http://localhost:3000'}`);
  console.log(`   Ready to receive shopping goals and execute MCP tools.\n`);
});

