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
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const flutterwaveSecret = Deno.env.get("FLW_SECRET_KEY");
  if (!authorization?.startsWith("Bearer ") || !supabaseUrl || !anonKey ||
      !serviceRoleKey || !flutterwaveSecret) {
    return jsonResponse({ error: "Payment verification is not configured" }, 503);
  }

  let txRef: string;
  let transactionId: string;
  try {
    const body = await request.json();
    txRef = body.txRef;
    transactionId = String(body.transactionId ?? "");
    if (typeof txRef !== "string" || txRef.length > 100 ||
        !/^[A-Za-z0-9-]+$/.test(txRef) || !/^\d+$/.test(transactionId)) {
      return jsonResponse({ error: "Invalid transaction reference" }, 400);
    }
  } catch (error) {
    console.error("Invalid payment-verification request", error);
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return jsonResponse({ error: "Authentication required" }, 401);

  const { data: payment, error: paymentError } = await userClient
    .from("payments")
    .select("id, reference, user_id, amount_minor_units, currency, status")
    .eq("reference", txRef)
    .eq("user_id", user.id)
    .maybeSingle();
  if (paymentError) {
    console.error("Unable to load payment for verification", paymentError);
    return jsonResponse({ error: "Unable to verify payment" }, 500);
  }
  if (!payment) return jsonResponse({ error: "Payment not found" }, 404);

  if (payment.status !== "successful") {
    const providerResponse = await fetch(
      `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`,
      { headers: { Authorization: `Bearer ${flutterwaveSecret}` } },
    );
    if (!providerResponse.ok) {
      console.error("Flutterwave return verification failed", providerResponse.status);
      return jsonResponse({ error: "Payment provider verification is temporarily unavailable" }, 502);
    }

    const verification = await providerResponse.json();
    const transaction = verification.data;
    if (verification.status !== "success" || transaction?.status !== "successful" ||
        transaction?.tx_ref !== payment.reference || transaction?.currency !== payment.currency ||
        Math.round(Number(transaction?.amount) * 100) !== payment.amount_minor_units) {
      return jsonResponse({ status: "pending" });
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { data: completed, error: completionError } = await serviceClient.rpc(
      "complete_flutterwave_payment",
      {
        p_payment_reference: payment.reference,
        p_provider_transaction_id: transactionId,
      },
    );
    if (completionError) {
      console.error("Unable to complete verified return payment", completionError);
      return jsonResponse({ error: "Unable to record payment status" }, 500);
    }
    if (!completed) return jsonResponse({ status: "pending" });
  }

  const { data: receipt, error: receiptError } = await userClient
    .from("payments")
    .select("reference, provider_transaction_id, amount_minor_units, currency, invoices!inner(reference, applications!inner(id, reference, applicant_name, applicant_email, services!inner(id, name, category, description, processing_time)))")
    .eq("id", payment.id)
    .single();
  if (receiptError) {
    console.error("Unable to load verified receipt details", receiptError);
    return jsonResponse({ error: "Payment verified, but receipt details could not be loaded" }, 500);
  }

  const invoice = receipt.invoices;
  const application = invoice.applications;
  return jsonResponse({
    status: "successful",
    paymentReference: receipt.reference,
    providerTransactionId: receipt.provider_transaction_id,
    amountMinorUnits: receipt.amount_minor_units,
    currency: receipt.currency,
    invoiceReference: invoice.reference,
    application: {
      id: application.id,
      reference: application.reference,
      applicant: application.applicant_name,
      email: application.applicant_email,
      service: application.services,
    },
  });
});
