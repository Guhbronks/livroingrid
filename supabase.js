import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Configuração do Supabase fornecida pelo cliente
export const SUPABASE_URL = 'https://otsbdtoxpxlvordvzjjq.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_giFodHnIA9pN4sj0-bNowA_1hqi6Y_k';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Salva um novo pedido no Supabase através da RPC segura salvar_pedido_checkout
 * (Bypassa RLS com SECURITY DEFINER sem expor dados de outros pedidos aos clientes anônimos)
 * @param {Object} pedido 
 * @returns {Promise<{data: any, error: any}>}
 */
export async function salvarPedido(pedido) {
  try {
    const payload = {
      cliente_nome: pedido.nome,
      cliente_email: pedido.email,
      cliente_telefone: pedido.telefone,
      cep: pedido.cep,
      logradouro: pedido.logradouro,
      numero: pedido.numero,
      complemento: pedido.complemento || '',
      bairro: pedido.bairro,
      cidade: pedido.cidade,
      uf: pedido.uf,
      quantidade: pedido.quantidade || 1,
      opcao_frete: pedido.opcaoFrete || 'Registro Módico (Livros)',
      valor_livro: pedido.valorLivro || 59.90,
      valor_frete: pedido.valorFrete || 12.90,
      valor_total: pedido.valorTotal,
      metodo_pagamento: pedido.metodoPagamento || 'pix',
      mercado_pago_id: pedido.mercadoPagoId || null,
      observacoes: pedido.observacoes || '',
      cupom_codigo: pedido.cupomCodigo || null,
      valor_desconto: pedido.valorDesconto || 0.00,
      is_presente: Boolean(pedido.isPresente),
      presente_destinatario: pedido.presenteDestinatario || null,
      presente_mensagem: pedido.presenteMensagem || null,
      presente_endereco_diferente: Boolean(pedido.presenteEnderecoDiferente),
      presente_cep: pedido.presenteCep || null,
      presente_logradouro: pedido.presenteLogradouro || null,
      presente_numero: pedido.presenteNumero || null,
      presente_complemento: pedido.presenteComplemento || null,
      presente_bairro: pedido.presenteBairro || null,
      presente_cidade: pedido.presenteCidade || null,
      presente_uf: pedido.presenteUf || null
    };

    // Usar RPC salvar_pedido_checkout para evitar erro 42501 de RLS no RETURNING *
    const { data, error } = await supabase.rpc('salvar_pedido_checkout', { p_pedido: payload });

    if (error) {
      console.error('Erro ao salvar pedido no Supabase via RPC:', error);
      return { data: null, error };
    }

    return { data, error: null };
  } catch (err) {
    console.error('Exceção ao inserir pedido:', err);
    return { data: null, error: err };
  }
}

/**
 * Busca todos os pedidos ordenados pelo mais recente
 * @returns {Promise<{data: any[], error: any}>}
 */
export async function listarPedidos() {
  try {
    const { data, error } = await supabase
      .from('pedidos')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao listar pedidos do Supabase:', error);
      return { data: [], error };
    }

    return { data: data || [], error: null };
  } catch (err) {
    console.error('Exceção ao listar pedidos:', err);
    return { data: [], error: err };
  }
}

/**
 * Atualiza campos de um pedido específico
 * @param {string} id UUID do pedido
 * @param {Object} updates Objeto com os campos a atualizar
 * @returns {Promise<{data: any, error: any}>}
 */
export async function atualizarPedido(id, updates) {
  try {
    // Se o usuário for administrador autenticado, executa update direto
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const { data, error } = await supabase
        .from('pedidos')
        .update(updates)
        .eq('id', id)
        .select();

      if (error) {
        console.error('Erro ao atualizar pedido (admin):', error);
        return { data: null, error };
      }

      return { data: data?.[0], error: null };
    }

    // Se for cliente em checkout anônimo, usa a RPC atualizar_pedido_checkout
    const { error: rpcError } = await supabase.rpc('atualizar_pedido_checkout', {
      p_id: id,
      p_metodo: updates.metodo_pagamento || null,
      p_mp_id: updates.mercado_pago_id ? String(updates.mercado_pago_id) : null
    });

    if (rpcError) {
      console.error('Erro ao atualizar pedido via RPC:', rpcError);
      return { data: null, error: rpcError };
    }

    return { data: { id, ...updates }, error: null };
  } catch (err) {
    console.error('Exceção ao atualizar pedido:', err);
    return { data: null, error: err };
  }
}

/**
 * Retorna as métricas consolidadas dos pedidos para o Dashboard
 */
export async function obterMetricas() {
  const { data: pedidos, error } = await listarPedidos();
  if (error || !pedidos) {
    return {
      faturamentoTotal: 0,
      totalVendas: 0,
      vendasCartao: 0,
      vendasPix: 0,
      pedidosPendentes: 0,
      pedidosAguardandoEnvio: 0,
      pedidosEnviados: 0,
      pedidos: []
    };
  }

  let faturamentoTotal = 0;
  let totalVendas = pedidos.length;
  let vendasCartao = 0;
  let vendasPix = 0;
  let pedidosPendentes = 0;
  let pedidosAguardandoEnvio = 0;
  let pedidosEnviados = 0;

  pedidos.forEach(p => {
    const total = parseFloat(p.valor_total) || 0;
    
    // Contabiliza faturamento se aprovado ou pago
    if (p.status_pagamento === 'aprovado' || p.status_pagamento === 'pago') {
      faturamentoTotal += total;
    }

    // Métodos de pagamento
    if (p.metodo_pagamento === 'cartao') {
      vendasCartao++;
    } else if (p.metodo_pagamento === 'pix') {
      vendasPix++;
    }

    // Status de envio e pagamento
    if (p.status_pagamento === 'pendente') {
      pedidosPendentes++;
    }

    if (p.status_envio === 'aguardando_envio') {
      pedidosAguardandoEnvio++;
    } else if (p.status_envio === 'enviado') {
      pedidosEnviados++;
    }
  });

  return {
    faturamentoTotal,
    totalVendas,
    vendasCartao,
    vendasPix,
    pedidosPendentes,
    pedidosAguardandoEnvio,
    pedidosEnviados,
    pedidos
  };
}

/* ═════════════════════════════════════════════
   CUPONS DE DESCONTO
════════════════════════════════════════════════ */

/**
 * Valida um cupom de desconto através da RPC segura validar_cupom
 * @param {string} codigo Código digitado pelo cliente
 * @returns {Promise<{data: any, error: any}>}
 */
export async function validarCupom(codigo) {
  try {
    const { data, error } = await supabase.rpc('validar_cupom', {
      p_codigo: String(codigo || '').trim()
    });

    if (error) {
      console.error('Erro ao validar cupom via RPC:', error);
      return { data: { valido: false, mensagem: 'Erro de comunicação ao validar cupom.' }, error };
    }

    return { data, error: null };
  } catch (err) {
    console.error('Exceção ao validar cupom:', err);
    return { data: { valido: false, mensagem: 'Erro ao validar cupom.' }, error: err };
  }
}

/**
 * Lista todos os cupons cadastrados (Apenas Admin autenticado)
 */
export async function listarCupons() {
  try {
    const { data, error } = await supabase
      .from('cupons')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao listar cupons:', error);
      return { data: [], error };
    }

    return { data: data || [], error: null };
  } catch (err) {
    console.error('Exceção ao listar cupons:', err);
    return { data: [], error: err };
  }
}

/**
 * Cria um novo cupom no banco (Apenas Admin)
 * @param {Object} cupom { codigo, tipo, valor, usos_maximos, validade }
 */
export async function criarCupom(cupom) {
  try {
    const { data, error } = await supabase
      .from('cupons')
      .insert([{
        codigo: String(cupom.codigo).toUpperCase().trim(),
        tipo: cupom.tipo, // 'porcentagem' | 'frete_gratis' | 'fixo'
        valor: parseFloat(cupom.valor) || 0.00,
        ativo: true,
        usos_maximos: cupom.usos_maximos ? parseInt(cupom.usos_maximos, 10) : null,
        validade: cupom.validade ? new Date(cupom.validade).toISOString() : null
      }])
      .select();

    if (error) {
      console.error('Erro ao criar cupom:', error);
      return { data: null, error };
    }

    return { data: data?.[0], error: null };
  } catch (err) {
    console.error('Exceção ao criar cupom:', err);
    return { data: null, error: err };
  }
}

/**
 * Altera status ativo/inativo de um cupom (Apenas Admin)
 */
export async function alternarStatusCupom(id, ativo) {
  try {
    const { data, error } = await supabase
      .from('cupons')
      .update({ ativo })
      .eq('id', id)
      .select();

    if (error) {
      console.error('Erro ao alterar status do cupom:', error);
      return { data: null, error };
    }

    return { data: data?.[0], error: null };
  } catch (err) {
    console.error('Exceção ao alterar status do cupom:', err);
    return { data: null, error: err };
  }
}

/**
 * Deleta um cupom do banco (Apenas Admin)
 */
export async function excluirCupom(id) {
  try {
    const { data, error } = await supabase
      .from('cupons')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Erro ao excluir cupom:', error);
      return { data: null, error };
    }

    return { data, error: null };
  } catch (err) {
    console.error('Exceção ao excluir cupom:', err);
    return { data: null, error: err };
  }
}

/* ═════════════════════════════════════════════
   CONFIGURAÇÕES DINÂMICAS (PREÇO DO LIVRO)
════════════════════════════════════════════════ */

/**
 * Obtém as configurações públicas (preço atual e riscado do livro)
 */
export async function obterConfiguracoes() {
  try {
    const { data, error } = await supabase
      .from('configuracoes')
      .select('*');

    if (error || !data) {
      console.warn('Configurações não carregadas, usando padrões locais.');
      return {
        preco_livro: 59.90,
        preco_original: 89.90
      };
    }

    const map = {};
    data.forEach(item => {
      map[item.chave] = item.valor;
    });

    return {
      preco_livro: parseFloat(map.preco_livro) || 59.90,
      preco_original: parseFloat(map.preco_original) || 89.90
    };
  } catch (err) {
    console.warn('Exceção ao obter configurações:', err);
    return {
      preco_livro: 59.90,
      preco_original: 89.90
    };
  }
}

/**
 * Atualiza uma configuração no banco (Apenas Admin)
 * @param {string} chave 
 * @param {string} valor 
 */
export async function atualizarConfiguracao(chave, valor) {
  try {
    const { data, error } = await supabase
      .from('configuracoes')
      .upsert({
        chave,
        valor: String(valor),
        updated_at: new Date().toISOString()
      })
      .select();

    if (error) {
      console.error(`Erro ao atualizar configuração ${chave}:`, error);
      return { data: null, error };
    }

    return { data: data?.[0], error: null };
  } catch (err) {
    console.error('Exceção ao atualizar configuração:', err);
    return { data: null, error: err };
  }
}

