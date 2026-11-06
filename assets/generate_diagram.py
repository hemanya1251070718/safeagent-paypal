import os

def generate_svg():
    svg_content = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 1360" width="100%" height="100%" style="background:#090d16; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <defs>
    <!-- Gradients -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#090d16"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="userGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>
    <linearGradient id="p1Grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="p2Grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#451a03"/>
      <stop offset="100%" stop-color="#1c1917"/>
    </linearGradient>
    <linearGradient id="p3Grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#064e3b"/>
      <stop offset="100%" stop-color="#022c22"/>
    </linearGradient>
    <linearGradient id="p4Grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4c0519"/>
      <stop offset="100%" stop-color="#1f0208"/>
    </linearGradient>
    <linearGradient id="paypalGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0070ba"/>
      <stop offset="100%" stop-color="#003087"/>
    </linearGradient>

    <!-- Markers -->
    <marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 9 5 L 0 9 z" fill="#64748b"/>
    </marker>
    <marker id="arrow-blue" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 9 5 L 0 9 z" fill="#38bdf8"/>
    </marker>
    <marker id="arrow-amber" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 9 5 L 0 9 z" fill="#fbbf24"/>
    </marker>
    <marker id="arrow-green" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 9 5 L 0 9 z" fill="#34d399"/>
    </marker>
    <marker id="arrow-purple" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 9 5 L 0 9 z" fill="#c084fc"/>
    </marker>
    <marker id="arrow-red" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 9 5 L 0 9 z" fill="#f43f5e"/>
    </marker>
  </defs>

  <!-- Title & Subtitle Banner -->
  <rect x="30" y="20" width="1060" height="60" rx="12" fill="#111827" stroke="#1f2937" stroke-width="1.5"/>
  <text x="50" y="47" fill="#f8fafc" font-size="19" font-weight="800" letter-spacing="-0.3">SafeAgent: End-to-End System Architecture</text>
  <text x="50" y="66" fill="#94a3b8" font-size="12">PayPal AI Hackathon 2026 • Deterministic, Policy-Guarded Financial Proxy for Autonomous AI Agents</text>
  <text x="1070" y="55" fill="#38bdf8" font-size="12" font-weight="600" text-anchor="end">gitdiagram.com/hemanya1251070718/safeagent-paypal</text>

  <!-- Top: Human User -->
  <g transform="translate(240, 105)">
    <circle cx="25" cy="25" r="24" fill="url(#userGrad)" stroke="#60a5fa" stroke-width="2"/>
    <!-- User Icon -->
    <circle cx="25" cy="18" r="7" fill="#ffffff"/>
    <path d="M 14 36 Q 25 27 36 36 Z" fill="#ffffff"/>
    <text x="60" y="23" fill="#f8fafc" font-size="14" font-weight="700">Human User</text>
    <text x="60" y="38" fill="#94a3b8" font-size="11">Initiates Mandates &amp; Goals</text>
  </g>

  <!-- ======================================================== -->
  <!-- 1. USER CONSOLE CONTAINER (P1)                           -->
  <!-- ======================================================== -->
  <rect x="30" y="180" width="490" height="250" rx="14" fill="#0b1329" stroke="#1e3a8a" stroke-width="1.5"/>
  <rect x="30" y="180" width="490" height="34" rx="14" fill="#1e293b"/>
  <rect x="30" y="200" width="490" height="14" fill="#1e293b"/>
  <text x="45" y="203" fill="#93c5fd" font-size="12" font-weight="700">User Console (Client Layer - P1)</text>
  <text x="505" y="203" fill="#64748b" font-size="11" text-anchor="end">/client</text>

  <!-- Console Shell [App.tsx] -->
  <rect x="180" y="225" width="180" height="38" rx="8" fill="#1e293b" stroke="#3b82f6" stroke-width="1.2"/>
  <text x="270" y="244" fill="#ffffff" font-size="12" font-weight="700" text-anchor="middle">Console Shell</text>
  <text x="270" y="256" fill="#94a3b8" font-size="10" font-family="monospace" text-anchor="middle">[App.tsx]</text>

  <!-- 4 Rendered Subcomponents -->
  <!-- Mandate Manager -->
  <rect x="42" y="320" width="108" height="52" rx="8" fill="#111c44" stroke="#38bdf8" stroke-width="1.2"/>
  <text x="96" y="341" fill="#e0f2fe" font-size="11" font-weight="700" text-anchor="middle">Mandate Mgr</text>
  <text x="96" y="356" fill="#7dd3fc" font-size="9" font-family="monospace" text-anchor="middle">[MandateManager.tsx]</text>

  <!-- Ledger Dashboard -->
  <rect x="160" y="320" width="108" height="52" rx="8" fill="#111c44" stroke="#818cf8" stroke-width="1.2"/>
  <text x="214" y="341" fill="#e0e7ff" font-size="11" font-weight="700" text-anchor="middle">Ledger Dash</text>
  <text x="214" y="356" fill="#a5b4fc" font-size="9" font-family="monospace" text-anchor="middle">[LedgerGrid.tsx]</text>

  <!-- Biometric Approval -->
  <rect x="278" y="320" width="112" height="52" rx="8" fill="#111c44" stroke="#c084fc" stroke-width="1.2"/>
  <text x="334" y="341" fill="#fae8ff" font-size="11" font-weight="700" text-anchor="middle">Biometric Appr</text>
  <text x="334" y="356" fill="#e879f9" font-size="9" font-family="monospace" text-anchor="middle">[BiometricModal.tsx]</text>

  <!-- Goal Chat -->
  <rect x="400" y="320" width="108" height="52" rx="8" fill="#111c44" stroke="#f472b6" stroke-width="1.2"/>
  <text x="454" y="341" fill="#fdf2f8" font-size="11" font-weight="700" text-anchor="middle">Goal Chat</text>
  <text x="454" y="356" fill="#f472b6" font-size="9" font-family="monospace" text-anchor="middle">[AgentGoalChat.tsx]</text>

  <!-- Console Shell -> Component connectors -->
  <path d="M 215 263 L 215 295 L 96 295 L 96 320" fill="none" stroke="#475569" stroke-width="1.2" marker-end="url(#arrow)"/>
  <path d="M 245 263 L 245 320" fill="none" stroke="#475569" stroke-width="1.2" marker-end="url(#arrow)"/>
  <path d="M 295 263 L 295 320" fill="none" stroke="#475569" stroke-width="1.2" marker-end="url(#arrow)"/>
  <path d="M 325 263 L 325 295 L 454 295 L 454 320" fill="none" stroke="#475569" stroke-width="1.2" marker-end="url(#arrow)"/>

  <!-- ======================================================== -->
  <!-- 2. SHARED CONTRACTS CONTAINER                            -->
  <!-- ======================================================== -->
  <rect x="30" y="465" width="135" height="65" rx="10" fill="#082f49" stroke="#0284c7" stroke-width="1.2"/>
  <text x="97" y="488" fill="#bae6fd" font-size="11" font-weight="700" text-anchor="middle">Canonical Crypto</text>
  <text x="97" y="504" fill="#38bdf8" font-size="9.5" font-family="monospace" text-anchor="middle">[crypto.ts]</text>
  <text x="97" y="519" fill="#64748b" font-size="8.5" text-anchor="middle">/shared/src/crypto.ts</text>

  <!-- Mandate Manager -> Canonical Crypto -->
  <path d="M 96 372 L 96 465" fill="none" stroke="#38bdf8" stroke-width="1.4" marker-end="url(#arrow-blue)"/>
  <text x="103" y="425" fill="#38bdf8" font-size="9" font-weight="600">canonicalizes mandate</text>

  <!-- ======================================================== -->
  <!-- 3. SHOPPING AGENT CONTAINER (P2)                         -->
  <!-- ======================================================== -->
  <rect x="545" y="180" width="545" height="520" rx="14" fill="#1c1307" stroke="#b45309" stroke-width="1.5"/>
  <rect x="545" y="180" width="545" height="34" rx="14" fill="#291804"/>
  <rect x="545" y="200" width="545" height="14" fill="#291804"/>
  <text x="560" y="203" fill="#fde68a" font-size="12" font-weight="700">Shopping Agent (Cognitive Layer - P2)</text>
  <text x="1075" y="203" fill="#b45309" font-size="11" text-anchor="end">/agent</text>

  <!-- Shopping Planner [planner.ts] -->
  <rect x="710" y="230" width="200" height="42" rx="8" fill="#291e0a" stroke="#f59e0b" stroke-width="1.4"/>
  <text x="810" y="250" fill="#fef3c7" font-size="12" font-weight="700" text-anchor="middle">Shopping Planner</text>
  <text x="810" y="263" fill="#fbbf24" font-size="10" font-family="monospace" text-anchor="middle">[planner.ts]</text>

  <!-- Gemini Planner [geminiPlanner.ts] -->
  <rect x="710" y="305" width="200" height="42" rx="8" fill="#3b2308" stroke="#f59e0b" stroke-width="1.4"/>
  <text x="810" y="325" fill="#fef3c7" font-size="12" font-weight="700" text-anchor="middle">Gemini Planner (3.8 Flash)</text>
  <text x="810" y="338" fill="#fbbf24" font-size="10" font-family="monospace" text-anchor="middle">[geminiPlanner.ts]</text>

  <!-- Planner -> Gemini Planner connector -->
  <path d="M 810 272 L 810 305" fill="none" stroke="#fbbf24" stroke-width="1.4" marker-end="url(#arrow-amber)"/>
  <text x="815" y="292" fill="#fbbf24" font-size="9" font-weight="600">delegates planning</text>

  <!-- 4 Dispatched Tools -->
  <!-- Cart Builder -->
  <rect x="560" y="390" width="118" height="46" rx="7" fill="#2d1c08" stroke="#fbbf24" stroke-width="1.2"/>
  <text x="619" y="410" fill="#fef3c7" font-size="10.5" font-weight="700" text-anchor="middle">Cart Builder</text>
  <text x="619" y="424" fill="#f59e0b" font-size="9" font-family="monospace" text-anchor="middle">[buildCart.ts]</text>

  <!-- Product Details -->
  <rect x="690" y="390" width="118" height="46" rx="7" fill="#2d1c08" stroke="#fbbf24" stroke-width="1.2"/>
  <text x="749" y="410" fill="#fef3c7" font-size="10.5" font-weight="700" text-anchor="middle">Product Details</text>
  <text x="749" y="424" fill="#f59e0b" font-size="9" font-family="monospace" text-anchor="middle">[getProductDetails.ts]</text>

  <!-- Product Search -->
  <rect x="820" y="390" width="122" height="46" rx="7" fill="#2d1c08" stroke="#fbbf24" stroke-width="1.2"/>
  <text x="881" y="410" fill="#fef3c7" font-size="10.5" font-weight="700" text-anchor="middle">Product Search</text>
  <text x="881" y="424" fill="#f59e0b" font-size="9" font-family="monospace" text-anchor="middle">[searchProducts.ts]</text>

  <!-- Intent Submission -->
  <rect x="955" y="390" width="122" height="46" rx="7" fill="#2d1c08" stroke="#fbbf24" stroke-width="1.2"/>
  <text x="1016" y="410" fill="#fef3c7" font-size="10.5" font-weight="700" text-anchor="middle">Intent Submit</text>
  <text x="1016" y="424" fill="#f59e0b" font-size="9" font-family="monospace" text-anchor="middle">[submitIntent.ts]</text>

  <!-- Gemini Planner dispatches tool connectors -->
  <path d="M 735 347 L 735 370 L 619 370 L 619 390" fill="none" stroke="#d97706" stroke-width="1.2" marker-end="url(#arrow-amber)"/>
  <path d="M 770 347 L 770 390" fill="none" stroke="#d97706" stroke-width="1.2" marker-end="url(#arrow-amber)"/>
  <path d="M 850 347 L 850 390" fill="none" stroke="#d97706" stroke-width="1.2" marker-end="url(#arrow-amber)"/>
  <path d="M 885 347 L 885 370 L 1016 370 L 1016 390" fill="none" stroke="#d97706" stroke-width="1.2" marker-end="url(#arrow-amber)"/>

  <!-- Catalog Search [storeService.ts] -->
  <rect x="690" y="480" width="248" height="46" rx="8" fill="#38240b" stroke="#f59e0b" stroke-width="1.3"/>
  <text x="814" y="500" fill="#fef3c7" font-size="12" font-weight="700" text-anchor="middle">Catalog Search (Vector + Keyword)</text>
  <text x="814" y="514" fill="#fbbf24" font-size="10" font-family="monospace" text-anchor="middle">[storeService.ts &amp; semanticSearch.ts]</text>

  <!-- Tools -> Catalog Search -->
  <path d="M 619 436 L 619 458 L 740 458 L 740 480" fill="none" stroke="#b45309" stroke-width="1.2" marker-end="url(#arrow-amber)"/>
  <text x="635" y="453" fill="#f59e0b" font-size="8.5">adds products</text>
  <path d="M 749 436 L 749 480" fill="none" stroke="#b45309" stroke-width="1.2" marker-end="url(#arrow-amber)"/>
  <text x="754" y="465" fill="#f59e0b" font-size="8.5">gets product</text>
  <path d="M 881 436 L 881 480" fill="none" stroke="#b45309" stroke-width="1.2" marker-end="url(#arrow-amber)"/>
  <text x="886" y="465" fill="#f59e0b" font-size="8.5">searches</text>

  <!-- Product Catalog [products.ts] Cylinder / DB -->
  <rect x="740" y="565" width="150" height="46" rx="8" fill="#241403" stroke="#f59e0b" stroke-width="1.2"/>
  <text x="815" y="585" fill="#fef3c7" font-size="11.5" font-weight="700" text-anchor="middle">Product Catalog</text>
  <text x="815" y="599" fill="#fbbf24" font-size="9.5" font-family="monospace" text-anchor="middle">[products.ts]</text>

  <!-- Catalog Search -> Product Catalog -->
  <path d="M 814 526 L 814 565" fill="none" stroke="#b45309" stroke-width="1.2" marker-end="url(#arrow-amber)"/>
  <text x="820" y="548" fill="#f59e0b" font-size="9">reads products</text>

  <!-- Goal Chat -> Shopping Planner -->
  <path d="M 508 346 L 620 346 L 620 251 L 710 251" fill="none" stroke="#f472b6" stroke-width="1.4" marker-end="url(#arrow)"/>
  <text x="545" y="244" fill="#f472b6" font-size="9.5" font-weight="600">requests plan</text>

  <!-- ======================================================== -->
  <!-- 4. POLICY GATEWAY CONTAINER (P3)                         -->
  <!-- ======================================================== -->
  <rect x="230" y="660" width="350" height="235" rx="14" fill="#042118" stroke="#059669" stroke-width="1.5"/>
  <rect x="230" y="660" width="350" height="34" rx="14" fill="#064e3b"/>
  <rect x="230" y="680" width="350" height="14" fill="#064e3b"/>
  <text x="245" y="683" fill="#a7f3d0" font-size="12" font-weight="700">Policy Gateway (Deterministic Trust Boundary - P3)</text>
  <text x="565" y="683" fill="#34d399" font-size="11" text-anchor="end">/gateway</text>

  <!-- Gateway API [server.ts] -->
  <rect x="310" y="705" width="190" height="42" rx="8" fill="#064e3b" stroke="#34d399" stroke-width="1.3"/>
  <text x="405" y="725" fill="#ffffff" font-size="12" font-weight="700" text-anchor="middle">Gateway API (Port 3000)</text>
  <text x="405" y="738" fill="#6ee7b7" font-size="10" font-family="monospace" text-anchor="middle">[server.ts]</text>

  <!-- Signature Verifier & Policy Engine -->
  <rect x="245" y="785" width="150" height="48" rx="8" fill="#022c22" stroke="#10b981" stroke-width="1.2"/>
  <text x="320" y="805" fill="#ecfdf5" font-size="11" font-weight="700" text-anchor="middle">Signature Verifier</text>
  <text x="320" y="820" fill="#6ee7b7" font-size="9.5" font-family="monospace" text-anchor="middle">[pqcVerifier.ts (ML-DSA)]</text>

  <rect x="415" y="785" width="150" height="48" rx="8" fill="#022c22" stroke="#10b981" stroke-width="1.2"/>
  <text x="490" y="805" fill="#ecfdf5" font-size="11" font-weight="700" text-anchor="middle">Policy Engine</text>
  <text x="490" y="820" fill="#6ee7b7" font-size="9.5" font-family="monospace" text-anchor="middle">[policyEngine.ts]</text>

  <path d="M 370 747 L 370 765 L 320 765 L 320 785" fill="none" stroke="#10b981" stroke-width="1.2" marker-end="url(#arrow-green)"/>
  <text x="325" y="776" fill="#6ee7b7" font-size="8.5">verifies signature</text>
  <path d="M 440 747 L 440 765 L 490 765 L 490 785" fill="none" stroke="#10b981" stroke-width="1.2" marker-end="url(#arrow-green)"/>
  <text x="445" y="776" fill="#6ee7b7" font-size="8.5">validates intent</text>

  <!-- Mandate Manager -> Gateway API (registers mandate) -->
  <path d="M 96 372 L 96 640 L 350 640 L 350 705" fill="none" stroke="#38bdf8" stroke-width="1.3" marker-end="url(#arrow-blue)"/>
  <text x="105" y="632" fill="#38bdf8" font-size="9.5" font-weight="600">registers mandate (POST /mandates)</text>

  <!-- Intent Submit (P2) -> Gateway API (P3) -->
  <path d="M 1016 436 L 1016 726 L 500 726" fill="none" stroke="#fbbf24" stroke-width="1.5" marker-end="url(#arrow-amber)"/>
  <text x="750" y="720" fill="#fbbf24" font-size="10" font-weight="700">posts intent (POST /intents)</text>

  <!-- Gateway API -> Biometric Approval (requests approval) -->
  <path d="M 390 705 L 390 560 L 350 560 L 350 372" fill="none" stroke="#c084fc" stroke-width="1.2" stroke-dasharray="4" marker-end="url(#arrow-purple)"/>
  <text x="260" y="552" fill="#c084fc" font-size="9">Tier 2 requests approval (202)</text>

  <!-- Biometric Approval -> Gateway API (confirms intent) -->
  <path d="M 330 372 L 330 580 L 410 580 L 410 705" fill="none" stroke="#c084fc" stroke-width="1.2" marker-end="url(#arrow-purple)"/>
  <text x="338" y="594" fill="#c084fc" font-size="9">confirms intent (POST /confirm)</text>

  <!-- Gateway -> Ledger Dash (streams events) -->
  <path d="M 310 730 L 214 730 L 214 372" fill="none" stroke="#818cf8" stroke-width="1.2" stroke-dasharray="4" marker-end="url(#arrow)"/>
  <text x="220" y="650" fill="#818cf8" font-size="9">telemetry</text>

  <!-- ======================================================== -->
  <!-- 5. PAYMENTS AND LEDGER CONTAINER (P4)                    -->
  <!-- ======================================================== -->
  <rect x="230" y="930" width="350" height="210" rx="14" fill="#20060d" stroke="#e11d48" stroke-width="1.5"/>
  <rect x="230" y="930" width="350" height="34" rx="14" fill="#4c0519"/>
  <rect x="230" y="950" width="350" height="14" fill="#4c0519"/>
  <text x="245" y="953" fill="#fecdd3" font-size="12" font-weight="700">Payments and Ledger (Settlement Layer - P4)</text>
  <text x="565" y="953" fill="#f43f5e" font-size="11" text-anchor="end">/payments</text>

  <!-- Payments API [server.ts] -->
  <rect x="310" y="975" width="190" height="40" rx="8" fill="#881337" stroke="#fb7185" stroke-width="1.3"/>
  <text x="405" y="995" fill="#ffffff" font-size="12" font-weight="700" text-anchor="middle">Payments API (Port 5000)</text>
  <text x="405" y="1008" fill="#fda4af" font-size="10" font-family="monospace" text-anchor="middle">[server.ts]</text>

  <!-- Gateway API -> Payments API -->
  <path d="M 405 747 L 405 975" fill="none" stroke="#34d399" stroke-width="1.5" marker-end="url(#arrow-green)"/>
  <text x="412" y="915" fill="#34d399" font-size="9.5" font-weight="600">routes authorized commerce</text>

  <!-- PayPal Client & Event Ledger -->
  <rect x="245" y="1045" width="150" height="48" rx="8" fill="#4c0519" stroke="#f43f5e" stroke-width="1.2"/>
  <text x="320" y="1065" fill="#fff1f2" font-size="11" font-weight="700" text-anchor="middle">PayPal Client</text>
  <text x="320" y="1080" fill="#fda4af" font-size="9.5" font-family="monospace" text-anchor="middle">[paypalClient.ts (v2)]</text>

  <rect x="415" y="1045" width="150" height="48" rx="8" fill="#4c0519" stroke="#f43f5e" stroke-width="1.2"/>
  <text x="490" y="1065" fill="#fff1f2" font-size="11" font-weight="700" text-anchor="middle">Event Ledger</text>
  <text x="490" y="1080" fill="#fda4af" font-size="9.5" font-family="monospace" text-anchor="middle">[ledger.ts (SHA-256)]</text>

  <path d="M 370 1015 L 370 1030 L 320 1030 L 320 1045" fill="none" stroke="#f43f5e" stroke-width="1.2" marker-end="url(#arrow-red)"/>
  <text x="325" y="1040" fill="#fda4af" font-size="8.5">captures order</text>
  <path d="M 440 1015 L 440 1030 L 490 1030 L 490 1045" fill="none" stroke="#f43f5e" stroke-width="1.2" marker-end="url(#arrow-red)"/>
  <text x="445" y="1040" fill="#fda4af" font-size="8.5">appends events</text>

  <!-- Event Ledger -> Ledger Dashboard (SSE stream) -->
  <path d="M 565 1070 L 610 1070 L 610 346 L 268 346" fill="none" stroke="#818cf8" stroke-width="1.3" stroke-dasharray="4" marker-end="url(#arrow)"/>
  <text x="618" y="700" fill="#818cf8" font-size="9.5" font-weight="600">streams events (SSE /ledger/stream)</text>

  <!-- ======================================================== -->
  <!-- 6. PAYPAL RAILS PILL (BOTTOM)                            -->
  <!-- ======================================================== -->
  <rect x="235" y="1185" width="170" height="48" rx="24" fill="url(#paypalGrad)" stroke="#60a5fa" stroke-width="1.5"/>
  <text x="320" y="1208" fill="#ffffff" font-size="13" font-weight="800" text-anchor="middle">PayPal Rails</text>
  <text x="320" y="1222" fill="#bae6fd" font-size="9.5" text-anchor="middle">Orders v2 &amp; Vault API</text>

  <path d="M 320 1093 L 320 1185" fill="none" stroke="#38bdf8" stroke-width="1.5" marker-end="url(#arrow-blue)"/>
  <text x="328" y="1145" fill="#38bdf8" font-size="9.5" font-weight="600">calls API</text>

  <!-- Human User -> Mandate Manager -->
  <path d="M 240 135 L 96 135 L 96 320" fill="none" stroke="#38bdf8" stroke-width="1.4" marker-end="url(#arrow-blue)"/>
  <text x="110" y="128" fill="#38bdf8" font-size="9.5" font-weight="600">sets mandate (NIST PQC)</text>

  <!-- Human User -> Goal Chat -->
  <path d="M 310 135 L 454 135 L 454 320" fill="none" stroke="#f472b6" stroke-width="1.4" marker-end="url(#arrow)"/>
  <text x="330" y="128" fill="#f472b6" font-size="9.5" font-weight="600">sets goal</text>
</svg>
"""
    return svg_content

if __name__ == "__main__":
    out_svg = os.path.join(os.path.dirname(__file__), "architecture-diagram.svg")
    content = generate_svg()
    with open(out_svg, "w", encoding="utf-8") as f:
        f.write(content)
    print("Generated SVG at:", out_svg)

