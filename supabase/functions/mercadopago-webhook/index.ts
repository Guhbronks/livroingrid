// @ts-nocheck
// ==============================================================================
// SUPABASE EDGE FUNCTION: WEBHOOK MERCADO PAGO
// Rota: https://otsbdtoxpxlvordvzjjq.supabase.co/functions/v1/mercadopago-webhook
// ==============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  // Trata requisição CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Inicializa cliente do Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "https://otsbdtoxpxlvordvzjjq.supabase.co";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const mpAccessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "";

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 2. Extrai parâmetros do webhook (suporta tanto Payments quanto Orders)
    const url = new URL(req.url);
    let paymentId = url.searchParams.get("data.id") || url.searchParams.get("id");
    let externalRef = url.searchParams.get("external_reference") || "";
    let eventType = url.searchParams.get("type") || "";
    let eventAction = "";
    let bodyDataStatus = "";

    if (req.method === "POST") {
      try {
        const body = await req.json();
        eventType = body?.type || eventType;
        eventAction = body?.action || "";
        externalRef = body?.data?.external_reference || body?.external_reference || externalRef;
        bodyDataStatus = body?.data?.status || body?.data?.status_detail || "";

        if (body?.data?.id) {
          paymentId = String(body.data.id);
        } else if (body?.id) {
          paymentId = String(body.id);
        }
      } catch {
        // Body pode vir vazio em alguns pings de teste
      }
    }

    if (!paymentId || paymentId === "123456") {
      console.log("🧪 Teste de simulação do painel do Mercado Pago recebido com sucesso.");
      return new Response(JSON.stringify({ success: true, message: "Webhook ativo e pronto para receber notificações." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Validação de Segurança: Assinatura Secreta (x-signature)
    const webhookSecret = Deno.env.get("MERCADO_PAGO_WEBHOOK_SECRET");
    const xSignature = req.headers.get("x-signature");
    const xRequestId = req.headers.get("x-request-id");

    if (webhookSecret && xSignature) {
      const parts = xSignature.split(",");
      let ts = "";
      let v1 = "";
      for (const part of parts) {
        const [k, v] = part.split("=");
        if (k?.trim() === "ts") ts = v?.trim() || "";
        if (k?.trim() === "v1") v1 = v?.trim() || "";
      }

      // Constrói o manifesto oficial: id:[data.id];request-id:[x-request-id];ts:[ts];
      let manifest = "";
      if (paymentId) manifest += `id:${paymentId};`;
      if (xRequestId) manifest += `request-id:${xRequestId};`;
      if (ts) manifest += `ts:${ts};`;

      try {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          "raw",
          encoder.encode(webhookSecret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"]
        );
        const signatureBuffer = await crypto.subtle.sign(
          "HMAC",
          key,
          encoder.encode(manifest)
        );
        const computedHash = Array.from(new Uint8Array(signatureBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        if (computedHash !== v1) {
          console.warn(`⚠️ Assinatura de webhook não coincide! Calculada: ${computedHash}, Recebida: ${v1}`);
          return new Response(JSON.stringify({ error: "Assinatura de notificação inválida." }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        console.log("🔒 Assinatura secreta do Mercado Pago validada com sucesso!");
      } catch (signErr) {
        console.error("Erro ao verificar assinatura criptográfica:", signErr);
      }
    }

    console.log(`📦 Webhook Mercado Pago recebido (${eventType || 'notificação'}): ${paymentId}`);

    // 4. Determina status do pagamento (compatível com API de Pagamentos e API de Orders)
    let statusPagamento = "aprovado"; // padrão para eventos de sucesso

    if (bodyDataStatus === "processed" || bodyDataStatus === "accredited" || eventAction === "order.processed") {
      statusPagamento = "aprovado";
    }

    if (mpAccessToken) {
      const isOrder = eventType === "order" || (eventAction && eventAction.startsWith("order"));
      const endpoint = isOrder 
        ? `https://api.mercadopago.com/v1/orders/${paymentId}`
        : `https://api.mercadopago.com/v1/payments/${paymentId}`;

      try {
        let mpResponse = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${mpAccessToken}` },
        });

        if (!mpResponse.ok && isOrder) {
          mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: { Authorization: `Bearer ${mpAccessToken}` },
          });
        }

        if (mpResponse.ok) {
          const mpData = await mpResponse.json();
          const st = mpData.status || mpData.status_detail;
          console.log(`Status oficial do Mercado Pago para ${paymentId}: ${st}`);
          
          if (st === "approved" || st === "processed" || st === "accredited" || st === "closed") {
            statusPagamento = "aprovado";
          } else if (st === "rejected" || st === "cancelled") {
            statusPagamento = "cancelado";
          } else {
            statusPagamento = "pendente";
          }
        }
      } catch (e) {
        console.error("Aviso ao consultar status no MP:", e);
      }
    }

    // 5. Atualiza tabela de pedidos no Supabase
    let queryFilter = `mercado_pago_id.eq.${paymentId},id.eq.${paymentId}`;
    if (externalRef) {
      queryFilter += `,id.eq.${externalRef}`;
    }

    const { data, error } = await supabase
      .from("pedidos")
      .update({
        status_pagamento: statusPagamento,
        mercado_pago_id: paymentId,
      })
      .or(queryFilter);

    if (error) {
      console.error("Erro ao atualizar pedido no Supabase:", error);
    } else {
      console.log(`✅ Pedido atualizado com sucesso no Supabase para status: ${statusPagamento}`);
    }

    // 5. Retorna 200 OK para o Mercado Pago
    return new Response(JSON.stringify({ success: true, status: statusPagamento }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("Erro no processamento do webhook:", error);
    return new Response(JSON.stringify({ error: error?.message || String(error) }), {
      status: 200, // Retorna 200 para evitar retries desnecessários
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
