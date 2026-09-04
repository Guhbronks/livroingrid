/**
 * ═══════════════════════════════════════════════════════════════
 * INTEGRAÇÃO MERCADO PAGO — LIVRO "TESOUROS EM VASO DE BARRO"
 * ═══════════════════════════════════════════════════════════════
 * 
 * 🔒 ARQUITETURA SEGURA:
 * O Access Token do Mercado Pago NUNCA fica no frontend.
 * Todas as chamadas para gerar PIX são intermediadas com segurança
 * pela Edge Function 'criar-pagamento' no Supabase.
 */

import { supabase, obterConfiguracoes } from './supabase.js';

export const MERCADO_PAGO_CONFIG = {
  // Public Key pode ficar no frontend para inicializar o SDK visual do Mercado Pago
  PUBLIC_KEY: 'TEST-1e3afb5a-9cf0-4b28-8b67-159cda23b8dd',
  WEBHOOK_URL: 'https://otsbdtoxpxlvordvzjjq.supabase.co/functions/v1/mercadopago-webhook'
};

export async function obterMercadoPagoPublicKey() {
  try {
    const cfg = await obterConfiguracoes();
    if (cfg && cfg.mercadopago_public_key && cfg.mercadopago_public_key.trim()) {
      return cfg.mercadopago_public_key.trim();
    }
  } catch (e) {
    // fallback
  }
  return MERCADO_PAGO_CONFIG.PUBLIC_KEY;
}

/**
 * Cria um pagamento real via PIX invocando a Edge Function do Supabase
 * @param {Object} pedido Dados do pedido e cliente
 * @returns {Promise<{qrCodeBase64: string, copiaECola: string, paymentId: string, sucesso: boolean}>}
 */
export async function gerarPixMercadoPago(pedido) {
  try {
    const { data, error } = await supabase.functions.invoke('criar-pagamento', {
      body: {
        pedidoId: pedido.id || pedido.numeroPedido,
        valorTotal: pedido.valorTotal,
        quantidade: pedido.quantidade || 1,
        cliente: {
          nome: pedido.nome,
          email: pedido.email,
          cpf: pedido.cpf || pedido.cliente?.cpf || '',
          telefone: pedido.telefone,
          cep: pedido.cep,
          logradouro: pedido.logradouro,
          numero: pedido.numero,
          complemento: pedido.complemento,
          bairro: pedido.bairro,
          cidade: pedido.cidade,
          uf: pedido.uf
        }
      }
    });

    if (error) {
      console.warn('⚠️ Falha ao invocar Edge Function criar-pagamento:', error);
      let errorMsg = 'Servidor de pagamentos temporariamente indisponível. Tente novamente em instantes.';
      if (error.message) {
        errorMsg = `Falha no backend de pagamentos (${error.message}). Reimplante a Edge Function 'criar-pagamento'.`;
      }
      return {
        sucesso: false,
        error: errorMsg
      };
    }

    if (data && data.sucesso) {
      return {
        sucesso: true,
        paymentId: data.paymentId,
        copiaECola: data.copiaECola,
        qrCodeBase64: data.qrCodeBase64 || null,
        qrCodeImgUrl: data.qrCodeImgUrl || (data.qrCodeBase64 ? `data:image/png;base64,${data.qrCodeBase64}` : null)
      };
    }

    return {
      sucesso: false,
      error: data?.error || 'Não foi possível gerar a chave PIX no momento.'
    };

  } catch (err) {
    console.error('Erro na integração com backend de pagamento:', err);
    return {
      sucesso: false,
      error: 'Erro de conexão ao gerar o PIX.'
    };
  }
}

/**
 * Consulta o status atualizado do pedido no Supabase
 * @param {string} pedidoId 
 * @returns {Promise<string>} 'aprovado' | 'pendente' | 'cancelado'
 */
export async function consultarStatusMercadoPago(pedidoId) {
  if (!pedidoId) return 'pendente';

  try {
    const { data, error } = await supabase
      .from('pedidos')
      .select('status_pagamento')
      .or(`id.eq.${pedidoId},mercado_pago_id.eq.${pedidoId}`)
      .limit(1);

    if (!error && data && data.length > 0) {
      return data[0].status_pagamento || 'pendente';
    }
    return 'pendente';
  } catch {
    return 'pendente';
  }
}

let mpInstance = null;
let cardBrickController = null;

/**
 * Inicializa o Mercado Pago Card Payment Brick oficial no container da página
 * @param {Object} pedido Dados do pedido e cliente
 * @param {Function} onPaymentSuccess Callback acionado em caso de aprovação ou em análise
 * @param {Function} onPaymentError Callback acionado em caso de recusa
 */
export async function inicializarCardPaymentBrick(pedido, onPaymentSuccess, onPaymentError) {
  const container = document.getElementById('cardPaymentBrick_container');
  const loading = document.getElementById('cardBrickLoading');
  const feedback = document.getElementById('cardPaymentFeedback');

  if (!container) return;

  if (feedback) {
    feedback.style.display = 'none';
    feedback.innerHTML = '';
  }

  // Se o Brick já existir, desmonta a instância anterior antes de recriar com novos valores
  if (cardBrickController && typeof cardBrickController.unmount === 'function') {
    try {
      await cardBrickController.unmount();
      cardBrickController = null;
    } catch (e) {
      console.warn('Aviso ao desmontar Brick anterior:', e);
    }
  }

  container.innerHTML = '';
  if (loading) loading.style.display = 'flex';

  try {
    if (!window.MercadoPago) {
      throw new Error('SDK do Mercado Pago não carregou no navegador.');
    }

    const publicKey = await obterMercadoPagoPublicKey();
    if (!mpInstance || mpInstance.key !== publicKey) {
      mpInstance = new window.MercadoPago(publicKey, { locale: 'pt-BR' });
      mpInstance.key = publicKey;
    }

    const bricksBuilder = mpInstance.bricks();

    const settings = {
      initialization: {
        amount: Number(pedido.valorTotal || 59.90),
        payer: {
          email: pedido.email || 'contato@livroingrid.com',
        },
      },
      customization: {
        visual: {
          style: {
            theme: 'default',
          },
        },
        paymentMethods: {
          maxInstallments: 12,
        },
      },
      callbacks: {
        onReady: () => {
          if (loading) loading.style.display = 'none';
        },
        onSubmit: async (formData) => {
          return new Promise(async (resolve, reject) => {
            try {
              if (loading) loading.style.display = 'flex';
              if (feedback) feedback.style.display = 'none';

              const resultado = await processarPagamentoCartao({
                pedidoId: pedido.id || pedido.numeroPedido,
                valorTotal: pedido.valorTotal,
                quantidade: pedido.quantidade || 1,
                cliente: {
                  nome: pedido.nome,
                  email: pedido.email,
                  telefone: pedido.telefone,
                  cep: pedido.cep,
                  logradouro: pedido.logradouro,
                  numero: pedido.numero,
                  complemento: pedido.complemento,
                  bairro: pedido.bairro,
                  cidade: pedido.cidade,
                  uf: pedido.uf,
                  cpf: pedido.cpf
                },
                cardFormData: formData
              });

              if (loading) loading.style.display = 'none';

              if (resultado && resultado.sucesso) {
                if (resultado.status === 'approved') {
                  if (feedback) {
                    feedback.style.display = 'block';
                    feedback.className = 'pix-pending-notice';
                    feedback.style.background = '#f0fdf4';
                    feedback.style.borderColor = '#86efac';
                    feedback.style.color = '#166534';
                    feedback.innerHTML = `✅ <strong>Pagamento Aprovado com Sucesso!</strong> Pedido finalizado.`;
                  }
                  if (onPaymentSuccess) onPaymentSuccess(resultado);
                } else if (resultado.status === 'in_process') {
                  if (feedback) {
                    feedback.style.display = 'block';
                    feedback.className = 'pix-pending-notice';
                    feedback.innerHTML = `⏳ <strong>Pagamento em análise!</strong> A sua operadora está analisando a transação. O status do seu pedido será atualizado em instantes.`;
                  }
                  if (onPaymentSuccess) onPaymentSuccess(resultado);
                } else {
                  // status === 'rejected'
                  const detalhe = traduzirRejeicaoCartao(resultado.status_detail);
                  if (feedback) {
                    feedback.style.display = 'block';
                    feedback.className = 'pix-pending-notice';
                    feedback.style.background = '#fef2f2';
                    feedback.style.borderColor = '#fca5a5';
                    feedback.style.color = '#991b1b';
                    feedback.innerHTML = `❌ <strong>Cartão não aprovado:</strong> ${detalhe}`;
                  }
                  if (onPaymentError) onPaymentError(resultado);
                }
                resolve();
              } else {
                if (feedback) {
                  feedback.style.display = 'block';
                  feedback.className = 'pix-pending-notice';
                  feedback.style.background = '#fef2f2';
                  feedback.style.borderColor = '#fca5a5';
                  feedback.style.color = '#991b1b';
                  feedback.innerHTML = `❌ ${resultado?.error || 'Erro ao processar cobrança. Verifique os dados ou tente outro cartão.'}`;
                }
                reject();
              }
            } catch (err) {
              if (loading) loading.style.display = 'none';
              console.error('Erro ao processar cartão:', err);
              if (feedback) {
                feedback.style.display = 'block';
                feedback.className = 'pix-pending-notice';
                feedback.style.background = '#fef2f2';
                feedback.style.borderColor = '#fca5a5';
                feedback.style.color = '#991b1b';
                feedback.innerText = 'Falha na comunicação com o processador de pagamentos.';
              }
              reject(err);
            }
          });
        },
        onError: (error) => {
          if (loading) loading.style.display = 'none';
          console.error('Erro no Card Payment Brick:', error);
          if (feedback) {
            feedback.style.display = 'block';
            feedback.className = 'pix-pending-notice';
            feedback.style.background = '#fef2f2';
            feedback.style.borderColor = '#fca5a5';
            feedback.style.color = '#991b1b';
            feedback.innerText = 'Não foi possível inicializar os campos do cartão. Verifique sua conexão.';
          }
        },
      },
    };

    cardBrickController = await bricksBuilder.create(
      'cardPayment',
      'cardPaymentBrick_container',
      settings
    );
  } catch (err) {
    if (loading) loading.style.display = 'none';
    console.error('Falha ao renderizar Card Payment Brick:', err);
    if (container) {
      container.innerHTML = `
        <div style="display: block; padding: 1rem; text-align: center; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; color: #92400e;">
          <p style="margin: 0 0 .5rem 0; font-weight: 700;">⚠️ Não foi possível carregar o formulário seguro de cartão de crédito.</p>
          <small>Verifique se as credenciais do Mercado Pago estão ativas ou tente efetuar o pagamento via PIX.</small>
        </div>
      `;
    }
  }
}

/**
 * Envia o cartão tokenizado para a Edge Function segura
 */
export async function processarPagamentoCartao(dados) {
  try {
    const { data, error } = await supabase.functions.invoke('criar-pagamento', {
      body: {
        metodo: 'cartao',
        pedidoId: dados.pedidoId,
        valorTotal: dados.valorTotal,
        quantidade: dados.quantidade,
        cliente: dados.cliente,
        cardFormData: dados.cardFormData
      }
    });

    if (error) {
      console.error('Erro retornado pela Edge Function criar-pagamento:', error);
      return {
        sucesso: false,
        error: 'Erro no servidor de pagamentos ao autorizar cartão.'
      };
    }

    return data;
  } catch (err) {
    console.error('Exceção ao chamar processarPagamentoCartao:', err);
    return {
      sucesso: false,
      error: 'Erro de conexão ao processar cartão.'
    };
  }
}

/**
 * Traduz os códigos de recusa de cartão do Mercado Pago para mensagens amigáveis
 */
export function traduzirRejeicaoCartao(statusDetail) {
  const mensagens = {
    cc_rejected_bad_filled_card_number: 'Número do cartão inválido.',
    cc_rejected_bad_filled_date: 'Data de validade incorreta.',
    cc_rejected_bad_filled_other: 'Dados do cartão incorretos.',
    cc_rejected_bad_filled_security_code: 'Código de segurança (CVV) inválido.',
    cc_rejected_call_for_authorize: 'Autorização necessária com a operadora do cartão.',
    cc_rejected_card_disabled: 'O cartão informado está desativado.',
    cc_rejected_card_error: 'Não foi possível processar este cartão.',
    cc_rejected_duplicated_payment: 'Você já fez um pagamento com esse mesmo valor recentemente.',
    cc_rejected_high_risk: 'Transação recusada por políticas de segurança da operadora.',
    cc_rejected_insufficient_amount: 'Saldo ou limite insuficiente no cartão.',
    cc_rejected_invalid_installments: 'Número de parcelas inválido para este cartão.',
    cc_rejected_max_attempts: 'Limite de tentativas excedido. Tente novamente mais tarde.',
  };
  return mensagens[statusDetail] || 'Pagamento recusado pela operadora. Verifique o limite ou tente outro cartão.';
}
