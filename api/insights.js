/**
 * Signal — AI Insights Serverless Function
 *
 * POST /api/insights
 * Body: { regionId: string, properties: object }
 *
 * Streams a Gemini market analysis as Server-Sent Events.
 * Detects market (au / uk) from properties.market and uses the appropriate prompt.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const ANZSIC_SHORT = {
  A: 'Agriculture', B: 'Mining', C: 'Manufacturing', D: 'Utilities',
  E: 'Construction', F: 'Wholesale', G: 'Retail', H: 'Accommodation',
  I: 'Transport', J: 'Info & Media', K: 'Finance', L: 'Real Estate',
  M: 'Prof Services', N: 'Admin & Support', O: 'Public Admin',
  P: 'Education', Q: 'Healthcare', R: 'Arts & Recreation', S: 'Other',
};

const UK_SIC_SHORT = {
  A: 'Agriculture', B: 'Mining', C: 'Manufacturing', D: 'Utilities',
  E: 'Water & Waste', F: 'Construction', G: 'Wholesale & Retail',
  H: 'Transport', I: 'Accommodation', J: 'Info & Comm', K: 'Finance',
  L: 'Real Estate', M: 'Prof Services', N: 'Admin & Support', O: 'Public Admin',
  P: 'Education', Q: 'Healthcare', R: 'Arts & Recreation', S: 'Other Services',
  T: 'Households', U: 'Extraterritorial',
};

function buildBusinessPrompt(p) {
  const shortLabels  = p.market === 'uk' ? UK_SIC_SHORT : ANZSIC_SHORT;
  const locale       = p.market === 'uk' ? 'en-GB' : 'en-AU';
  const isUk         = p.market === 'uk';
  const regionType   = isUk ? 'Local Authority District (LAD) — ONS Census 2021' : 'Statistical Area 4 (SA4) — ABS Census 2021';
  const country      = isUk ? 'the United Kingdom' : 'Australia';

  const topIndustries = p.industry_distribution
    ? Object.entries(p.industry_distribution)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 7)
        .map(([code, count]) => {
          const pct = p.working_population > 0
            ? ((count / p.working_population) * 100).toFixed(1) : '?';
          return `  ${shortLabels[code] ?? code}: ${count.toLocaleString(locale)} workers (${pct}%)`;
        })
        .join('\n')
    : '  Not available';

  const bizInfo = p.total_businesses != null
    ? `${p.total_businesses.toLocaleString(locale)} total businesses (${p.business_density ?? '?'}/km²)`
    : 'Not available (use working population as proxy)';

  const ukCompetitiveContext = isUk
    ? `\nCOMPETITIVE CONTEXT: The UK business broadband market is dominated by BT/EE, Virgin Media O2, Sky Business, and TalkTalk Business. Openreach wholesale (FTTP) and City Fibre full-fibre networks are expanding. SMEs are moving from legacy ADSL/FTTC to full-fibre and SoGEA services. PSTN/ISDN switch-off (2025–2027) is driving VoIP upgrades.`
    : '';

  return `You are a business development analyst helping a telecommunications company identify and prioritise business broadband sales opportunities in ${country}.

The product targets small-to-medium enterprises (SMEs) that need reliable, high-performance internet for cloud applications, VoIP, video conferencing, and data-intensive workflows.

Analyse the following ${isUk ? 'LAD' : 'SA4'} region and provide actionable intelligence for a business broadband sales team.

REGION: ${p.name} (${p.state_code})
TYPE: ${regionType}${ukCompetitiveContext}

BUSINESS LANDSCAPE
  Working Population (employed in this area): ${p.working_population?.toLocaleString(locale) ?? 'N/A'}
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

BUSINESS OPPORTUNITY SCORE: ${p.smartbiz_score ?? 'N/A'}/100
  Score Components:
  - Industry Mix: ${p.industry_mix_component ?? 'N/A'}/100
  - High-Value Sectors: ${p.high_value_component ?? 'N/A'}/100
  - Business Density: ${p.wp_density_component ?? 'N/A'}/100

Write 3 concise paragraphs (no headings, no bullet points, no markdown):
1. Business landscape — what industries dominate, what this means for broadband demand and suitability.
2. Priority target segments — which specific business types and sectors to focus sales efforts on and why.
3. Sales approach — how to position for this market, relevant use cases, partnership channels, or competitive angles.

Keep the tone direct and analytical. Cite specific statistics. Focus on actionable intelligence for a field sales team.`;
}

function buildPrompt(p) {
  const isUk          = p.market === 'uk';
  const locale        = isUk ? 'en-GB' : 'en-AU';
  const country       = isUk ? 'the United Kingdom' : 'Australia';
  const regionType    = isUk ? 'Local Authority District (LAD) — ONS Census 2021'
                              : 'Statistical Area 4 (SA4) — ABS Census 2021';
  const homeOwnership = ((p.owned_outright_pct ?? 0) + (p.owned_mortgage_pct ?? 0)).toFixed(0);

  const incomeBlock = isUk
    ? `SOCIOECONOMIC PROFILE (NS-SeC proxy for income)
  Professional/Managerial (classes 1–2): ${p.professional_pct?.toFixed(1) ?? 'N/A'}%
  ${p.income_distribution
    ? Object.entries(p.income_distribution).map(([k, v]) => `  ${k}: ${v}%`).join('\n  ')
    : '  Not available'}`
    : `INCOME DISTRIBUTION (annual)
  ${p.income_distribution
    ? Object.entries(p.income_distribution).map(([k, v]) => `${k}: ${v}%`).join(', ')
    : 'not available'}
  Avg Annual Income: AU$${p.median_household_income_weekly
    ? Math.round(p.median_household_income_weekly * 52 / 1000) + 'k'
    : 'unknown'}`;

  const topAgeBracket = p.age_distribution
    ? Object.entries(p.age_distribution).sort((a, b) => b[1] - a[1])[0]?.[0]
    : null;

  const ukContext = isUk
    ? `\nCOMPETITIVE CONTEXT: UK residential broadband market includes BT/EE, Virgin Media, Sky, TalkTalk, and a growing tier of challenger ISPs (Hyperoptic, Trooli, Gigaclear, etc.). Openreach FTTP and CityFibre are the main wholesale full-fibre networks. Government Gigabit Voucher Scheme (up to £4,500 for premises) is active in hard-to-reach areas. PSTN switch-off deadline is December 2027.`
    : '';

  return `You are a market analyst helping a broadband internet service provider (ISP) evaluate expansion opportunities in ${country}.

Analyse the following region and provide actionable market intelligence for an ISP sales team.

REGION: ${p.name} (${p.state_code})
TYPE: ${regionType}${ukContext}

MARKET OVERVIEW
  Households: ${p.dwelling_count?.toLocaleString(locale) ?? 'N/A'}
  Population: ${p.population?.toLocaleString(locale) ?? 'N/A'}
  Median Age: ${p.median_age ?? 'N/A'} years${topAgeBracket ? ` (dominant bracket: ${topAgeBracket})` : ''}
  Population Density: ${p.population_density_per_sqkm?.toFixed(0) ?? 'N/A'}/km²

DWELLING PROFILE
  Detached Houses: ${p.detached_pct?.toFixed(0) ?? p.separate_house_pct?.toFixed(0) ?? 'N/A'}%
  ${isUk ? `Semi-Detached: ${p.semi_detached_pct?.toFixed(0) ?? 'N/A'}%\n  Terraced: ${p.terraced_pct?.toFixed(0) ?? 'N/A'}%` : `Single Family Homes: ${p.separate_house_pct?.toFixed(0) ?? 'N/A'}%`}
  Apartments/Flats: ${p.apartment_pct?.toFixed(0) ?? 'N/A'}%
  Home Ownership: ${homeOwnership}%
  Renters: ${p.renting_pct?.toFixed(0) ?? 'N/A'}%

CONNECTIVITY & OPPORTUNITY
  Families with Children: ${p.households_with_children_pct?.toFixed(0) ?? 'N/A'}%
  Elderly (65+): ${p.elderly_pct?.toFixed(0) ?? 'N/A'}%
  Youth (0–19): ${p.youth_pct?.toFixed(0) ?? 'N/A'}%

${incomeBlock}

SIGNAL OPPORTUNITY SCORE: ${p.opportunity_score ?? 'N/A'}/100
  Score Components:
  - ${isUk ? 'Socioeconomic Level' : 'Income Level'}: ${p.income_component ?? 'N/A'}/100
  - Families with Children: ${p.children_component ?? 'N/A'}/100
  - Home Ownership: ${p.ownership_component ?? 'N/A'}/100
  - Population Density: ${p.density_component ?? 'N/A'}/100

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
