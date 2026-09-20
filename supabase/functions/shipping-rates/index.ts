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

const providerError = async (response: Response) => {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body);
    return textValue(parsed.error_description || parsed.message || parsed.error || parsed.title, 180);
  } catch {
    return textValue(body, 180);
  }
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

const getUspsToken = async (baseUrl: string, clientId: string, clientSecret: string) => {
  const response = await fetch(`${baseUrl}/oauth2/v3/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
  });
  if (!response.ok) return { token: null, error: await providerError(response) };
  try {
    const result = await response.json();
    return { token: textValue(result.access_token, 4000) || null, error: "" };
  } catch {
    return { token: null, error: "USPS returned an invalid authentication response." };
  }
};

const uspsEstimate = async (from: Record<string, unknown>, to: Record<string, unknown>, packageInfo: Record<string, unknown>, acceptanceDate: unknown) => {
  const originPostalCode = textValue(from.postalCode, 10);
  const destinationPostalCode = textValue(to.postalCode, 10);
  const acceptedDate = textValue(acceptanceDate, 10);
  if (!validPostalCode(originPostalCode) || !validPostalCode(destinationPostalCode) || !/^\d{4}-\d{2}-\d{2}$/.test(acceptedDate)) {
    return json({ error: "Valid origin, destination, and acceptance date are required." }, 400);
  }

  const weight = numberValue(packageInfo.weightOz);
  const length = numberValue(packageInfo.lengthIn);
  const width = numberValue(packageInfo.widthIn);
  const height = numberValue(packageInfo.heightIn);
  if (weight <= 0 || length <= 0 || width <= 0 || height <= 0) {
    return json({ error: "A positive package weight and dimensions are required for USPS postage." }, 400);
  }

  const clientId = Deno.env.get("USPS_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("USPS_CLIENT_SECRET") || "";
  if (!clientId || !clientSecret) return json({ error: "USPS Service Standards are not configured." }, 503);

  const baseUrl = Deno.env.get("USPS_ENVIRONMENT") === "tem"
    ? "https://apis-tem.usps.com"
    : "https://apis.usps.com";
  const tokenResult = await getUspsToken(baseUrl, clientId, clientSecret);
  if (!tokenResult.token) return json({ error: `USPS authentication failed${tokenResult.error ? `: ${tokenResult.error}` : "."}` }, 502);

  const authorization = { Accept: "application/json", Authorization: `Bearer ${tokenResult.token}` };
  const requestPrice = async (mailClass: string, serviceName: string) => {
    const response = await fetch(`${baseUrl}/prices/v3/base-rates/search`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify({
        originZIPCode: originPostalCode,
        destinationZIPCode: destinationPostalCode,
        weight,
        length,
        width,
        height,
        mailClass,
        processingCategory: "MACHINABLE",
        destinationEntryFacilityType: "NONE",
        rateIndicator: "SP",
        priceType: "RETAIL",
        mailingDate: acceptedDate,
      }),
    });
    const body = await response.text();
    let result: Record<string, unknown> = {};
    try { result = JSON.parse(body); } catch { result = {}; }
    if (!response.ok) {
      const detail = textValue(result.error_description || result.message || result.error || result.title || body, 180);
      throw new Error(`${serviceName} postage failed${detail ? `: ${detail}` : "."}`);
    }
    const rates = Array.isArray(result.rates) ? result.rates as Record<string, unknown>[] : [];
    const rate = rates.find((entry) => Number.isFinite(Number(entry.price))) || null;
    if (!rate) throw new Error(`${serviceName} postage failed: USPS returned no eligible rate.`);
    return { serviceCode: mailClass, serviceName, amount: numberValue(rate.price), priceType: textValue(rate.priceType, 40) || "RETAIL" };
  };
  const requestDelivery = async (mailClass: string) => {
    const params = new URLSearchParams({ originZIPCode: originPostalCode, destinationZIPCode: destinationPostalCode, acceptanceDate: acceptedDate, mailClass });
    const response = await fetch(`${baseUrl}/service-standards/v3/estimates?${params.toString()}`, { headers: authorization });
    const body = await response.text();
    let result: unknown;
    try { result = JSON.parse(body); } catch { result = null; }
    if (!response.ok || !Array.isArray(result) || !result.length) {
      const detail = result && typeof result === "object"
        ? textValue((result as Record<string, unknown>).error_description || (result as Record<string, unknown>).message || (result as Record<string, unknown>).error || (result as Record<string, unknown>).title, 180)
        : textValue(body, 180);
      throw new Error(`${mailClass} delivery estimate failed${detail ? `: ${detail}` : "."}`);
    }
    const estimate = result[0] as Record<string, unknown>;
    const delivery = (estimate.delivery || {}) as Record<string, unknown>;
    return { serviceDays: numberValue(estimate.serviceStandard), scheduledDeliveryDate: textValue(delivery.scheduledDeliveryDateTime, 30).slice(0, 10) };
  };
  const services = [
    ["USPS_GROUND_ADVANTAGE", "USPS Ground Advantage"],
    ["PRIORITY_MAIL", "USPS Priority Mail"],
  ] as const;
  const results = await Promise.all(services.map(async ([serviceCode, serviceName]) => {
    const service: Record<string, unknown> = { serviceCode, serviceName };
    const errors: string[] = [];
    try { Object.assign(service, await requestPrice(serviceCode, serviceName)); } catch (error) { errors.push(error instanceof Error ? error.message : `${serviceName} postage failed.`); }
    try { Object.assign(service, await requestDelivery(serviceCode)); } catch (error) { errors.push(error instanceof Error ? error.message : `${serviceName} delivery estimate failed.`); }
    return errors.length < 2 ? service : null;
  }));
  const rates = results.filter((rate): rate is Record<string, unknown> => Boolean(rate));
  if (!rates.length) return json({ error: "USPS could not return a postage or delivery estimate." }, 502);
  return json({ provider: "usps", rates });
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
    if (String(body?.provider || body?.carrier || "").toLowerCase() === "usps") {
      return await uspsEstimate(from, to, packageInfo, body?.acceptanceDate);
    }
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
