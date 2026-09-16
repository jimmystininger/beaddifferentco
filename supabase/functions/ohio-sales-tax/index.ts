import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const textValue = (value: unknown, maxLength = 180) => String(value ?? "").trim().slice(0, maxLength);
const numberValue = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const escapeXml = (value: unknown) => textValue(value, 180)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");
const decodeXml = (value: string) => value
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&quot;", '"')
  .replaceAll("&apos;", "'")
  .replaceAll("&amp;", "&");
const xmlTag = (xml: string, tag: string) => {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
};
const validPostalCode = (value: unknown) => /^\d{5}(?:-\d{4})?$/.test(textValue(value, 10));

const ohioTax = async (payload: Record<string, unknown>) => {
  const address = (payload.address || {}) as Record<string, unknown>;
  const state = textValue(address.state, 2).toUpperCase();
  const postalCode = textValue(address.postalCode, 10);
  const taxableAmount = numberValue(payload.taxableAmount, -1);
  if (state !== "OH" || !validPostalCode(postalCode) || taxableAmount < 0) {
    return json({ error: "A valid Ohio shipping address and taxable amount are required." }, 400);
  }

  const addressLine = textValue(address.addressLine1, 100);
  const city = textValue(address.city, 50);
  const taxDate = textValue(payload.taxDate, 40) || new Date().toISOString();
  const soapBody = addressLine && city
    ? `<GetOHSalesTaxByAddress xmlns="https://thefinder.tax.ohio.gov/OHFinderService"><address>${escapeXml(addressLine)}</address><city>${escapeXml(city)}</city><stateAbbreviation>OH</stateAbbreviation><postalCode>${escapeXml(postalCode)}</postalCode><countryCode>US</countryCode><taxAmount>${taxableAmount.toFixed(2)}</taxAmount><taxDate>${escapeXml(taxDate)}</taxDate><requestSFSTInfo>false</requestSFSTInfo></GetOHSalesTaxByAddress>`
    : `<GetOHSalesTaxByZipCode xmlns="https://thefinder.tax.ohio.gov/OHFinderService"><postalCode>${escapeXml(postalCode)}</postalCode><taxAmount>${taxableAmount.toFixed(2)}</taxAmount><taxDate>${escapeXml(taxDate)}</taxDate><requestSFSTInfo>false</requestSFSTInfo></GetOHSalesTaxByZipCode>`;
  const action = addressLine && city ? "GetOHSalesTaxByAddress" : "GetOHSalesTaxByZipCode";
  const response = await fetch("https://thefinder.tax.ohio.gov/OHFinderService/OHFinderService.asmx", {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"https://thefinder.tax.ohio.gov/OHFinderService/${action}"`,
    },
    body: `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${soapBody}</soap:Body></soap:Envelope>`,
  });
  const responseBody = await response.text();
  if (!response.ok) return json({ error: `Ohio returned HTTP ${response.status}.` }, 502);
  const resultCode = xmlTag(responseBody, "resultCode");
  const serviceResult = xmlTag(responseBody, "result");
  const taxAmount = numberValue(xmlTag(responseBody, "TotalSalesTaxAmount"), -1);
  if (resultCode && resultCode !== "0" && taxAmount < 0) return json({ error: serviceResult || "Ohio could not determine the sales tax jurisdiction." }, 502);
  if (taxAmount < 0) return json({ error: serviceResult || "Ohio did not return a sales tax amount." }, 502);
  const county = xmlTag(responseBody, "CountyName");
  const transit = xmlTag(responseBody, "TransitName");
  const jurisdictions = [county, transit].filter(Boolean).join(" · ");
  return json({
    provider: "ohio-finder",
    state: "OH",
    amount: Math.max(0, taxAmount),
    rate: taxableAmount > 0 ? Math.max(0, taxAmount / taxableAmount * 100) : 0,
    jurisdiction: jurisdictions || "Ohio",
    taxableAmount,
    taxDate,
  });
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "POST required." }, 405);
  try {
    return await ohioTax(await request.json());
  } catch (error) {
    return json({ error: textValue(error instanceof Error ? error.message : "Ohio sales tax lookup failed.") }, 502);
  }
});
