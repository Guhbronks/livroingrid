import { supabase } from './supabase.js';

let pedidoAtivo = null;
let realtimeChannel = null;

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const q = urlParams.get('q') || urlParams.get('pedido') || '';
  if (q) {
    document.getElementById('trackingInput').value = q;
    buscarPedidoPorTermo(q);
  }
});

export async function buscarPedidoCliente(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('trackingInput');
  const termo = input.value.trim();
  if (!termo) return;
  await buscarPedidoPorTermo(termo);
}

async function buscarPedidoPorTermo(termo) {
  const feedback = document.getElementById('trackingFeedback');
  const resultBox = document.getElementById('trackingResultBox');
  const btn = document.getElementById('btnBuscarPedido');

  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Consultando...';
  }
  feedback.style.display = 'none';
  resultBox.classList.remove('show');

  const termoLimpo = termo.trim();
  const digitosApenas = termoLimpo.replace(/\D/g, '');
  const ehEmail = termoLimpo.includes('@');

  try {
    let pedidos = null;
    let error = null;

    // 1. Tenta a busca inteligente via RPC (suporta telefone com/sem máscara, DDD, e-mail e nº pedido)
    try {
      const rpcRes = await supabase.rpc('buscar_pedido_rastreio', { p_termo: termoLimpo });
      if (!rpcRes.error && rpcRes.data && rpcRes.data.length > 0) {
        pedidos = rpcRes.data;
      }
    } catch (eRpc) {
      console.warn('RPC buscar_pedido_rastreio fallback:', eRpc);
    }

    // 2. Se não encontrou via RPC, executa busca direta de contingência
    if (!pedidos || pedidos.length === 0) {
      let query = supabase.from('pedidos').select('*');

      if (ehEmail) {
        query = query.ilike('cliente_email', `%${termoLimpo}%`);
      } else if (digitosApenas.length >= 8) {
        let phoneNum = digitosApenas;
        if (phoneNum.startsWith('55') && phoneNum.length >= 12) {
          phoneNum = phoneNum.slice(2);
        }
        query = query.or(`cliente_telefone_clean.ilike.%${phoneNum}%,cliente_telefone.ilike.%${phoneNum}%,cliente_telefone.ilike.%${termoLimpo}%`);
      } else if (digitosApenas.length > 0) {
        query = query.eq('numero_pedido', parseInt(digitosApenas, 10));
      } else {
        query = query.ilike('cliente_nome', `%${termoLimpo}%`);
      }

      const directRes = await query.order('created_at', { ascending: false });
      if (directRes.data && directRes.data.length > 0) {
        pedidos = directRes.data;
      }
      if (directRes.error && (!pedidos || pedidos.length === 0)) {
        error = directRes.error;
      }
    }

    if (btn) {
      btn.disabled = false;
      btn.innerText = 'Consultar Pedido';
    }

    if (error) {
      feedback.style.display = 'block';
      feedback.innerText = '⚠️ Ocorreu um erro ao consultar o pedido. Verifique o termo digitado ou tente novamente.';
      console.error('Erro na consulta de rastreio:', error);
      return;
    }

    if (!pedidos || pedidos.length === 0) {
      feedback.style.display = 'block';
      feedback.innerText = `🔍 Nenhum pedido localizado com "${termo}". Verifique se digitou o mesmo e-mail ou WhatsApp cadastrado na compra.`;
      return;
    }

    // Pega o pedido mais recente
    pedidoAtivo = pedidos[0];
    renderizarPedido(pedidoAtivo);
    conectarRealtime(pedidoAtivo.id);

  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.innerText = 'Consultar Pedido';
    }
    feedback.style.display = 'block';
    feedback.innerText = 'Erro de conexão. Verifique sua internet e tente novamente.';
    console.error('Exceção rastreio:', err);
  }
}

function renderizarPedido(p) {
  const resultBox = document.getElementById('trackingResultBox');
  const numPedido = `#TB-${p.numero_pedido || p.id.slice(0, 4).toUpperCase()}`;

  document.getElementById('orderTitleDisplay').innerText = `Pedido ${numPedido}`;
  document.getElementById('orderDateDisplay').innerText = `Realizado em ${formatarData(p.created_at)}`;

  // Badge Pagamento
  const badgeContainer = document.getElementById('paymentBadgeContainer');
  if (p.status_pagamento === 'aprovado' || p.status_pagamento === 'pago') {
    badgeContainer.innerHTML = '<span class="badge badge-pago">✓ Pagamento Aprovado</span>';
  } else if (p.status_pagamento === 'cancelado') {
    badgeContainer.innerHTML = '<span class="badge badge-cancelado">✕ Pagamento Cancelado</span>';
  } else {
    badgeContainer.innerHTML = '<span class="badge badge-pendente">⏱️ Aguardando Confirmação</span>';
  }

  // Renderiza Timeline dos Correios / Envio
  renderizarTimeline(p);

  // Banner de Código de Rastreio
  const bannerRastreio = document.getElementById('trackingCodeBanner');
  const codeDisplay = document.getElementById('trackingCodeDisplay');
  const linkCorreios = document.getElementById('correiosTrackBtn');

  if (p.codigo_rastreio && p.codigo_rastreio.trim()) {
    bannerRastreio.style.display = 'block';
    codeDisplay.innerText = p.codigo_rastreio;
    linkCorreios.href = `https://rastreamento.correios.com.br/app/index.php?codigo=${encodeURIComponent(p.codigo_rastreio)}`;
  } else {
    bannerRastreio.style.display = 'none';
  }

  // Detalhes da entrega
  document.getElementById('destinatarioDisplay').innerText = p.cliente_nome;
  document.getElementById('telefoneDisplay').innerText = p.cliente_telefone;

  const compl = p.complemento ? ` (${p.complemento})` : '';
  document.getElementById('enderecoDisplay').innerText = `${p.logradouro}, nº ${p.numero}${compl} — Bairro ${p.bairro}, ${p.cidade}/${p.uf} · CEP: ${p.cep}`;
  document.getElementById('freteDisplay').innerText = p.opcao_frete || 'Registro Módico (Livros)';
  document.getElementById('quantidadeDisplay').innerText = `${p.quantidade || 1} exemplar(es) físico(s)`;

  // Botão suporte WhatsApp
  const waBtn = document.getElementById('whatsappSupportBtn');
  if (waBtn) {
    const msg = `Olá! Gostaria de informações sobre o meu pedido ${numPedido} do livro Tesouros em Vaso de Barro.`;
    waBtn.href = `https://wa.me/5514991292490?text=${encodeURIComponent(msg)}`;
  }

  resultBox.classList.add('show');
}

function renderizarTimeline(p) {
  const container = document.getElementById('trackingTimeline');
  const pago = p.status_pagamento === 'aprovado' || p.status_pagamento === 'pago';
  const statusEnvio = p.status_envio || 'aguardando_envio';

  // 1. Pedido Realizado
  let step1Class = 'completed';

  // 2. Pagamento
  let step2Class = pago ? 'completed' : 'current';

  // 3. Em Preparação
  let step3Class = '';
  if (pago) {
    if (statusEnvio === 'em_separacao') {
      step3Class = 'current';
    } else if (statusEnvio === 'enviado' || statusEnvio === 'entregue') {
      step3Class = 'completed';
    } else {
      step3Class = 'current'; // aguardando envio pós-pago
    }
  }

  // 4. Postado nos Correios
  let step4Class = '';
  if (statusEnvio === 'enviado') {
    step4Class = 'current';
  } else if (statusEnvio === 'entregue') {
    step4Class = 'completed';
  }

  // 5. Entregue
  let step5Class = statusEnvio === 'entregue' ? 'completed' : '';

  container.innerHTML = `
    <!-- PASSO 1: PEDIDO RECEBIDO -->
    <div class="timeline-step ${step1Class}">
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <strong>1. Pedido Realizado</strong>
        <p>Recebemos o registro da sua compra em nosso sistema.</p>
        <span class="step-time">${formatarData(p.created_at)}</span>
      </div>
    </div>

    <!-- PASSO 2: PAGAMENTO -->
    <div class="timeline-step ${step2Class}">
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <strong>2. Confirmação do Pagamento</strong>
        <p>${pago ? `Pagamento aprovado com sucesso via ${p.metodo_pagamento?.toUpperCase() || 'PIX'}.` : 'Aguardando compensação pelo banco ou emissor do cartão.'}</p>
      </div>
    </div>

    <!-- PASSO 3: EM PREPARAÇÃO -->
    <div class="timeline-step ${step3Class}">
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <strong>3. Preparação & Dedicatória</strong>
        <p>${step3Class === 'completed' ? 'Livro revisado, autografado com carinho e embalado com proteção.' : (pago ? '📦 <strong>Em preparação:</strong> seu livro físico está sendo separado com carinho em Botucatu/SP e será postado em até 48 horas úteis!' : 'Iniciará imediatamente após a aprovação do pagamento.')}</p>
      </div>
    </div>

    <!-- PASSO 4: POSTAGEM NOS CORREIOS -->
    <div class="timeline-step ${step4Class}">
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <strong>4. Postado nos Correios</strong>
        <p>${p.codigo_rastreio ? `Pacote despachado via <strong>${p.opcao_frete || 'Correios'}</strong>! Código de rastreamento: <strong>${p.codigo_rastreio}</strong>.` : (statusEnvio === 'enviado' ? 'Pacote postado na agência dos Correios em trânsito para o seu endereço.' : 'Aguardando despacho nos Correios.')}</p>
      </div>
    </div>

    <!-- PASSO 5: ENTREGUE -->
    <div class="timeline-step ${step5Class}">
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <strong>5. Entregue ao Destinatário</strong>
        <p>${step5Class === 'completed' ? '🎉 Exemplar entregue no endereço cadastrado! Tenha uma leitura abençoada.' : 'Previsão de entrega conforme modalidade de envio escolhida.'}</p>
      </div>
    </div>
  `;
}

function formatarData(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoString;
  }
}

/**
 * Assina o Supabase Realtime para que a tela do cliente mude sozinha
 * assim que o administrador despachar o pedido no painel!
 */
function conectarRealtime(pedidoId) {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabase
    .channel(`rastreio-live-${pedidoId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'pedidos',
        filter: `id=eq.${pedidoId}`
      },
      (payload) => {
        if (payload && payload.new) {
          console.log('⚡ Atualização em tempo real recebida do Supabase!', payload.new);
          pedidoAtivo = payload.new;
          renderizarPedido(pedidoAtivo);
        }
      }
    )
    .subscribe();
}

window.buscarPedidoCliente = buscarPedidoCliente;
