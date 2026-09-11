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

const textValue = (value: unknown, maxLength = 100) => String(value ?? "").trim().slice(0, maxLength);
const validPostalCode = (value: unknown) => /^\d{5}(?:-\d{4})?$/.test(textValue(value, 10));
const poundsFromOunces = (value: unknown) => Math.max(0.1, (Number(value) || 0) / 16).toFixed(2);
const numberValue = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const upsAddress = (address: Record<string, unknown>, includeName = false) => {
  const addressLine = textValue(address.addressLine, 100);
  const result: Record<string, unknown> = {
    City: textValue(address.city, 50),
    StateProvinceCode: textValue(address.state, 2).toUpperCase(),
    PostalCode: textValue(address.postalCode, 10),
    CountryCode: textValue(address.countryCode, 2).toUpperCase() || "US",
  };
  if (addressLine) result.AddressLine = [addressLine];
  if (includeName) return { Name: textValue(address.name, 75) || "Customer", Address: result };
  return { Address: result };
};

const getUpsToken = async (baseUrl: string, clientId: string, clientSecret: string) => {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch(`${baseUrl}/security/v1/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) return null;
  const result = await response.json();
  return textValue(result.access_token, 4000) || null;
};

const serviceName = (code: string) => ({
  "01": "UPS Next Day Air",
  "02": "UPS Second Day Air",
  "03": "UPS Ground",
  "12": "UPS Three-Day Select",
  "13": "UPS Next Day Air Saver",
  "14": "UPS Next Day Air Early",
  "59": "UPS Second Day Air A.M.",
  "65": "UPS Saver",
}[code] || `UPS service ${code}`);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "POST required." }, 405);

  try {
    const body = await request.json();
    const from = body?.from || {};
    const to = body?.to || {};
    const packageInfo = body?.package || {};
    if (!validPostalCode(from.postalCode) || !validPostalCode(to.postalCode)) {
      return json({ error: "Valid origin and destination ZIP codes are required." }, 400);
    }

    const weightOz = numberValue(packageInfo.weightOz);
    const lengthIn = numberValue(packageInfo.lengthIn);
    const widthIn = numberValue(packageInfo.widthIn);
    const heightIn = numberValue(packageInfo.heightIn);
    if (weightOz <= 0 || lengthIn <= 0 || widthIn <= 0 || heightIn <= 0) {
      return json({ error: "A positive package weight and dimensions are required." }, 400);
    }

    const clientId = Deno.env.get("UPS_CLIENT_ID") || "";
    const clientSecret = Deno.env.get("UPS_CLIENT_SECRET") || "";
    if (!clientId || !clientSecret) return json({ error: "UPS Rating is not configured." }, 503);

    const baseUrl = Deno.env.get("UPS_ENVIRONMENT") === "cie"
      ? "https://wwwcie.ups.com"
      : "https://onlinetools.ups.com";
    const token = await getUpsToken(baseUrl, clientId, clientSecret);
    if (!token) return json({ error: "UPS authentication failed." }, 502);

    const shipper: Record<string, unknown> = {
      Name: textValue(from.name, 75) || "Bead Different Co.",
      Address: upsAddress(from).Address,
    };
    const accountNumber = textValue(Deno.env.get("UPS_ACCOUNT_NUMBER"), 20);
    if (accountNumber) shipper.ShipperNumber = accountNumber;

    const shipment: Record<string, unknown> = {
      Shipper: shipper,
      ShipFrom: {
        Name: textValue(from.name, 75) || "Bead Different Co.",
        Address: upsAddress(from).Address,
      },
      ShipTo: upsAddress(to, true),
      Package: {
        PackagingType: { Code: "02", Description: "Package" },
        Dimensions: {
          UnitOfMeasurement: { Code: "IN", Description: "Inches" },
          Length: String(Math.ceil(lengthIn)),
          Width: String(Math.ceil(widthIn)),
          Height: String(Math.ceil(heightIn)),
        },
        PackageWeight: {
          UnitOfMeasurement: { Code: "LBS", Description: "Pounds" },
          Weight: poundsFromOunces(weightOz),
        },
      },
    };
    if (accountNumber) shipment.ShipmentRatingOptions = { NegotiatedRatesIndicator: "Y" };

    const transactionId = crypto.randomUUID().replaceAll("-", "").slice(0, 32);
    const response = await fetch(`${baseUrl}/api/rating/v2403/shop`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        transId: transactionId,
        transactionSrc: "bead-different-co",
      },
      body: JSON.stringify({
        RateRequest: {
          Request: {
            RequestOption: "Shop",
            TransactionReference: { CustomerContext: "Cart shipping estimate" },
          },
          Shipment: shipment,
        },
      }),
    });
    const result = await response.json();
    if (!response.ok) return json({ error: "UPS could not return rates." }, 502);
    const ratedShipments = result?.RateResponse?.RatedShipment || [];
    const rates = (Array.isArray(ratedShipments) ? ratedShipments : [ratedShipments]).map((rate: Record<string, unknown>) => {
      const service = rate.Service as Record<string, unknown> | undefined;
      const total = rate.TotalCharges as Record<string, unknown> | undefined;
      return {
        serviceCode: textValue(service?.Code, 10),
        serviceName: serviceName(textValue(service?.Code, 10)),
        amount: numberValue(total?.MonetaryValue),
        currency: textValue(total?.CurrencyCode, 3) || "USD",
      };
    }).filter((rate) => rate.amount > 0).sort((first, second) => first.amount - second.amount);
    return json({ rates });
  } catch {
    return json({ error: "Shipping rate request could not be completed." }, 400);
  }
});
