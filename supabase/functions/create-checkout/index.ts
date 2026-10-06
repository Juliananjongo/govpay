import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") ?? "http://localhost:5173",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const flutterwaveSecret = Deno.env.get("FLW_SECRET_KEY");
  const siteUrl = Deno.env.get("SITE_URL");

  if (!authorization?.startsWith("Bearer ") || !supabaseUrl || !anonKey ||
      !serviceRoleKey || !flutterwaveSecret || !siteUrl) {
    return jsonResponse({ error: "Payment service is not configured" }, 503);
  }

  let applicationId: string;
  try {
    const body = await request.json();
    applicationId = body.applicationId;
    if (typeof applicationId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId)) {
      return jsonResponse({ error: "A valid application ID is required" }, 400);
    }
  } catch (error) {
    console.error("Invalid checkout request body", error);
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return jsonResponse({ error: "Authentication required" }, 401);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const reference = `GP-${crypto.randomUUID()}`;
  const { data: invoice, error: invoiceError } = await userClient
    .rpc("begin_payment_checkout", {
      p_application_id: applicationId,
      p_payment_reference: reference,
    })
    .maybeSingle();

  if (invoiceError) {
    console.warn("Checkout request was rejected", invoiceError.message);
    return jsonResponse({ error: "This application cannot start a payment right now" }, 409);
  }
  if (!invoice) {
    return jsonResponse({ error: "This application cannot start a payment right now" }, 409);
  }

  const networks = new Set(["MTN", "Airtel", "Zamtel"]);
  if (!networks.has(invoice.mobile_money_network)) {
    await serviceClient.from("payments")
      .update({ status: "failed" })
      .eq("id", invoice.payment_id)
      .eq("status", "pending");
    return jsonResponse({ error: "Select a supported Zambia mobile money network before paying" }, 400);
  }

  const phoneNumber = String(invoice.applicant_phone).replace(/\D/g, "");
  const localPhoneNumber = phoneNumber.startsWith("260")
    ? `0${phoneNumber.slice(3)}`
    : phoneNumber;
  if (!/^0[0-9]{9}$/.test(localPhoneNumber)) {
    await serviceClient.from("payments")
      .update({ status: "failed" })
      .eq("id", invoice.payment_id)
      .eq("status", "pending");
    return jsonResponse({ error: "Enter a valid Zambia mobile number, such as +260 97 123 4567" }, 400);
  }

  let checkoutResponse: Response;
  try {
    checkoutResponse = await fetch("https://api.flutterwave.com/v3/charges?type=mobile_money_zambia", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${flutterwaveSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tx_ref: reference,
      amount: invoice.amount_minor_units / 100,
      currency: invoice.currency,
      phone_number: localPhoneNumber,
      network: invoice.mobile_money_network,
      fullname: invoice.applicant_name,
      email: invoice.applicant_email,
      meta: { payment_id: invoice.payment_id, invoice_reference: invoice.invoice_reference },
    }),
  });
  } catch (error) {
    console.error("Flutterwave checkout request failed", error);
    await serviceClient.from("payments")
      .update({ status: "failed" })
      .eq("id", invoice.payment_id)
      .eq("status", "pending");
    return jsonResponse({ error: "Unable to reach the payment provider" }, 502);
  }

  if (!checkoutResponse.ok) {
    const responseText = await checkoutResponse.text();
    console.error("Flutterwave checkout creation failed", checkoutResponse.status, responseText);
    await serviceClient.from("payments")
      .update({ status: "failed" })
      .eq("id", invoice.payment_id)
      .eq("status", "pending");
    return jsonResponse({ error: "Payment provider could not start checkout" }, 502);
  }

  let checkout: { status?: string; meta?: { authorization?: { redirect?: string } } };
  try {
    checkout = await checkoutResponse.json();
  } catch (error) {
    console.error("Flutterwave returned invalid checkout JSON", error);
    await serviceClient.from("payments")
      .update({ status: "failed" })
      .eq("id", invoice.payment_id)
      .eq("status", "pending");
    return jsonResponse({ error: "Payment provider returned an invalid response" }, 502);
  }
  const authorizationUrl = checkout.meta?.authorization?.redirect;
  if (checkout.status !== "success" || typeof authorizationUrl !== "string") {
    console.error("Flutterwave charge response did not include an authorization URL");
    await serviceClient.from("payments")
      .update({ status: "failed" })
      .eq("id", invoice.payment_id)
      .eq("status", "pending");
    return jsonResponse({ error: "Payment provider returned an invalid checkout response" }, 502);
  }

  let parsedAuthorizationUrl: URL;
  try {
    parsedAuthorizationUrl = new URL(authorizationUrl);
  } catch (error) {
    console.error("Flutterwave returned an invalid authorization URL", error);
    await serviceClient.from("payments")
      .update({ status: "failed" })
      .eq("id", invoice.payment_id)
      .eq("status", "pending");
    return jsonResponse({ error: "Payment provider returned an invalid authorization URL" }, 502);
  }
  const authorizationHost = parsedAuthorizationUrl.hostname;
  if (parsedAuthorizationUrl.protocol !== "https:" ||
      (!authorizationHost.endsWith(".flutterwave.com") &&
       !authorizationHost.endsWith(".dev-flutterwave.com"))) {
    console.error("Flutterwave returned an untrusted authorization URL", authorizationHost);
    await serviceClient.from("payments")
      .update({ status: "failed" })
      .eq("id", invoice.payment_id)
      .eq("status", "pending");
    return jsonResponse({ error: "Payment provider returned an untrusted authorization URL" }, 502);
  }

  return jsonResponse({ checkoutUrl: authorizationUrl });
});
