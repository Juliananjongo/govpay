import { createClient } from "npm:@supabase/supabase-js@2";

function timingSafeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index++) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

function jsonResponse(status: number) {
  return new Response(null, { status });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse(405);

  const secretHash = Deno.env.get("FLW_SECRET_HASH");
  const flutterwaveSecret = Deno.env.get("FLW_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secretHash || !flutterwaveSecret || !supabaseUrl || !serviceRoleKey) {
    console.error("Flutterwave webhook is not configured");
    return jsonResponse(503);
  }

  const signature = request.headers.get("verif-hash");
  if (!signature || !timingSafeEqual(secretHash, signature)) {
    console.warn("Rejected webhook with invalid signature");
    return jsonResponse(401);
  }

  let event: {
    data?: { id?: number | string; tx_ref?: string };
    event?: string;
    type?: string;
    "event.type"?: string;
  };
  try {
    const rawBody = await request.text();
    event = JSON.parse(rawBody);
  } catch (error) {
    console.error("Rejected invalid webhook JSON", error);
    return jsonResponse(400);
  }

  const transactionId = event.data?.id;
  const reference = event.data?.tx_ref;
  const eventType = event.event ?? event.type ?? event["event.type"];
  if (!["charge.completed", "MOBILEMONEYZM_TRANSACTION"].includes(eventType ?? "") ||
      !transactionId || !reference) {
    return jsonResponse(200);
  }

  const verificationResponse = await fetch(
    `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(String(transactionId))}/verify`,
    { headers: { Authorization: `Bearer ${flutterwaveSecret}` } },
  );
  if (!verificationResponse.ok) {
    console.error("Flutterwave transaction verification failed", verificationResponse.status);
    return jsonResponse(502);
  }

  const verification = await verificationResponse.json();
  const transaction = verification.data;
  if (verification.status !== "success" || transaction?.status !== "successful" ||
      transaction?.tx_ref !== reference || transaction?.currency !== "ZMW" ||
      !Number.isFinite(Number(transaction?.amount))) {
    console.warn("Flutterwave transaction did not pass verification", reference);
    return jsonResponse(200);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data: payment, error: paymentError } = await serviceClient
    .from("payments")
    .select("id, amount_minor_units, currency, status")
    .eq("reference", reference)
    .maybeSingle();

  if (paymentError) {
    console.error("Unable to load payment for webhook", paymentError);
    return jsonResponse(500);
  }
  if (!payment) {
    console.warn("Webhook has no matching GovPay payment", reference);
    return jsonResponse(200);
  }

  const paidMinorUnits = Math.round(Number(transaction.amount) * 100);
  if (payment.currency !== transaction.currency ||
      payment.amount_minor_units !== paidMinorUnits) {
    console.error("Verified payment amount or currency does not match invoice", reference);
    return jsonResponse(200);
  }
  if (payment.status === "successful") return jsonResponse(200);
  if (payment.status !== "pending") return jsonResponse(200);

  const { data: completed, error: completionError } = await serviceClient.rpc(
    "complete_flutterwave_payment",
    {
      p_payment_reference: reference,
      p_provider_transaction_id: String(transactionId),
    },
  );
  if (completionError) {
    console.error("Unable to atomically complete verified payment", completionError);
    return jsonResponse(500);
  }
  if (!completed) {
    console.warn("Payment was already resolved or invoice is no longer payable", reference);
  }

  return jsonResponse(200);
});
