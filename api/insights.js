/**
 * Signal — AI Insights Serverless Function
 *
 * POST /api/insights
 * Body: { regionId: string, properties: object }
 *
 * Streams a Gemini market analysis as Server-Sent Events.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const ANZSIC_SHORT = {
  A: 'Agriculture', B: 'Mining', C: 'Manufacturing', D: 'Utilities',
  E: 'Construction', F: 'Wholesale', G: 'Retail', H: 'Accommodation',
  I: 'Transport', J: 'Info & Media', K: 'Finance', L: 'Real Estate',
  M: 'Prof Services', N: 'Admin & Support', O: 'Public Admin',
  P: 'Education', Q: 'Healthcare', R: 'Arts & Recreation', S: 'Other',
};

function buildBusinessPrompt(p) {
  const topIndustries = p.industry_distribution
    ? Object.entries(p.industry_distribution)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 7)
        .map(([code, count]) => {
          const pct = p.working_population > 0
            ? ((count / p.working_population) * 100).toFixed(1) : '?';
          return `  ${ANZSIC_SHORT[code] ?? code}: ${count.toLocaleString('en-AU')} workers (${pct}%)`;
        })
        .join('\n')
    : '  Not available';

  const bizInfo = p.total_businesses != null
    ? `${p.total_businesses.toLocaleString('en-AU')} total businesses (${p.business_density ?? '?'}/km²)`
    : 'Not available (use working population as proxy)';

  return `You are a business development analyst helping a telecommunications company identify and prioritise Calix SmartBiz sales opportunities in Australia.

SmartBiz is a managed business broadband product targeting small-to-medium enterprises (SMEs) that need reliable, high-performance internet for cloud applications, VoIP, video conferencing, and data-intensive workflows.

Analyse the following SA4 region and provide actionable intelligence for a SmartBiz sales team.

REGION: ${p.name} (${p.state_code})
TYPE: Statistical Area 4 (SA4) — ABS Census 2021 Working Population Profile

BUSINESS LANDSCAPE
  Working Population (employed in this area): ${p.working_population?.toLocaleString('en-AU') ?? 'N/A'}
  Worker Density: ${p.working_pop_density ?? 'N/A'}/km²
  Business Count: ${bizInfo}

TOP INDUSTRIES BY WORKERS:
${topIndustries}

KEY SECTOR CONCENTRATIONS
  Knowledge Workers (Finance, IT, Professional, Healthcare, Education): ${p.knowledge_worker_pct?.toFixed(1) ?? 'N/A'}%
  Healthcare & Social Assistance: ${p.healthcare_pct?.toFixed(1) ?? 'N/A'}%
  Professional & Technical Services: ${p.professional_services_pct?.toFixed(1) ?? 'N/A'}%
  Finance & Information Technology: ${p.finance_tech_pct?.toFixed(1) ?? 'N/A'}%
  Retail Trade: ${p.retail_pct?.toFixed(1) ?? 'N/A'}%
  Construction: ${p.construction_pct?.toFixed(1) ?? 'N/A'}%

SMARTBIZ OPPORTUNITY SCORE: ${p.smartbiz_score ?? 'N/A'}/100
  Score Components:
  - Industry Mix: ${p.industry_mix_component ?? 'N/A'}/100
  - High-Value Sectors: ${p.high_value_component ?? 'N/A'}/100
  - Business Density: ${p.wp_density_component ?? 'N/A'}/100

Write 3 concise paragraphs (no headings, no bullet points, no markdown):
1. Business landscape — what industries dominate, what this means for broadband demand and SmartBiz suitability.
2. Priority target segments — which specific business types and sectors to focus SmartBiz sales efforts on and why.
3. Sales approach — how to position SmartBiz for this market, relevant use cases, partnership channels, or competitive angles.

Keep the tone direct and analytical. Cite specific statistics. Focus on actionable intelligence for a field sales team.`;
}

function buildPrompt(p) {
  const homeOwnership = ((p.owned_outright_pct ?? 0) + (p.owned_mortgage_pct ?? 0)).toFixed(0);
  const annualIncome = p.median_household_income_weekly
    ? `AU$${Math.round(p.median_household_income_weekly * 52 / 1000)}k`
    : 'unknown';

  const incomeDistSummary = p.income_distribution
    ? Object.entries(p.income_distribution)
        .map(([k, v]) => `${k}: ${v}%`)
        .join(', ')
    : 'not available';

  const topAgeBracket = p.age_distribution
    ? Object.entries(p.age_distribution).sort((a, b) => b[1] - a[1])[0]?.[0]
    : null;

  return `You are a market analyst helping a broadband internet service provider (ISP) evaluate expansion opportunities in Australia.

Analyse the following SA4 region and provide actionable market intelligence for an ISP sales team.

REGION: ${p.name} (${p.state_code})
TYPE: Statistical Area 4 (SA4) — ABS Census 2021 data

MARKET OVERVIEW
  Households: ${p.dwelling_count?.toLocaleString('en-AU') ?? 'N/A'}
  Population: ${p.population?.toLocaleString('en-AU') ?? 'N/A'}
  Avg Annual Income: ${annualIncome}
  Median Age: ${p.median_age ?? 'N/A'} years${topAgeBracket ? ` (dominant bracket: ${topAgeBracket})` : ''}
  Population Density: ${p.population_density_per_sqkm?.toFixed(0) ?? 'N/A'}/km²

DWELLING PROFILE
  Single Family Homes: ${p.separate_house_pct?.toFixed(0) ?? 'N/A'}%
  Apartments/Flats: ${p.apartment_pct?.toFixed(0) ?? 'N/A'}%
  Home Ownership: ${homeOwnership}%
  Renters: ${p.renting_pct?.toFixed(0) ?? 'N/A'}%

CONNECTIVITY & OPPORTUNITY
  Current Internet Access: ${p.internet_access_pct?.toFixed(0) ?? 'N/A'}%
  Families with Children: ${p.households_with_children_pct?.toFixed(0) ?? 'N/A'}%
  Elderly (65+): ${p.elderly_pct?.toFixed(0) ?? 'N/A'}%
  Youth (0–19): ${p.youth_pct?.toFixed(0) ?? 'N/A'}%

INCOME DISTRIBUTION (annual)
  ${incomeDistSummary}

SIGNAL OPPORTUNITY SCORE: ${p.opportunity_score ?? 'N/A'}/100
  Score Components:
  - Income Level: ${p.income_component ?? 'N/A'}/100
  - Underserved Market: ${p.competition_component ?? 'N/A'}/100
  - Families with Children: ${p.children_component ?? 'N/A'}/100
  - Home Ownership: ${p.ownership_component ?? 'N/A'}/100

Write 3 concise paragraphs (no headings, no bullet points, no markdown):
1. Overall market assessment — what makes this region attractive (or not) for broadband expansion.
2. Key customer segments to target and why — reference specific demographics from the data.
3. Recommended approach — pricing tiers, product bundles, or community angles most likely to succeed.

Keep the tone direct and analytical. Cite specific statistics. Avoid generic statements.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { properties } = body ?? {};
  if (!properties) {
    return res.status(400).json({ error: 'Missing properties field' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        maxOutputTokens: 1200,
        temperature: 0.7,
      },
    });

    const isBusiness = properties.smartbiz_score != null;
  const prompt = isBusiness ? buildBusinessPrompt(properties) : buildPrompt(properties);
    const result = await model.generateContentStream(prompt);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        res.write(`data: ${JSON.stringify({ delta: text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Gemini error:', err);
    const msg = err.message || 'Failed to generate insights';
    if (!res.headersSent) {
      res.status(500).json({ error: msg });
    } else {
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
    }
  }
}
