// @ts-nocheck
// ==============================================================================
// SUPABASE EDGE FUNCTION: CRIAR PAGAMENTO PIX (MERCADO PAGO)
// Rota: https://otsbdtoxpxlvordvzjjq.supabase.co/functions/v1/criar-pagamento
// ==============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // Trata requisição OPTIONS de pré-voo CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const mpAccessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
    const body = await req.json();
    const { pedidoId, cliente, quantidade, metodo, cardFormData } = body;

    // Sanitiza valorTotal: aceita número, string com ponto ou vírgula
    const rawValor = body.valorTotal;
    const valorTotalStr = String(rawValor ?? '').replace(',', '.');
    const valorTotal = parseFloat(valorTotalStr);

    console.log('[criar-pagamento] valorTotal recebido:', rawValor, '→ parseado:', valorTotal);

    if (!valorTotal || isNaN(valorTotal) || valorTotal <= 0 || !cliente) {
      return new Response(
        JSON.stringify({ sucesso: false, error: `Dados incompletos: valorTotal inválido (${rawValor}) ou cliente ausente.` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Se o Access Token de produção não estiver configurado nas variáveis do Supabase
    if (!mpAccessToken || mpAccessToken.startsWith("TEST-0000")) {
      return new Response(
        JSON.stringify({
          sucesso: false,
          error: "O Access Token do Mercado Pago ainda não foi configurado nos segredos do Supabase (MERCADO_PAGO_ACCESS_TOKEN)."
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const webhookUrl = Deno.env.get("MERCADO_PAGO_WEBHOOK_URL") || 
      "https://otsbdtoxpxlvordvzjjq.supabase.co/functions/v1/mercadopago-webhook";

    // ═══ FLUXO 1: PAGAMENTO COM CARTÃO DE CRÉDITO (TOKENIZADO) ═══
    if (metodo === "cartao") {
      if (!cardFormData || !cardFormData.token) {
        return new Response(
          JSON.stringify({ sucesso: false, error: "Dados do cartão incompletos ou token ausente." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const cardPayload = {
        transaction_amount: Number(cardFormData.transaction_amount || valorTotal),
        token: cardFormData.token,
        description: `Livro Tesouros em Vaso de Barro (${quantidade || 1}x)`,
        installments: Number(cardFormData.installments || 1),
        payment_method_id: cardFormData.payment_method_id,
        issuer_id: cardFormData.issuer_id ? String(cardFormData.issuer_id) : undefined,
        notification_url: webhookUrl,
        external_reference: pedidoId ? String(pedidoId) : undefined,
        payer: {
          email: cardFormData.payer?.email || cliente.email || "contato@livroingrid.com",
          identification: cardFormData.payer?.identification || {
            type: "CPF",
            number: cliente.cpf ? cliente.cpf.replace(/\D/g, "") : "00000000000"
          }
        }
      };

      const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${mpAccessToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": `${pedidoId || Date.now()}-card-${Date.now()}`
        },
        body: JSON.stringify(cardPayload)
      });

      const mpData = await mpRes.json();

      if (!mpRes.ok) {
        console.error("Erro retornado pelo Mercado Pago para cartão:", mpData);
        const msgErro = mpData.message || mpData.cause?.[0]?.description || "Erro ao autorizar cartão no Mercado Pago.";
        return new Response(
          JSON.stringify({ 
            sucesso: false, 
            error: msgErro, 
            detalhes: mpData 
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Atualiza status no Supabase
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "https://otsbdtoxpxlvordvzjjq.supabase.co";
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      if (supabaseUrl && supabaseKey && pedidoId) {
        try {
          const supabase = createClient(supabaseUrl, supabaseKey);
          let stBanco = "pendente";
          if (mpData.status === "approved") stBanco = "aprovado";
          else if (mpData.status === "rejected") stBanco = "cancelado";

          await supabase
            .from("pedidos")
            .update({
              metodo_pagamento: "cartao",
              status_pagamento: stBanco,
              mercado_pago_id: String(mpData.id)
            })
            .eq("id", pedidoId);
        } catch (dbErr) {
          console.error("Erro ao atualizar status do pedido no Supabase:", dbErr);
        }
      }

      return new Response(
        JSON.stringify({
          sucesso: true,
          metodo: "cartao",
          status: mpData.status,
          status_detail: mpData.status_detail,
          paymentId: String(mpData.id),
          paymentMethod: mpData.payment_method_id,
          installments: mpData.installments
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══ FLUXO 2: PAGAMENTO INSTANTÂNEO COM PIX ═══
    const rawCpf = cliente.cpf ? cliente.cpf.replace(/\D/g, "") : "";
    if (!rawCpf || rawCpf.length !== 11) {
      return new Response(
        JSON.stringify({
          sucesso: false,
          error: "O CPF do titular do pedido é obrigatório para a geração da chave PIX no Mercado Pago."
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const mpPayload = {
      transaction_amount: Number(valorTotal),
      description: `Livro Tesouros em Vaso de Barro (${quantidade || 1}x)`,
      payment_method_id: "pix",
      notification_url: webhookUrl,
      external_reference: pedidoId ? String(pedidoId) : undefined,
      payer: {
        email: cliente.email || "contato@livroingrid.com",
        first_name: cliente.nome?.split(" ")[0] || "Cliente",
        last_name: cliente.nome?.split(" ").slice(1).join(" ") || "Leitor",
        identification: {
          type: "CPF",
          number: rawCpf
        }
      }
    };

    const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${mpAccessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `${pedidoId || Date.now()}-${Date.now()}`
      },
      body: JSON.stringify(mpPayload)
    });

    const mpData = await mpRes.json();

    if (!mpRes.ok) {
      console.error("Erro retornado pelo Mercado Pago:", mpData);
      let msgErro = mpData.message || mpData.cause?.[0]?.description || "Erro ao gerar PIX no Mercado Pago";
      if (msgErro.includes("Collector user without key enabled")) {
        msgErro = "A sua conta do Mercado Pago ainda não possui uma Chave PIX cadastrada. Abra o aplicativo do Mercado Pago, vá em 'Área Pix' > 'Minhas Chaves' e cadastre ao menos uma chave (CPF, Celular ou E-mail) para ativar a geração de QR Codes.";
      }
      return new Response(
        JSON.stringify({ sucesso: false, error: msgErro, detalhes: mpData }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const txData = mpData.point_of_interaction?.transaction_data;

    // Atualiza imediatamente o pedido no Supabase com o ID do pagamento gerado
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "https://otsbdtoxpxlvordvzjjq.supabase.co";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (supabaseUrl && supabaseKey && pedidoId) {
      try {
        const supabase = createClient(supabaseUrl, supabaseKey);
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(pedidoId));
        const isNum = /^\d+$/.test(String(pedidoId));

        if (isUuid) {
          await supabase
            .from("pedidos")
            .update({
              metodo_pagamento: "pix",
              mercado_pago_id: String(mpData.id)
            })
            .eq("id", pedidoId);
        } else if (isNum) {
          await supabase
            .from("pedidos")
            .update({
              metodo_pagamento: "pix",
              mercado_pago_id: String(mpData.id)
            })
            .eq("numero_pedido", parseInt(String(pedidoId), 10));
        }
        console.log(`[criar-pagamento] Pedido ${pedidoId} vinculado ao Mercado Pago ID: ${mpData.id}`);
      } catch (dbErr) {
        console.error("Aviso ao vincular MP ID ao pedido no banco:", dbErr);
      }
    }

    return new Response(
      JSON.stringify({
        sucesso: true,
        modo: "producao",
        paymentId: String(mpData.id),
        copiaECola: txData?.qr_code || "",
        qrCodeBase64: txData?.qr_code_base64 || "",
        qrCodeImgUrl: txData?.qr_code_base64 
          ? `data:image/png;base64,${txData.qr_code_base64}` 
          : `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(txData?.qr_code || "")}`
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("Exceção na Edge Function criar-pagamento:", err);
    return new Response(
      JSON.stringify({ sucesso: false, error: "Erro interno no servidor ao processar pagamento", mensagem: err.message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
