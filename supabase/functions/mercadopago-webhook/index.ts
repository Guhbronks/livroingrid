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
    // 1. Inicializa cliente do Supabase com Service Role Key (admin)
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "https://otsbdtoxpxlvordvzjjq.supabase.co";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const mpAccessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "";

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 2. Extrai parâmetros do webhook (suporta tanto Payments quanto Orders / Merchant Orders)
    const url = new URL(req.url);
    let paymentId = url.searchParams.get("data.id") || url.searchParams.get("id");
    let externalRef = url.searchParams.get("external_reference") || "";
    let eventType = url.searchParams.get("type") || url.searchParams.get("topic") || "";
    let eventAction = "";
    let bodyDataStatus = "";

    if (req.method === "POST") {
      try {
        const body = await req.json();
        eventType = body?.type || body?.topic || eventType;
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

    console.log(`📦 Webhook Mercado Pago recebido (tipo: ${eventType || 'notificação'}, id: ${paymentId}, action: ${eventAction})`);

    // 3. Determina status do pagamento consultando diretamente a API do Mercado Pago
    let statusPagamento = "pendente";

    if (bodyDataStatus === "processed" || bodyDataStatus === "accredited" || bodyDataStatus === "approved" || eventAction === "order.processed") {
      statusPagamento = "aprovado";
    }

    if (mpAccessToken && paymentId) {
      const isMerchantOrder = eventType === "merchant_order" || eventType === "topic_merchant_order";
      const endpoint = isMerchantOrder 
        ? `https://api.mercadopago.com/v1/merchant_orders/${paymentId}`
        : `https://api.mercadopago.com/v1/payments/${paymentId}`;

      try {
        let mpResponse = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${mpAccessToken}` },
        });

        // Se falhou como merchant_order tenta como payment
        if (!mpResponse.ok && isMerchantOrder) {
          mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: { Authorization: `Bearer ${mpAccessToken}` },
          });
        }

        if (mpResponse.ok) {
          const mpData = await mpResponse.json();
          const st = mpData.status || mpData.status_detail;
          console.log(`Status oficial do Mercado Pago para ${paymentId}: ${st}`);

          // Extrai external_reference retornado pela API do MP
          if (mpData.external_reference && !externalRef) {
            externalRef = String(mpData.external_reference);
            console.log(`External reference encontrada no MP: ${externalRef}`);
          }

          if (st === "approved" || st === "processed" || st === "accredited" || st === "closed") {
            statusPagamento = "aprovado";
          } else if (st === "rejected" || st === "cancelled" || st === "refunded" || st === "charged_back") {
            statusPagamento = "cancelado";
          } else {
            statusPagamento = "pendente";
          }
        } else {
          console.warn(`Falha ao consultar MP API (${mpResponse.status}):`, await mpResponse.text());
        }
      } catch (e) {
        console.error("Aviso ao consultar status no MP:", e);
      }
    }

    console.log(`🎯 Status final determinado: ${statusPagamento} para paymentId: ${paymentId}, externalRef: ${externalRef}`);

    // 4. Atualiza tabela de pedidos no Supabase com segurança
    let atualizado = false;

    if (externalRef) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(externalRef);
      const isNum = /^\d+$/.test(externalRef);

      if (isUuid) {
        const { data, error } = await supabase
          .from("pedidos")
          .update({
            status_pagamento: statusPagamento,
            mercado_pago_id: String(paymentId),
          })
          .eq("id", externalRef);

        if (!error) {
          console.log(`✅ Pedido atualizado por UUID (${externalRef}) para status: ${statusPagamento}`);
          atualizado = true;
        } else {
          console.error("Erro ao atualizar por UUID:", error);
        }
      } else if (isNum) {
        const { data, error } = await supabase
          .from("pedidos")
          .update({
            status_pagamento: statusPagamento,
            mercado_pago_id: String(paymentId),
          })
          .eq("numero_pedido", parseInt(externalRef, 10));

        if (!error) {
          console.log(`✅ Pedido atualizado por numero_pedido (${externalRef}) para status: ${statusPagamento}`);
          atualizado = true;
        } else {
          console.error("Erro ao atualizar por numero_pedido:", error);
        }
      }
    }

    // Se ainda não atualizou ou para garantir sincronização de mercado_pago_id:
    if (paymentId) {
      const { data, error } = await supabase
        .from("pedidos")
        .update({
          status_pagamento: statusPagamento,
        })
        .eq("mercado_pago_id", String(paymentId));

      if (!error) {
        console.log(`✅ Pedido atualizado por mercado_pago_id (${paymentId}) para status: ${statusPagamento}`);
      } else {
        console.error("Erro ao atualizar por mercado_pago_id:", error);
      }
    }

    // 5. Retorna 200 OK para o Mercado Pago
    return new Response(JSON.stringify({ success: true, status: statusPagamento, paymentId }), {
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
