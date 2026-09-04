import { 
  supabase, 
  listarPedidos, 
  atualizarPedido,
  excluirPedido,
  listarCupons,
  criarCupom,
  alternarStatusCupom,
  excluirCupom,
  obterConfiguracoes,
  atualizarConfiguracao
} from './supabase.js';

// Estado dos pedidos na tela do admin
let pedidosGlobais = [];
let pedidosFiltrados = [];
let realtimeChannel = null;
let currentLabelOrderId = null;

document.addEventListener('DOMContentLoaded', () => {
  verificarSessao();
});

/* ══════════════════════════════
   AUTENTICAÇÃO REAL VIA SUPABASE AUTH
   ══════════════════════════════ */
async function verificarSessao() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (session && session.user) {
      document.getElementById('authOverlay').style.display = 'none';
      document.getElementById('adminWrapper').style.display = 'block';
      carregarDados();
      iniciarRealtimeAdmin();
    } else {
      document.getElementById('authOverlay').style.display = 'flex';
      document.getElementById('adminWrapper').style.display = 'none';
    }
  } catch (err) {
    console.error('Erro ao verificar sessão do admin:', err);
    document.getElementById('authOverlay').style.display = 'flex';
    document.getElementById('adminWrapper').style.display = 'none';
  }
}

export async function handleLogin(e) {
  e.preventDefault();
  const emailInput = document.getElementById('adminEmail');
  const passInput = document.getElementById('adminPass');
  const error = document.getElementById('authError');
  const submitBtn = document.getElementById('btnAdminLogin');

  const email = emailInput.value.trim();
  const password = passInput.value;

  if (!email || !password) return;

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = 'Autenticando...';
  }
  error.innerText = '';

  try {
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      error.innerText = `⚠️ ${authError.message || 'Credenciais inválidas. Verifique seu e-mail e senha.'}`;
      passInput.value = '';
      passInput.focus();
    } else if (data && data.session) {
      document.getElementById('authOverlay').style.display = 'none';
      document.getElementById('adminWrapper').style.display = 'block';
      carregarDados();
      iniciarRealtimeAdmin();
    }
  } catch (err) {
    error.innerText = '⚠️ Ocorreu um erro ao conectar ao servidor. Tente novamente.';
    console.error('Exceção no login do admin:', err);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = 'Entrar no Painel';
    }
  }
}

export async function logoutAdmin() {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.warn('Erro ao encerrar sessão:', err);
  }
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  window.location.reload();
}

/* ══════════════════════════════
   CARREGAMENTO E MÉTRICAS
   ══════════════════════════════ */
export async function carregarDados() {
  const tbody = document.getElementById('ordersTableBody');

  const { data: pedidos, error } = await listarPedidos();
  const dbBadge = document.getElementById('dbStatusBadge');

  if (error) {
    if (dbBadge) {
      dbBadge.className = 'db-status-badge';
      dbBadge.innerHTML = '<span class="dot" style="background:#dc2626;"></span> Supabase: Verifique o SQL';
    }
    console.warn('Aviso do Supabase:', error);
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" class="empty-state" style="color: #b45309;">
            <strong>⚠️ Tabela de pedidos ainda não criada no Supabase!</strong><br>
            Execute o script <code>supabase_schema.sql</code> no SQL Editor do seu Supabase.<br>
          </td>
        </tr>
      `;
    }
    return;
  }

  if (dbBadge) {
    dbBadge.className = 'db-status-badge online';
    dbBadge.innerHTML = '<span class="dot"></span> Supabase Conectado em Tempo Real';
  }

  pedidosGlobais = pedidos || [];
  filtrarPedidos();
  atualizarMetricasNaTela();
}

function atualizarMetricasNaTela() {
  let faturamentoTotal = 0;
  let totalVendas = pedidosGlobais.length;
  let vendasCartao = 0;
  let vendasPix = 0;
  let pedidosAguardandoEnvio = 0;
  let pedidosEnviados = 0;

  pedidosGlobais.forEach(p => {
    const total = parseFloat(p.valor_total) || 0;
    if (p.status_pagamento === 'aprovado' || p.status_pagamento === 'pago') {
      faturamentoTotal += total;
    }
    if (p.metodo_pagamento === 'cartao') vendasCartao++;
    if (p.metodo_pagamento === 'pix') vendasPix++;
    if (p.status_envio === 'aguardando_envio' || p.status_envio === 'em_separacao') {
      pedidosAguardandoEnvio++;
    }
    if (p.status_envio === 'enviado' || p.status_envio === 'entregue') {
      pedidosEnviados++;
    }
  });

  document.getElementById('kpiFaturamento').innerText = `R$ ${faturamentoTotal.toFixed(2).replace('.', ',')}`;
  document.getElementById('kpiTotalVendas').innerText = totalVendas;
  document.getElementById('kpiPix').innerText = vendasPix;
  document.getElementById('kpiCartao').innerText = vendasCartao;
  document.getElementById('kpiAguardandoEnvio').innerText = pedidosAguardandoEnvio;
  document.getElementById('kpiEnviados').innerText = pedidosEnviados;
}

/* ══════════════════════════════
   FILTROS E BUSCA
   ══════════════════════════════ */
export function filtrarPedidos() {
  const termo = document.getElementById('searchInput')?.value.toLowerCase().trim() || '';
  const filtroPagamento = document.getElementById('filterPagamento')?.value || 'todos';
  const filtroEnvio = document.getElementById('filterEnvio')?.value || 'todos';

  pedidosFiltrados = pedidosGlobais.filter(p => {
    const nome = (p.cliente_nome || '').toLowerCase();
    const email = (p.cliente_email || '').toLowerCase();
    const tel = (p.cliente_telefone || '').toLowerCase();
    const telClean = (p.cliente_telefone_clean || p.cliente_telefone || '').replace(/\D/g, '');
    const termoClean = termo.replace(/\D/g, '');
    const matchesTel = tel.includes(termo) || (termoClean.length >= 4 && telClean.includes(termoClean));
    const cidade = (p.cidade || '').toLowerCase();
    const numPed = `#tb-${p.numero_pedido || ''}`.toLowerCase();
    const rastreio = (p.codigo_rastreio || '').toLowerCase();

    const matchesSearch = !termo || nome.includes(termo) || email.includes(termo) || matchesTel || cidade.includes(termo) || numPed.includes(termo) || rastreio.includes(termo);

    const matchesPagamento = filtroPagamento === 'todos' || p.status_pagamento === filtroPagamento;
    const matchesEnvio = filtroEnvio === 'todos' || p.status_envio === filtroEnvio;

    return matchesSearch && matchesPagamento && matchesEnvio;
  });

  renderizarTabela();
}

/* ══════════════════════════════
   RENDERIZAÇÃO DA TABELA
   ══════════════════════════════ */
function renderizarTabela() {
  const tbody = document.getElementById('ordersTableBody');
  const countDisplay = document.getElementById('tableCountDisplay');
  if (!tbody) return;

  if (countDisplay) {
    countDisplay.innerText = `${pedidosFiltrados.length} pedido(s) listado(s)`;
  }

  if (pedidosFiltrados.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="empty-state">
          Nenhum pedido encontrado com os filtros selecionados.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = pedidosFiltrados.map(p => {
    const dataHora = formatarDataHora(p.created_at);
    const numPedido = `#TB-${p.numero_pedido || p.id.slice(0, 4).toUpperCase()}`;
    const compl = p.complemento ? ` (${p.complemento})` : '';
    const endereco = `${p.logradouro}, nº ${p.numero}${compl}, Bairro ${p.bairro} — ${p.cidade}/${p.uf}`;

    const badgePagamento = getBadgePagamento(p.status_pagamento);
    const envioBlock = getEnvioBlock(p);

    const totalFormatado = `R$ ${parseFloat(p.valor_total || 0).toFixed(2).replace('.', ',')}`;
    const linkWhatsApp = gerarLinkWhatsApp(p);

    return `
      <tr>
        <td>
          <div class="order-date">${dataHora}</div>
        </td>
        <td>
          <span class="order-num-badge">${numPedido}</span>
          ${p.is_presente ? '<br><span class="badge-gift" title="Pedido para presente">🎁 Presente</span>' : ''}
        </td>
        <td>
          <div class="client-info">
            <strong>${p.cliente_nome}</strong>
            ${p.is_presente && p.presente_destinatario ? `<small style="color: #b45309; font-weight: 700; display: block; margin-top: .15rem;">🎁 Para: ${p.presente_destinatario}</small>` : ''}
          </div>
        </td>
        <td>
          <div class="client-info">
            <span>${p.cliente_telefone}</span>
            <span>${p.cliente_email}</span>
          </div>
        </td>
        <td>
          <div class="address-cell">
            ${endereco}<br>
            <span class="cep-chip">CEP: ${p.cep}</span>
          </div>
        </td>
        <td>
          <strong>${p.quantidade || 1} un.</strong><br>
          <small style="color: #6b655f;">${p.opcao_frete || 'Módico'}</small>
        </td>
        <td>
          <strong style="color: #16a34a;">${totalFormatado}</strong><br>
          <small style="text-transform: uppercase; font-size: .68rem;">${p.metodo_pagamento || 'PIX'}</small>
        </td>
        <td>${badgePagamento}</td>
        <td>${envioBlock}</td>
        <td>
          <div class="actions-cell">
            <a href="${linkWhatsApp}" target="_blank" class="btn-action btn-action-wa" title="Notificar/Conversar no WhatsApp">
              💬
            </a>
            <button class="btn-action btn-action-edit" onclick="abrirModalEdicao('${p.id}')" title="Editar Informações">
              ✏️
            </button>
            ${p.is_presente ? `
              <button class="btn-action" style="background: #fef3c7; border: 1px solid #fde68a;" onclick="abrirCartaoPresenteModal('${p.id}')" title="Imprimir Cartão de Presente">
                🎁
              </button>
            ` : ''}
            <button class="btn-action btn-action-print" onclick="abrirModalEtiqueta('${p.id}')" title="Imprimir Etiqueta dos Correios">
              🏷️
            </button>
            <button class="btn-action btn-action-delete" onclick="excluirPedidoHandler('${p.id}', '${numPedido}')" title="Excluir Pedido Definitivamente">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function getEnvioBlock(p) {
  const status = p.status_envio || 'aguardando_envio';

  if (status === 'enviado') {
    const correiosUrl = p.codigo_rastreio ? `https://rastreamento.correios.com.br/app/index.php?codigo=${encodeURIComponent(p.codigo_rastreio)}` : '#';
    return `
      <div>
        <span class="badge badge-envio-enviado">🚚 Enviado</span>
        ${p.codigo_rastreio ? `
          <div style="margin-top: .25rem;">
            <a href="${correiosUrl}" target="_blank" style="font-family: monospace; font-weight: 800; color: #0284c7; text-decoration: none; font-size: .75rem;" title="Rastrear nos Correios">
              📦 ${p.codigo_rastreio} ↗
            </a>
          </div>
        ` : ''}
        <div style="margin-top: .35rem; display: flex; flex-direction: column; gap: .25rem;">
          <button class="btn-outline-admin" onclick="abrirModalRastreioAdmin('${p.id}')" style="font-size: .68rem; padding: .2rem .4rem;">
            🔍 Acompanhar
          </button>
          <button class="btn-primary-admin" onclick="marcarComoEntregueRapido('${p.id}')" style="font-size: .68rem; padding: .2rem .4rem; background: #16a34a; border-color: #16a34a;">
            ✓ Confirmar Entrega
          </button>
        </div>
      </div>
    `;
  }

  if (status === 'em_separacao') {
    return `
      <div>
        <span class="badge badge-envio-separacao">📦 Em Preparação</span>
        <div style="margin-top: .35rem; display: flex; flex-direction: column; gap: .25rem;">
          <button class="btn-primary-admin" onclick="abrirModalDespacho('${p.id}')" style="font-size: .72rem; padding: .3rem .6rem;">
            🚚 Despachar
          </button>
          <button class="btn-outline-admin" onclick="abrirModalRastreioAdmin('${p.id}')" style="font-size: .68rem; padding: .2rem .4rem;">
            🔍 Acompanhar
          </button>
        </div>
      </div>
    `;
  }

  if (status === 'entregue') {
    return '<span class="badge badge-envio-entregue">🎉 Entregue</span>';
  }

  // aguardando_envio
  return `
    <div>
      <span class="badge badge-envio-aguardando">⏳ Aguardando Envio</span>
      <div style="margin-top: .35rem; display: flex; flex-direction: column; gap: .25rem;">
        <button class="btn-outline-admin" onclick="marcarEmPreparacao('${p.id}')" style="font-size: .72rem; padding: .25rem .5rem;">
          📦 Preparar
        </button>
        <button class="btn-primary-admin" onclick="abrirModalDespacho('${p.id}')" style="font-size: .72rem; padding: .25rem .5rem;">
          🚚 Despachar
        </button>
      </div>
    </div>
  `;
}

function formatarDataHora(isoString) {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoString;
  }
}

function getBadgePagamento(status) {
  if (status === 'aprovado' || status === 'pago') {
    return '<span class="badge badge-pago">✓ Pago</span>';
  }
  if (status === 'cancelado' || status === 'recusado') {
    return '<span class="badge badge-cancelado">✕ Cancelado</span>';
  }
  return '<span class="badge badge-pendente">⏱️ Pendente</span>';
}

function gerarLinkWhatsApp(pedido) {
  const telLimpo = (pedido.cliente_telefone || '').replace(/\D/g, '');
  const primeiroNome = (pedido.cliente_nome || '').split(' ')[0];
  const numPedido = `#TB-${pedido.numero_pedido || ''}`;
  
  let msg = `Olá ${primeiroNome}, tudo bem? Aqui é da equipe do livro "Tesouros em Vaso de Barro"!`;
  if (pedido.codigo_rastreio) {
    msg += ` Seu livro físico foi postado nos Correios! Código de rastreamento: ${pedido.codigo_rastreio}. Você pode acompanhar o envio em tempo real em: https://livroingrid.com/rastreio.html?q=${encodeURIComponent(pedido.cliente_email || pedido.cliente_telefone)}`;
  } else if (pedido.status_envio === 'em_separacao') {
    msg += ` Estamos preparando com muito carinho o seu exemplar do pedido ${numPedido} para envio em até 48h úteis para ${pedido.cidade}/${pedido.uf}.`;
  } else {
    msg += ` Estou entrando em contato sobre o seu pedido ${numPedido} do livro físico para entrega em ${pedido.cidade}/${pedido.uf}.`;
  }

  return `https://wa.me/55${telLimpo}?text=${encodeURIComponent(msg)}`;
}

/* ══════════════════════════════
   AÇÕES RÁPIDAS (1 CLIQUE)
   ══════════════════════════════ */
export async function marcarEmPreparacao(id) {
  const { data, error } = await atualizarPedido(id, {
    status_envio: 'em_separacao'
  });

  if (error) {
    alert('Erro ao atualizar para Em Preparação: ' + error.message);
    return;
  }
  await carregarDados();
}

export function abrirModalDespacho(id) {
  const p = pedidosGlobais.find(item => item.id === id);
  if (!p) return;

  document.getElementById('dispatchOrderId').value = p.id;
  document.getElementById('dispatchModalOrderNum').innerText = `#TB-${p.numero_pedido || p.id.slice(0, 4).toUpperCase()}`;
  document.getElementById('dispatchModalClientName').innerText = p.cliente_nome;
  document.getElementById('dispatchModalCity').innerText = `${p.cidade}/${p.uf}`;
  document.getElementById('dispatchTrackingCode').value = p.codigo_rastreio || '';

  document.getElementById('dispatchModalOverlay').classList.add('open');
  document.getElementById('dispatchTrackingCode').focus();
}

export function fecharModalDespacho() {
  document.getElementById('dispatchModalOverlay').classList.remove('open');
}

export async function confirmarDespachoPedido(e) {
  e.preventDefault();
  const id = document.getElementById('dispatchOrderId').value;
  const codigo = document.getElementById('dispatchTrackingCode').value.trim().toUpperCase();
  const notificarWA = document.getElementById('dispatchNotifyWhatsApp').checked;
  const btn = document.getElementById('btnConfirmarDespacho');

  if (!codigo) {
    alert('Por favor, informe o código de rastreamento dos Correios.');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Despachando...';
  }

  const { data, error } = await atualizarPedido(id, {
    status_envio: 'enviado',
    codigo_rastreio: codigo,
    data_envio: new Date().toISOString()
  });

  if (btn) {
    btn.disabled = false;
    btn.innerText = 'Confirmar Envio';
  }

  if (error) {
    alert('Erro ao despachar pedido: ' + error.message);
    return;
  }

  fecharModalDespacho();
  await carregarDados();

  // Abre WhatsApp com a mensagem de rastreio se selecionado
  if (notificarWA) {
    const p = pedidosGlobais.find(item => item.id === id);
    if (p) {
      const waLink = gerarLinkWhatsApp({ ...p, codigo_rastreio: codigo, status_envio: 'enviado' });
      window.open(waLink, '_blank');
    }
  }
}

/* ══════════════════════════════
   MODAL DE EDIÇÃO COMPLETA
   ══════════════════════════════ */
export function abrirModalEdicao(id) {
  const p = pedidosGlobais.find(item => item.id === id);
  if (!p) return;

  document.getElementById('editOrderId').value = p.id;
  document.getElementById('editModalOrderNum').innerText = `#TB-${p.numero_pedido || ''}`;

  document.getElementById('editClienteNome').value = p.cliente_nome || '';
  document.getElementById('editClienteTelefone').value = p.cliente_telefone || '';
  document.getElementById('editClienteEmail').value = p.cliente_email || '';

  document.getElementById('editCep').value = p.cep || '';
  document.getElementById('editLogradouro').value = p.logradouro || '';
  document.getElementById('editNumero').value = p.numero || '';
  document.getElementById('editComplemento').value = p.complemento || '';
  document.getElementById('editBairro').value = p.bairro || '';
  document.getElementById('editCidade').value = p.cidade || '';
  document.getElementById('editUf').value = p.uf || '';

  document.getElementById('editStatusPagamento').value = p.status_pagamento || 'pendente';
  document.getElementById('editStatusEnvio').value = p.status_envio || 'aguardando_envio';
  document.getElementById('editCodigoRastreio').value = p.codigo_rastreio || '';
  document.getElementById('editObservacoes').value = p.observacoes || '';

  // Preenche seção de presente se o pedido for presente
  const secPresente = document.getElementById('editSectionPresente');
  if (p.is_presente && secPresente) {
    secPresente.style.display = 'block';
    document.getElementById('editPresenteDestinatario').value = p.presente_destinatario || '';
    document.getElementById('editPresenteMensagem').value = p.presente_mensagem || '(Sem dedicatória informada)';

    const endBox = document.getElementById('editPresenteEnderecoBox');
    const endTxt = document.getElementById('editPresenteEnderecoText');
    if (p.presente_endereco_diferente && p.presente_logradouro && endBox && endTxt) {
      endBox.style.display = 'block';
      const cCompl = p.presente_complemento ? ` (${p.presente_complemento})` : '';
      endTxt.innerText = `${p.presente_logradouro}, nº ${p.presente_numero}${cCompl} — ${p.presente_bairro}, ${p.presente_cidade}/${p.presente_uf} · CEP: ${p.presente_cep}`;
    } else if (endBox) {
      endBox.style.display = 'none';
    }
  } else if (secPresente) {
    secPresente.style.display = 'none';
  }

  document.getElementById('editModalOverlay').classList.add('open');
}

export function fecharModalEdicao() {
  document.getElementById('editModalOverlay').classList.remove('open');
}

export async function salvarEdicaoPedido(e) {
  e.preventDefault();
  const id = document.getElementById('editOrderId').value;
  const btn = document.getElementById('btnSalvarEdicao');
  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Salvando no Supabase...';
  }

  const updates = {
    cliente_nome: document.getElementById('editClienteNome').value.trim(),
    cliente_telefone: document.getElementById('editClienteTelefone').value.trim(),
    cliente_email: document.getElementById('editClienteEmail').value.trim(),
    cep: document.getElementById('editCep').value.trim(),
    logradouro: document.getElementById('editLogradouro').value.trim(),
    numero: document.getElementById('editNumero').value.trim(),
    complemento: document.getElementById('editComplemento').value.trim(),
    bairro: document.getElementById('editBairro').value.trim(),
    cidade: document.getElementById('editCidade').value.trim(),
    uf: document.getElementById('editUf').value.trim().toUpperCase(),
    status_pagamento: document.getElementById('editStatusPagamento').value,
    status_envio: document.getElementById('editStatusEnvio').value,
    codigo_rastreio: document.getElementById('editCodigoRastreio').value.trim(),
    observacoes: document.getElementById('editObservacoes').value.trim()
  };

  const { data, error } = await atualizarPedido(id, updates);
  if (btn) {
    btn.disabled = false;
    btn.innerText = 'Salvar Alterações';
  }

  if (error) {
    alert('Erro ao salvar no Supabase: ' + (error.message || JSON.stringify(error)));
    return;
  }

  fecharModalEdicao();
  await carregarDados();
}

/* ══════════════════════════════
   EXCLUSÃO DE PEDIDOS (ADMIN)
   ══════════════════════════════ */
export async function excluirPedidoHandler(id, numPedido) {
  const p = pedidosGlobais.find(item => item.id === id);
  const nome = p ? p.cliente_nome : 'este pedido';
  const confirmMsg = `Deseja realmente EXCLUIR o pedido ${numPedido || ''} (${nome})?\n\nEssa ação é definitiva e removerá o pedido do sistema.`;
  if (!confirm(confirmMsg)) return;

  const { error } = await excluirPedido(id);
  if (error) {
    alert('Erro ao excluir pedido: ' + (error.message || JSON.stringify(error)));
    return;
  }

  exibirNotificacaoToast(`🗑️ Pedido ${numPedido || ''} excluído com sucesso!`);
  await carregarDados();
}

export async function excluirPedidoDoModal() {
  const id = document.getElementById('editOrderId')?.value;
  if (!id) return;
  const p = pedidosGlobais.find(item => item.id === id);
  const numPedido = p ? `#TB-${p.numero_pedido || p.id.slice(0, 4).toUpperCase()}` : '';
  fecharModalEdicao();
  await excluirPedidoHandler(id, numPedido);
}

/* ══════════════════════════════
   MODAL DE IMPRESSÃO DA ETIQUETA CORREIOS
   ══════════════════════════════ */
export function abrirModalEtiqueta(id) {
  const p = pedidosGlobais.find(item => item.id === id);
  if (!p) return;

  currentLabelOrderId = id;
  const numPedido = `#TB-${p.numero_pedido || p.id.slice(0, 4).toUpperCase()}`;
  document.getElementById('labelModalOrderCode').innerText = numPedido;
  document.getElementById('labelModalServiceTag').innerText = (p.opcao_frete || 'REGISTRO MÓDICO').toUpperCase();

  // Tratamento inteligente de endereço para presente
  if (p.is_presente && p.presente_endereco_diferente && p.presente_logradouro) {
    document.getElementById('labelDestNome').innerText = (p.presente_destinatario || p.cliente_nome).toUpperCase();
    const pCompl = p.presente_complemento ? ` (${p.presente_complemento})` : '';
    document.getElementById('labelDestEndereco').innerText = `${p.presente_logradouro}, nº ${p.presente_numero}${pCompl}`;
    document.getElementById('labelDestBairro').innerText = `Bairro: ${p.presente_bairro}`;
    document.getElementById('labelDestCidadeUf').innerText = `${p.presente_cidade} — ${p.presente_uf}`;
    document.getElementById('labelDestCep').innerText = p.presente_cep;
  } else if (p.is_presente && p.presente_destinatario) {
    document.getElementById('labelDestNome').innerText = `${p.presente_destinatario.toUpperCase()} (A/C ${p.cliente_nome.toUpperCase()})`;
    const compl = p.complemento ? ` (${p.complemento})` : '';
    document.getElementById('labelDestEndereco').innerText = `${p.logradouro}, nº ${p.numero}${compl}`;
    document.getElementById('labelDestBairro').innerText = `Bairro: ${p.bairro}`;
    document.getElementById('labelDestCidadeUf').innerText = `${p.cidade} — ${p.uf}`;
    document.getElementById('labelDestCep').innerText = p.cep;
  } else {
    document.getElementById('labelDestNome').innerText = p.cliente_nome.toUpperCase();
    const compl = p.complemento ? ` (${p.complemento})` : '';
    document.getElementById('labelDestEndereco').innerText = `${p.logradouro}, nº ${p.numero}${compl}`;
    document.getElementById('labelDestBairro').innerText = `Bairro: ${p.bairro}`;
    document.getElementById('labelDestCidadeUf').innerText = `${p.cidade} — ${p.uf}`;
    document.getElementById('labelDestCep').innerText = p.cep;
  }

  document.getElementById('labelDestTelefone').innerText = p.cliente_telefone;
  document.getElementById('labelDeclQtd').innerText = `${p.quantidade || 1} exemplar(es)`;

  // Exibe banner de presente com recado se for presente
  const giftBanner = document.getElementById('labelModalGiftBanner');
  const giftDest = document.getElementById('labelGiftDestName');
  if (p.is_presente && giftBanner) {
    giftBanner.style.display = 'flex';
    if (giftDest) giftDest.innerText = p.presente_destinatario || p.cliente_nome;
  } else if (giftBanner) {
    giftBanner.style.display = 'none';
  }

  document.getElementById('labelModalOverlay').classList.add('open');
}

export function fecharModalEtiqueta() {
  document.getElementById('labelModalOverlay').classList.remove('open');
  document.body.classList.remove('printing-label');
}

export function imprimirEtiquetaCorreios() {
  document.body.classList.remove('printing-gift');
  document.body.classList.add('printing-label');
  window.print();
}

export function abrirCartaoPresenteDoModalEtiqueta() {
  if (currentLabelOrderId) {
    fecharModalEtiqueta();
    abrirCartaoPresenteModal(currentLabelOrderId);
  }
}

/* ══════════════════════════════
   SUPABASE REALTIME NO ADMIN
   ══════════════════════════════ */
function iniciarRealtimeAdmin() {
  if (realtimeChannel) return;

  realtimeChannel = supabase
    .channel('admin-pedidos-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pedidos' },
      (payload) => {
        console.log('⚡ Atualização em tempo real recebida do Supabase:', payload);

        // Notificação especial quando um pedido for entregue
        if (payload.eventType === 'UPDATE' && payload.new && payload.new.status_envio === 'entregue' && (!payload.old || payload.old.status_envio !== 'entregue')) {
          const num = payload.new.numero_pedido ? `#TB-${payload.new.numero_pedido}` : '';
          exibirNotificacaoToast(`🎉 Pedido ${num} (${payload.new.cliente_nome}) foi marcado como ENTREGUE!`);
        } else if (payload.eventType === 'INSERT') {
          const num = payload.new.numero_pedido ? `#TB-${payload.new.numero_pedido}` : '';
          exibirNotificacaoToast(`🆕 Novo pedido recebido: ${num} (${payload.new.cliente_nome})!`);
        }

        carregarDados();
      }
    )
    .subscribe((status) => {
      console.log('Supabase Realtime status:', status);
      const dbBadge = document.getElementById('dbStatusBadge');
      if (status === 'SUBSCRIBED' && dbBadge) {
        dbBadge.className = 'db-status-badge online';
        dbBadge.innerHTML = '<span class="dot"></span> Supabase Conectado em Tempo Real';
      }
    });
}

export function exibirNotificacaoToast(msg) {
  const container = document.getElementById('adminToastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'admin-toast';
  toast.innerHTML = `<span>${msg}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 450);
  }, 5000);
}

// Expõe funções no window para handlers inline
window.handleLogin = handleLogin;
window.logoutAdmin = logoutAdmin;
window.carregarDados = carregarDados;
window.filtrarPedidos = filtrarPedidos;
window.marcarEmPreparacao = marcarEmPreparacao;
window.abrirModalDespacho = abrirModalDespacho;
window.fecharModalDespacho = fecharModalDespacho;
window.confirmarDespachoPedido = confirmarDespachoPedido;
window.abrirModalEdicao = abrirModalEdicao;
window.fecharModalEdicao = fecharModalEdicao;
window.salvarEdicaoPedido = salvarEdicaoPedido;
window.abrirModalEtiqueta = abrirModalEtiqueta;
window.fecharModalEtiqueta = fecharModalEtiqueta;
window.imprimirEtiquetaCorreios = imprimirEtiquetaCorreios;
window.abrirCartaoPresenteDoModalEtiqueta = abrirCartaoPresenteDoModalEtiqueta;
window.excluirPedidoHandler = excluirPedidoHandler;
window.excluirPedidoDoModal = excluirPedidoDoModal;

/* ═════════════════════════════════════════════
   GESTÃO DE ABAS DO PAINEL
════════════════════════════════════════════════ */
export function trocarAbaPainel(aba) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-tab-pane').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });

  if (aba === 'pedidos') {
    document.getElementById('tabNavPedidos')?.classList.add('active');
    const sec = document.getElementById('sectionPedidos');
    if (sec) { sec.classList.add('active'); sec.style.display = 'block'; }
  } else if (aba === 'cupons') {
    document.getElementById('tabNavCupons')?.classList.add('active');
    const sec = document.getElementById('sectionCupons');
    if (sec) { sec.classList.add('active'); sec.style.display = 'block'; }
    carregarCuponsAdmin();
  } else if (aba === 'precos') {
    document.getElementById('tabNavPrecos')?.classList.add('active');
    const sec = document.getElementById('sectionPrecos');
    if (sec) { sec.classList.add('active'); sec.style.display = 'block'; }
    carregarPrecosAdmin();
  }
}

/* ═════════════════════════════════════════════
   GESTÃO DE CUPONS DE DESCONTO
════════════════════════════════════════════════ */
export async function carregarCuponsAdmin() {
  const tbody = document.getElementById('cuponsTableBody');
  const countDisplay = document.getElementById('cuponsCountDisplay');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Consultando cupons no Supabase...</td></tr>';

  try {
    const { data: cupons, error } = await listarCupons();

    if (error || !cupons || cupons.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum cupom cadastrado até o momento. Clique em "+ Criar Novo Cupom" acima.</td></tr>';
      if (countDisplay) countDisplay.innerText = '0 cupons cadastrados';
      return;
    }

    if (countDisplay) countDisplay.innerText = `${cupons.length} cupom(ns) cadastrado(s)`;

    tbody.innerHTML = cupons.map(c => {
      const tipoLabel = c.tipo === 'porcentagem' 
        ? 'Porcentagem (%)' 
        : (c.tipo === 'frete_gratis' ? 'Frete Grátis (Normal/PAC)' : 'Valor Fixo (R$)');

      const descontoFormatado = c.tipo === 'porcentagem'
        ? `<strong>${c.valor}% OFF</strong>`
        : (c.tipo === 'frete_gratis' ? '<strong style="color: #16a34a;">Grátis (Módico/PAC)</strong>' : `<strong>R$ ${parseFloat(c.valor).toFixed(2).replace('.', ',')}</strong>`);

      const usosStr = c.usos_maximos 
        ? `${c.usos_atuais} / ${c.usos_maximos}`
        : `${c.usos_atuais} (Ilimitado)`;

      const validadeStr = c.validade 
        ? new Date(c.validade).toLocaleDateString('pt-BR') 
        : 'Sem expiração';

      const statusBadge = c.ativo 
        ? '<span class="status-badge aprovado">Ativo</span>'
        : '<span class="status-badge recusado">Pausado</span>';

      const btnToggle = c.ativo
        ? `<button class="btn-toggle-coupon pause" onclick="alternarStatusCupomHandler('${c.id}', false)">Pausar</button>`
        : `<button class="btn-toggle-coupon activate" onclick="alternarStatusCupomHandler('${c.id}', true)">Ativar</button>`;

      return `
        <tr>
          <td><span class="badge-cupom">${c.codigo}</span></td>
          <td>${tipoLabel}</td>
          <td>${descontoFormatado}</td>
          <td>${usosStr}</td>
          <td>${validadeStr}</td>
          <td>${statusBadge}</td>
          <td style="text-align: center; white-space: nowrap;">
            ${btnToggle}
            <button class="btn-delete-coupon" onclick="excluirCupomHandler('${c.id}', '${c.codigo}')">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Erro ao listar cupons no admin:', err);
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Erro ao carregar lista de cupons.</td></tr>';
  }
}

export function abrirModalNovoCupom() {
  const overlay = document.getElementById('novoCupomModalOverlay');
  if (overlay) {
    document.getElementById('formNovoCupom')?.reset();
    alternarCampoValorCupom();
    overlay.classList.add('open');
    overlay.style.display = 'flex';
    document.getElementById('cupomCodigoInput')?.focus();
  }
}

export function fecharModalNovoCupom() {
  const overlay = document.getElementById('novoCupomModalOverlay');
  if (overlay) {
    overlay.classList.remove('open');
    overlay.style.display = 'none';
  }
}

export function alternarCampoValorCupom() {
  const tipo = document.getElementById('cupomTipoSelect')?.value;
  const valorGroup = document.getElementById('cupomValorGroup');
  const valorInput = document.getElementById('cupomValorInput');
  const valorLabel = document.getElementById('cupomValorLabel');

  if (!valorInput) return;

  if (tipo === 'frete_gratis') {
    if (valorGroup) valorGroup.style.display = 'none';
    valorInput.required = false;
    valorInput.removeAttribute('min');
    valorInput.removeAttribute('max');
    valorInput.value = '0';
  } else if (tipo === 'fixo') {
    if (valorGroup) valorGroup.style.display = 'block';
    valorInput.required = true;
    valorInput.setAttribute('min', '0.01');
    valorInput.removeAttribute('max');
    valorInput.placeholder = 'Ex: 20.00';
    if (valorInput.value === '0') valorInput.value = '';
    if (valorLabel) valorLabel.innerText = 'Desconto (R$) *';
  } else {
    // porcentagem
    if (valorGroup) valorGroup.style.display = 'block';
    valorInput.required = true;
    valorInput.setAttribute('min', '1');
    valorInput.setAttribute('max', '100');
    valorInput.placeholder = 'Ex: 15';
    if (valorInput.value === '0') valorInput.value = '';
    if (valorLabel) valorLabel.innerText = 'Desconto (%) *';
  }
}

export async function salvarNovoCupom(e) {
  if (e && e.preventDefault) e.preventDefault();
  const codigoInput = document.getElementById('cupomCodigoInput');
  const codigo = codigoInput ? codigoInput.value.trim().toUpperCase() : '';
  const tipo = document.getElementById('cupomTipoSelect')?.value || 'porcentagem';
  const valorInput = document.getElementById('cupomValorInput');
  const usosMax = document.getElementById('cupomUsosInput')?.value;
  const validade = document.getElementById('cupomValidadeInput')?.value;
  const btn = document.getElementById('btnSalvarCupom');

  if (!codigo) {
    alert('Digite um código para o cupom.');
    codigoInput?.focus();
    return;
  }

  let valor = 0;
  if (tipo === 'porcentagem') {
    valor = parseFloat(valorInput?.value);
    if (isNaN(valor) || valor <= 0 || valor > 100) {
      alert('Digite uma porcentagem de desconto válida entre 1% e 100%.');
      valorInput?.focus();
      return;
    }
  } else if (tipo === 'fixo') {
    valor = parseFloat(valorInput?.value);
    if (isNaN(valor) || valor <= 0) {
      alert('Digite um valor de desconto fixo válido (maior que zero).');
      valorInput?.focus();
      return;
    }
  } else if (tipo === 'frete_gratis') {
    valor = 0;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Cadastrando...';
  }

  try {
    const { data, error } = await criarCupom({
      codigo,
      tipo,
      valor,
      usos_maximos: usosMax ? parseInt(usosMax, 10) : null,
      validade: validade || null
    });

    if (error) {
      alert(`Erro ao cadastrar cupom: ${error.message || 'Código já existe.'}`);
    } else {
      fecharModalNovoCupom();
      carregarCuponsAdmin();
    }
  } catch (err) {
    console.error('Erro ao salvar cupom:', err);
    alert('Erro inesperado ao salvar cupom.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = 'Salvar e Ativar Cupom';
    }
  }
}

export async function alternarStatusCupomHandler(id, novoStatus) {
  try {
    const { error } = await alternarStatusCupom(id, novoStatus);
    if (error) alert('Não foi possível alterar o status do cupom.');
    carregarCuponsAdmin();
  } catch (err) {
    console.error('Erro ao alterar status:', err);
  }
}

export async function excluirCupomHandler(id, codigo) {
  if (!confirm(`Tem certeza de que deseja excluir permanentemente o cupom ${codigo}?`)) {
    return;
  }
  try {
    const { error } = await excluirCupom(id);
    if (error) alert('Não foi possível excluir o cupom.');
    carregarCuponsAdmin();
  } catch (err) {
    console.error('Erro ao excluir cupom:', err);
  }
}

/* ═════════════════════════════════════════════
   GESTÃO DE PREÇO DO LIVRO E PROMOÇÕES
════════════════════════════════════════════════ */
export async function carregarPrecosAdmin() {
  const inputAtual = document.getElementById('inputPrecoAtual');
  const inputOriginal = document.getElementById('inputPrecoOriginal');
  const feedback = document.getElementById('precoFeedback');
  if (feedback) feedback.style.display = 'none';

  try {
    const configs = await obterConfiguracoes();
    if (inputAtual) inputAtual.value = configs.preco_livro.toFixed(2);
    if (inputOriginal) inputOriginal.value = configs.preco_original.toFixed(2);
  } catch (err) {
    console.error('Erro ao carregar preços no admin:', err);
  }
}

export async function salvarPrecoLivro(e) {
  e.preventDefault();
  const inputAtual = document.getElementById('inputPrecoAtual');
  const inputOriginal = document.getElementById('inputPrecoOriginal');
  const feedback = document.getElementById('precoFeedback');
  const btn = document.getElementById('btnSalvarPreco');

  const precoAtual = parseFloat(inputAtual.value);
  const precoOriginal = parseFloat(inputOriginal.value);

  if (isNaN(precoAtual) || precoAtual <= 0) {
    alert('Digite um preço atual válido.');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Salvando novo preço...';
  }

  try {
    await atualizarConfiguracao('preco_livro', precoAtual.toFixed(2));
    if (!isNaN(precoOriginal)) {
      await atualizarConfiguracao('preco_original', precoOriginal.toFixed(2));
    }

    if (feedback) {
      feedback.className = 'admin-feedback-msg success';
      feedback.style.display = 'block';
      feedback.innerHTML = `✅ <strong>Preço atualizado com sucesso!</strong> O exemplar agora está configurado para R$ ${precoAtual.toFixed(2).replace('.', ',')} no site e checkout.`;
    }
  } catch (err) {
    console.error('Erro ao salvar preços:', err);
    if (feedback) {
      feedback.className = 'admin-feedback-msg error';
      feedback.style.display = 'block';
      feedback.innerText = 'Erro ao salvar novo preço. Tente novamente.';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '💾 Salvar Alterações de Preço';
    }
  }
}

// Expõe novas funções para handlers inline no HTML
window.trocarAbaPainel = trocarAbaPainel;
window.carregarCuponsAdmin = carregarCuponsAdmin;
window.abrirModalNovoCupom = abrirModalNovoCupom;
window.fecharModalNovoCupom = fecharModalNovoCupom;
window.alternarCampoValorCupom = alternarCampoValorCupom;
window.salvarNovoCupom = salvarNovoCupom;
window.alternarStatusCupomHandler = alternarStatusCupomHandler;
window.excluirCupomHandler = excluirCupomHandler;
window.carregarPrecosAdmin = carregarPrecosAdmin;
window.salvarPrecoLivro = salvarPrecoLivro;

/* ══════════════════════════════
   FUNÇÕES DE IMPRESSÃO DO CARTÃO DE PRESENTE
   ══════════════════════════════ */
export function abrirCartaoPresenteModal(orderId) {
  const id = orderId || document.getElementById('editOrderId')?.value;
  const p = pedidosGlobais.find(item => item.id === id);
  if (!p) return;

  const recipient = p.presente_destinatario || p.cliente_nome || 'Amigo(a) Especial';
  const sender = p.cliente_nome || 'Quem te presenteou';
  const msg = p.presente_mensagem || 'Desejo que este livro fale profundamente ao seu coração e que a maravilhosa graça de Deus se revele em sua história.';

  document.getElementById('printCardRecipient').innerText = recipient;
  document.getElementById('printCardMessage').innerText = `"${msg}"`;
  document.getElementById('printCardSender').innerText = sender;

  const modal = document.getElementById('giftCardModalOverlay');
  if (modal) {
    modal.style.display = 'flex';
    modal.classList.add('open');
  }
}

export function fecharCartaoPresenteModal() {
  const modal = document.getElementById('giftCardModalOverlay');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('open');
  }
  document.body.classList.remove('printing-gift');
}

export function imprimirCartaoPresente() {
  document.body.classList.remove('printing-label');
  document.body.classList.add('printing-gift');
  window.print();
}

window.addEventListener('afterprint', () => {
  document.body.classList.remove('printing-label', 'printing-gift');
});

window.abrirCartaoPresenteModal = abrirCartaoPresenteModal;
window.fecharCartaoPresenteModal = fecharCartaoPresenteModal;
window.imprimirCartaoPresente = imprimirCartaoPresente;
window.imprimirEtiquetaCorreios = imprimirEtiquetaCorreios;
window.abrirCartaoPresenteDoModalEtiqueta = abrirCartaoPresenteDoModalEtiqueta;
window.excluirPedidoHandler = excluirPedidoHandler;
window.excluirPedidoDoModal = excluirPedidoDoModal;

/* ══════════════════════════════
   ACOMPANHAMENTO DO ENVIO EM TEMPO REAL
   ══════════════════════════════ */
export function abrirModalRastreioAdmin(id) {
  const p = pedidosGlobais.find(item => item.id === id);
  if (!p) return;

  document.getElementById('trackModalOrderId').value = p.id;
  document.getElementById('trackModalOrderNum').innerText = `#TB-${p.numero_pedido || ''}`;
  document.getElementById('trackModalClientName').innerText = p.cliente_nome;

  const compl = p.complemento ? ` (${p.complemento})` : '';
  document.getElementById('trackModalAddress').innerText = `${p.logradouro}, nº ${p.numero}${compl} — ${p.bairro}, ${p.cidade}/${p.uf} · CEP ${p.cep}`;

  const codeDisplay = document.getElementById('trackModalCodeText');
  const extLink = document.getElementById('trackModalCorreiosExternalLink');

  if (p.codigo_rastreio) {
    codeDisplay.innerText = p.codigo_rastreio;
    extLink.href = `https://rastreamento.correios.com.br/app/index.php?codigo=${encodeURIComponent(p.codigo_rastreio)}`;
    extLink.style.display = 'inline-flex';
  } else {
    codeDisplay.innerText = 'Código ainda não informado';
    extLink.style.display = 'none';
  }

  // Atualiza timeline
  const status = p.status_envio || 'aguardando_envio';
  const badge = document.getElementById('trackModalStatusBadge');
  
  if (badge) {
    if (status === 'entregue') {
      badge.className = 'badge badge-envio-entregue';
      badge.innerText = '🎉 Entregue';
    } else if (status === 'enviado') {
      badge.className = 'badge badge-envio-enviado';
      badge.innerText = '🚚 Em Trânsito';
    } else if (status === 'em_separacao') {
      badge.className = 'badge badge-envio-separacao';
      badge.innerText = '📦 Em Preparação';
    } else {
      badge.className = 'badge badge-envio-aguardando';
      badge.innerText = '⏳ Aguardando Envio';
    }
  }

  const step1 = document.getElementById('trackStep1');
  const step2 = document.getElementById('trackStep2');
  const step3 = document.getElementById('trackStep3');
  const step4 = document.getElementById('trackStep4');
  const conn1 = document.getElementById('trackConn1');
  const conn2 = document.getElementById('trackConn2');
  const conn3 = document.getElementById('trackConn3');

  [step1, step2, step3, step4].forEach(s => s?.classList.remove('active', 'completed'));
  [conn1, conn2, conn3].forEach(c => c?.classList.remove('active'));

  step1?.classList.add('completed');

  if (status === 'em_separacao') {
    conn1?.classList.add('active');
    step2?.classList.add('active');
  } else if (status === 'enviado') {
    conn1?.classList.add('active');
    step2?.classList.add('completed');
    conn2?.classList.add('active');
    step3?.classList.add('active');
  } else if (status === 'entregue') {
    conn1?.classList.add('active');
    step2?.classList.add('completed');
    conn2?.classList.add('active');
    step3?.classList.add('completed');
    conn3?.classList.add('active');
    step4?.classList.add('completed');
  }

  const modal = document.getElementById('shippingTrackingModalOverlay');
  if (modal) {
    modal.classList.add('open');
    modal.style.display = 'flex';
  }
}

export function fecharModalRastreioAdmin() {
  const modal = document.getElementById('shippingTrackingModalOverlay');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = 'none';
  }
}

export async function alterarStatusEnvioRapido(novoStatus) {
  const id = document.getElementById('trackModalOrderId')?.value;
  if (!id) return;

  const { error } = await atualizarPedido(id, {
    status_envio: novoStatus,
    updated_at: new Date().toISOString()
  });

  if (error) {
    alert('Erro ao atualizar status: ' + error.message);
    return;
  }

  fecharModalRastreioAdmin();
  if (novoStatus === 'entregue') {
    exibirNotificacaoToast('🎉 Status atualizado: Pedido marcado como ENTREGUE!');
  } else {
    exibirNotificacaoToast(`Status atualizado para: ${novoStatus}`);
  }
  await carregarDados();
}

export async function marcarComoEntregueRapido(id) {
  if (!confirm('Deseja confirmar que este pedido foi ENTREGUE ao cliente?')) return;

  const { error } = await atualizarPedido(id, {
    status_envio: 'entregue',
    updated_at: new Date().toISOString()
  });

  if (error) {
    alert('Erro ao atualizar status: ' + error.message);
    return;
  }

  exibirNotificacaoToast('🎉 Entrega confirmada com sucesso!');
  await carregarDados();
}

window.abrirModalRastreioAdmin = abrirModalRastreioAdmin;
window.fecharModalRastreioAdmin = fecharModalRastreioAdmin;
window.alterarStatusEnvioRapido = alterarStatusEnvioRapido;
window.marcarComoEntregueRapido = marcarComoEntregueRapido;
window.exibirNotificacaoToast = exibirNotificacaoToast;

