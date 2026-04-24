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

const NAICS_SHORT = {
  '11': 'Agriculture', '21': 'Mining & O&G', '22': 'Utilities', '23': 'Construction',
  '31-33': 'Manufacturing', '41': 'Wholesale', '44-45': 'Retail', '48-49': 'Transport',
  '51': 'Info & Media', '52': 'Finance', '53': 'Real Estate', '54': 'Prof Services',
  '55': 'Management', '56': 'Admin & Support', '61': 'Education', '62': 'Healthcare',
  '71': 'Arts & Rec', '72': 'Accommodation', '81': 'Other Services', '91': 'Public Admin',
};

const ANZSIC_SHORT = {
  A: 'Agriculture', B: 'Mining', C: 'Manufacturing', D: 'Utilities',
  E: 'Construction', F: 'Wholesale', G: 'Retail', H: 'Accommodation',
  I: 'Transport', J: 'Info & Media', K: 'Finance', L: 'Real Estate',
  M: 'Prof Services', N: 'Admin & Support', O: 'Public Admin',
  P: 'Education', Q: 'Healthcare', R: 'Arts & Recreation', S: 'Other',
};

const ZA_ISIC_SHORT = {
  A: 'Agriculture', B: 'Mining', C: 'Manufacturing', D: 'Electricity',
  E: 'Water & Waste', F: 'Construction', G: 'Wholesale & Retail',
  H: 'Transport', I: 'Accommodation', J: 'Info & Comm', K: 'Finance',
  L: 'Real Estate', M: 'Prof Services', N: 'Admin & Support', O: 'Public Admin',
  P: 'Education', Q: 'Healthcare', R: 'Arts & Rec', S: 'Other Services',
  T: 'Private Households',
};

const UK_SIC_SHORT = {
  A: 'Agriculture', B: 'Mining', C: 'Manufacturing', D: 'Utilities',
  E: 'Water & Waste', F: 'Construction', G: 'Wholesale & Retail',
  H: 'Transport', I: 'Accommodation', J: 'Info & Comm', K: 'Finance',
  L: 'Real Estate', M: 'Prof Services', N: 'Admin & Support', O: 'Public Admin',
  P: 'Education', Q: 'Healthcare', R: 'Arts & Recreation', S: 'Other Services',
  T: 'Households', U: 'Extraterritorial',
};

function buildCaPrompt(p) {
  const homeOwnership = (p.owned_pct ?? 0).toFixed(0);
  const topAgeBracket = p.age_distribution
    ? Object.entries(p.age_distribution).sort((a, b) => b[1] - a[1])[0]?.[0]
    : null;

  const incomeBlock = `INCOME DISTRIBUTION (annual)
  ${p.income_distribution
    ? Object.entries(p.income_distribution).map(([k, v]) => `${k}: ${v}%`).join(', ')
    : 'not available'}
  Median Household Income: CA$${p.median_household_income_annual != null
    ? Math.round(p.median_household_income_annual).toLocaleString('en-CA') : 'unknown'}/yr`;

  return `You are a market analyst helping a broadband internet service provider (ISP) evaluate expansion opportunities in Canada.

Analyse the following region and provide actionable market intelligence for an ISP sales team.

REGION: ${p.name} (${p.state_code})
TYPE: Census Division — Statistics Canada Census 2021
COMPETITIVE CONTEXT: The Canadian residential broadband market is dominated by Rogers, Bell, Telus, and Shaw/Freedom (now Rogers). Regional players include Videotron (Quebec), Cogeco (Ontario/Quebec), and SaskTel (Saskatchewan). Smaller independent ISPs (TekSavvy, Start.ca, Distributel) compete on price via wholesale access. CRTC mandated wholesale fibre access is expanding competitive options. Urban areas have near-universal cable/fibre coverage; rural/remote areas rely on DSL, fixed wireless, and satellite (Starlink).

MARKET OVERVIEW
  Households: ${p.dwelling_count?.toLocaleString('en-CA') ?? 'N/A'}
  Population: ${p.population?.toLocaleString('en-CA') ?? 'N/A'}
  Median Age: ${p.median_age ?? 'N/A'} years${topAgeBracket ? ` (dominant bracket: ${topAgeBracket})` : ''}
  Population Density: ${p.population_density_per_sqkm?.toFixed(0) ?? 'N/A'}/km²

DWELLING PROFILE
  Detached Homes: ${p.detached_pct?.toFixed(0) ?? p.separate_house_pct?.toFixed(0) ?? 'N/A'}%
  Semi-Detached: ${p.semi_detached_pct?.toFixed(0) ?? 'N/A'}%
  Row/Townhouses: ${p.row_house_pct?.toFixed(0) ?? 'N/A'}%
  Apartments/Condos: ${p.apartment_pct?.toFixed(0) ?? 'N/A'}%
  Home Ownership: ${homeOwnership}%
  Renters: ${p.renting_pct?.toFixed(0) ?? 'N/A'}%

CONNECTIVITY & OPPORTUNITY
  Families with Children: ${p.households_with_children_pct?.toFixed(0) ?? 'N/A'}%
  Elderly (65+): ${p.elderly_pct?.toFixed(0) ?? 'N/A'}%
  Youth (0–19): ${p.youth_pct?.toFixed(0) ?? 'N/A'}%

${incomeBlock}

SIGNAL OPPORTUNITY SCORE: ${p.opportunity_score ?? 'N/A'}/100
  Score Components:
  - Income Level: ${p.income_component ?? 'N/A'}/100
  - Families with Children: ${p.children_component ?? 'N/A'}/100
  - Home Ownership: ${p.ownership_component ?? 'N/A'}/100
  - Population Density: ${p.density_component ?? 'N/A'}/100

Write 3 concise paragraphs (no headings, no bullet points, no markdown):
1. Overall market assessment — what makes this Census Division attractive (or not) for broadband expansion.
2. Key customer segments to target and why — reference specific demographics from the data.
3. Recommended approach — pricing tiers, product bundles, or community angles most likely to succeed in this Canadian market.

Keep the tone direct and analytical. Cite specific statistics. Avoid generic statements.`;
}

function buildCaBizPrompt(p) {
  const topIndustries = p.industry_distribution
    ? Object.entries(p.industry_distribution)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 7)
        .map(([code, count]) => {
          const pct = p.working_population > 0
            ? ((count / p.working_population) * 100).toFixed(1) : '?';
          return `  ${NAICS_SHORT[code] ?? code}: ${count.toLocaleString('en-CA')} workers (${pct}%)`;
        })
        .join('\n')
    : '  Not available';

  return `You are a business development analyst helping a telecommunications company identify and prioritise business broadband sales opportunities in Canada.

The product targets small-to-medium enterprises (SMEs) that need reliable, high-performance internet for cloud applications, VoIP, video conferencing, and data-intensive workflows.

Analyse the following Census Division and provide actionable intelligence for a business broadband sales team.

REGION: ${p.name} (${p.state_code})
TYPE: Census Division — Statistics Canada Census 2021
COMPETITIVE CONTEXT: The Canadian business broadband market is dominated by Rogers, Bell, and Telus for SMEs. Regional players include Videotron (Quebec), Cogeco (Ontario/Quebec), and SaskTel (Saskatchewan). Wholesale-based ISPs (TekSavvy, etc.) serve price-sensitive SMEs. Most urban SMEs have access to cable/fibre; rural SMEs often rely on DSL or fixed wireless. CRTC wholesale fibre obligations are improving urban competitive dynamics.

BUSINESS LANDSCAPE
  Working Population (employed in this area): ${p.working_population?.toLocaleString('en-CA') ?? 'N/A'}
  Worker Density: ${p.working_pop_density ?? 'N/A'}/km²

TOP INDUSTRIES BY WORKERS (NAICS 2017):
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
3. Sales approach — how to position for this Canadian market, relevant use cases, partnership channels, or competitive angles.

Keep the tone direct and analytical. Cite specific statistics. Focus on actionable intelligence for a field sales team.`;
}

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
    ? `EARNINGS & SOCIOECONOMIC PROFILE
  Median full-time annual gross earnings (ASHE 2023): ${p.median_annual_earnings ? `£${p.median_annual_earnings.toLocaleString('en-GB')}` : 'N/A'}
  Professional/Managerial workers (NS-SeC classes 1–2): ${p.professional_pct?.toFixed(1) ?? 'N/A'}%
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

function buildZaPrompt(p) {
  const homeOwnershipPct = ((p.owned_outright_pct ?? 0) + (p.owned_mortgage_pct ?? 0)) ||
                            (p.owned_pct ?? 0);
  const topAgeBracket = p.age_distribution
    ? Object.entries(p.age_distribution).sort((a, b) => b[1] - a[1])[0]?.[0]
    : null;

  // Note: Stats SA withheld income & industry data from Census 2022.
  // Socioeconomic status is proxied via service access rates.
  const incomeBlock = `SOCIOECONOMIC PROXY (service access — Census 2022)
  NOTE: Stats SA withheld household income data from the 2022 Census release.
  Electricity for cooking: ${p.electricity_cooking_pct?.toFixed(0) ?? 'N/A'}% (strong income proxy in SA)
  Piped water access:      ${p.piped_water_pct?.toFixed(0) ?? 'N/A'}%
  Flush toilet access:     ${p.flush_toilet_pct?.toFixed(0) ?? 'N/A'}%`;

  return `You are a market analyst helping a broadband internet service provider (ISP) evaluate expansion opportunities in South Africa.

Analyse the following region and provide actionable market intelligence for an ISP sales team.

REGION: ${p.name} (${p.state_code})
TYPE: Local Municipality — Stats SA Census 2022
COMPETITIVE CONTEXT: South Africa's residential broadband market is dominated by Telkom (DSL/fibre), Vodacom and MTN (LTE/5G home broadband), and Openserve wholesale. Rain, Herotel, Frogfoot, Vumatel, and MetroFibre are expanding FTTH footprints in metropolitan and peri-urban areas. Most rural households rely on mobile data. Fixed-line penetration is low nationally (~10%) but fibre uptake is growing rapidly in high-density urban areas. Load-shedding (loadshedding) has driven demand for reliable connectivity and backup solutions. Government's SA Connect programme targets universal broadband access by 2030.

MARKET OVERVIEW
  Households: ${p.dwelling_count?.toLocaleString('en-ZA') ?? 'N/A'}
  Population: ${p.population?.toLocaleString('en-ZA') ?? 'N/A'}
  ${topAgeBracket ? `Dominant Age Bracket: ${topAgeBracket}` : ''}
  Population Density: ${p.population_density_per_sqkm?.toFixed(0) ?? 'N/A'}/km²

DWELLING PROFILE
  Formal House (separate stand): ${p.separate_house_pct?.toFixed(0) ?? 'N/A'}%
  Flat / Apartment: ${p.apartment_pct?.toFixed(0) ?? 'N/A'}%
  Semi-Detached / Townhouse: ${p.semi_detached_pct?.toFixed(0) ?? 'N/A'}%
  Traditional Dwelling: ${p.traditional_dwelling_pct?.toFixed(0) ?? 'N/A'}%
  Informal Dwelling (shack): ${p.informal_dwelling_pct?.toFixed(0) ?? 'N/A'}%
  Total Formal Dwellings: ${p.formal_dwelling_pct?.toFixed(0) ?? 'N/A'}%
  Home Ownership: ${homeOwnershipPct.toFixed(0)}%
  Renters: ${p.renting_pct?.toFixed(0) ?? 'N/A'}%

CONNECTIVITY & OPPORTUNITY
  Families with Children: ${p.households_with_children_pct?.toFixed(0) ?? 'N/A'}%
  Elderly (65+): ${p.elderly_pct?.toFixed(0) ?? 'N/A'}%
  Youth (0–19): ${p.youth_pct?.toFixed(0) ?? 'N/A'}%

${incomeBlock}

SIGNAL OPPORTUNITY SCORE: ${p.opportunity_score ?? 'N/A'}/100
  Score Components:
  - Service Access (income proxy): ${p.income_component ?? 'N/A'}/100
  - Formal Dwellings (addressable): ${p.dwelling_component ?? 'N/A'}/100
  - Population Density: ${p.density_component ?? 'N/A'}/100
  - Youth (0–14): ${p.children_component ?? 'N/A'}/100
  - Elderly (60+): ${p.elderly_component ?? 'N/A'}/100

Write 3 concise paragraphs (no headings, no bullet points, no markdown):
1. Overall market assessment — what makes this municipality attractive (or not) for fixed broadband expansion, considering the formal vs. informal housing split and service access profile.
2. Key customer segments to target and why — reference specific demographics, dwelling types, and the load-shedding connectivity angle where relevant.
3. Recommended approach — pricing tiers, community angles, or ISP partnership strategies most likely to succeed in this South African market.

Keep the tone direct and analytical. Cite specific statistics. Avoid generic statements.`;
}

function buildZaBizPrompt(p) {
  const topIndustries = p.industry_distribution
    ? Object.entries(p.industry_distribution)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 7)
        .map(([code, count]) => {
          const pct = p.working_population > 0
            ? ((count / p.working_population) * 100).toFixed(1) : '?';
          return `  ${ZA_ISIC_SHORT[code] ?? code}: ${count.toLocaleString('en-ZA')} workers (${pct}%)`;
        })
        .join('\n')
    : '  Not available';

  return `You are a business development analyst helping a telecommunications company identify and prioritise business broadband sales opportunities in South Africa.

The product targets small-to-medium enterprises (SMEs) that need reliable, high-performance internet for cloud applications, VoIP, video conferencing, and data-intensive workflows.

Analyse the following Local Municipality and provide actionable intelligence for a business broadband sales team.

REGION: ${p.name} (${p.state_code})
TYPE: Local Municipality — Stats SA Census 2022
COMPETITIVE CONTEXT: South Africa's business broadband market is served by Telkom Business (ADSL/fibre/MPLS), Vodacom Business, MTN Business, and Liquid Intelligent Technologies. Frogfoot, Vumatel, Openserve wholesale FTTH, and Dark Fibre Africa provide infrastructure. SMEs are increasingly moving from ADSL to fibre or LTE failover solutions. Load-shedding is a major pain point — ISPs offering UPS/battery backup integration or LTE failover command a premium. The government's SOE reform and SA Connect programme are expanding backbone capacity.

BUSINESS LANDSCAPE
  Working Population (employed in this area): ${p.working_population?.toLocaleString('en-ZA') ?? 'N/A'}
  Worker Density: ${p.working_pop_density ?? 'N/A'}/km²

TOP INDUSTRIES BY WORKERS (ISIC Rev. 4):
${topIndustries}

KEY SECTOR CONCENTRATIONS
  Knowledge Workers (Finance, IT, Professional, Healthcare, Education): ${p.knowledge_worker_pct?.toFixed(1) ?? 'N/A'}%
  Healthcare & Social Work: ${p.healthcare_pct?.toFixed(1) ?? 'N/A'}%
  Professional & Technical Services: ${p.professional_services_pct?.toFixed(1) ?? 'N/A'}%
  Finance & Information Tech: ${p.finance_tech_pct?.toFixed(1) ?? 'N/A'}%
  Retail Trade: ${p.retail_pct?.toFixed(1) ?? 'N/A'}%
  Construction: ${p.construction_pct?.toFixed(1) ?? 'N/A'}%

BUSINESS OPPORTUNITY SCORE: ${p.smartbiz_score ?? 'N/A'}/100
  Score Components:
  - Industry Mix: ${p.industry_mix_component ?? 'N/A'}/100
  - High-Value Sectors: ${p.high_value_component ?? 'N/A'}/100
  - Business Density: ${p.wp_density_component ?? 'N/A'}/100

Write 3 concise paragraphs (no headings, no bullet points, no markdown):
1. Business landscape — what industries dominate, what this means for broadband demand and load-shedding resilience needs.
2. Priority target segments — which specific business types and sectors to focus sales efforts on and why.
3. Sales approach — how to position for this South African market, relevant use cases (VoIP, cloud, failover), partnership channels, or competitive angles.

Keep the tone direct and analytical. Cite specific statistics. Focus on actionable intelligence for a field sales team.`;
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
        // gemini-2.5-flash uses thinking tokens that count against this budget,
        // so it must be generous enough to cover reasoning + 3 paragraphs of output.
        maxOutputTokens: 4096,
        temperature: 0.7,
      },
    });

    const isBusiness = properties.smartbiz_score != null;
    const market     = properties.market;
    let prompt;
    if (market === 'ca') {
      prompt = isBusiness ? buildCaBizPrompt(properties) : buildCaPrompt(properties);
    } else if (market === 'za') {
      prompt = isBusiness ? buildZaBizPrompt(properties) : buildZaPrompt(properties);
    } else {
      prompt = isBusiness ? buildBusinessPrompt(properties) : buildPrompt(properties);
    }
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
