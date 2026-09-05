import { supabase, salvarPedido, atualizarPedido, validarCupom, obterConfiguracoes, atualizarConfiguracao } from './supabase.js';
import { gerarPixMercadoPago, inicializarCardPaymentBrick } from './mercadopago.js';

// Estado global do checkout
const checkoutState = {
  currentStep: 1,
  orderId: null,
  orderNumber: null,
  cliente: {
    nome: '',
    email: '',
    cpf: '',
    telefone: '',
    cep: '',
    uf: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: ''
  },
  quantidade: 1,
  valorLivro: 59.90,
  opcaoFrete: 'Registro Módico (Livros)',
  valorFrete: 12.90,
  valorTotal: 72.80,
  cupomCodigo: null,
  tipoCupom: null,
  valorCupom: 0,
  valorDesconto: 0,
  metodoPagamento: 'pix',
  statusPagamento: 'pendente',
  isPresente: false,
  presenteDestinatario: '',
  presenteMensagem: '',
  presenteEnderecoDiferente: false,
  presenteEndereco: null,
  estoque: {
    livros: 100,
    limitar: true
  }
};

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initSmoothScroll();
  initScrollReveal();
  initShippingCalc();
  initCepMask();
  initCheckoutInputs();
  carregarPrecosDinamicos();
});

/* ══════════════════════════════
   NAV: scroll shadow + hamburger
   ══════════════════════════════ */
function initNav() {
  const nav = document.getElementById('nav');
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');

  window.addEventListener('scroll', () => {
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 30);
  }, { passive: true });

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      mobileMenu.classList.toggle('open');
    });
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => mobileMenu.classList.remove('open'));
    });
  }
}

/* ══════════════════════════════
   Smooth anchor scrolling
   ══════════════════════════════ */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (id && id !== '#') {
        const el = document.querySelector(id);
        if (el) {
          e.preventDefault();
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  });
}

/* ══════════════════════════════
   Scroll Reveal (IntersectionObserver)
   ══════════════════════════════ */
function initScrollReveal() {
  const items = document.querySelectorAll(
    '.section-title, .tag, .card, .gallery-item, .offer-box, .author-grid, .book-grid, .scripture, .testimonial, .bonus-box, .faq-item'
  );
  if (!items.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });

  items.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(18px)';
    el.style.transition = 'opacity .55s ease, transform .55s ease';
    observer.observe(el);
  });
}

/* ══════════════════════════════
   CORREIOS FREIGHT CALCULATOR
   Origin: Botucatu - SP (CEP 18600-000)
   Weight: ~400g (Livro Físico)
   ══════════════════════════════ */
export function calculateCorreiosRates(uf, cepNum, city) {
  const modico = { name: 'Registro Módico (Livros)', price: 12.90, days: '5-9 dias úteis' };
  let pac = { name: 'PAC', price: 21.90, days: '5-7 dias úteis' };
  let sedex = { name: 'SEDEX', price: 34.90, days: '2-3 dias úteis' };

  if (cepNum >= 18600000 && cepNum <= 18619999) {
    pac = { name: 'PAC (Local)', price: 12.90, days: '1-2 dias úteis' };
    sedex = { name: 'SEDEX (Local)', price: 16.90, days: '1 dia útil' };
    return { modico, pac, sedex };
  }

  switch (uf) {
    case 'SP':
      if (cepNum >= 1000000 && cepNum <= 9999999) {
        pac = { name: 'PAC', price: 16.90, days: '3-4 dias úteis' };
        sedex = { name: 'SEDEX', price: 22.90, days: '1-2 dias úteis' };
      } else {
        pac = { name: 'PAC', price: 15.90, days: '2-4 dias úteis' };
        sedex = { name: 'SEDEX', price: 20.90, days: '1-2 dias úteis' };
      }
      break;
    case 'RJ':
    case 'MG':
    case 'PR':
      pac = { name: 'PAC', price: 21.80, days: '4-6 dias úteis' };
      sedex = { name: 'SEDEX', price: 33.50, days: '2-3 dias úteis' };
      break;
    case 'SC':
    case 'RS':
    case 'ES':
    case 'DF':
    case 'GO':
    case 'MS':
      pac = { name: 'PAC', price: 25.90, days: '5-7 dias úteis' };
      sedex = { name: 'SEDEX', price: 38.90, days: '2-4 dias úteis' };
      break;
    case 'BA':
    case 'MT':
    case 'TO':
      pac = { name: 'PAC', price: 29.90, days: '6-9 dias úteis' };
      sedex = { name: 'SEDEX', price: 44.90, days: '3-4 dias úteis' };
      break;
    case 'AL':
    case 'CE':
    case 'MA':
    case 'PB':
    case 'PE':
    case 'PI':
    case 'RN':
    case 'SE':
      pac = { name: 'PAC', price: 34.90, days: '7-10 dias úteis' };
      sedex = { name: 'SEDEX', price: 52.90, days: '3-5 dias úteis' };
      break;
    case 'AC':
    case 'AM':
    case 'AP':
    case 'PA':
    case 'RO':
    case 'RR':
      pac = { name: 'PAC', price: 42.90, days: '9-14 dias úteis' };
      sedex = { name: 'SEDEX', price: 66.90, days: '4-6 dias úteis' };
      break;
    default:
      pac = { name: 'PAC', price: 24.90, days: '5-8 dias úteis' };
      sedex = { name: 'SEDEX', price: 39.90, days: '2-4 dias úteis' };
      break;
  }

  return { modico, pac, sedex };
}

function initCepMask() {
  const input = document.getElementById('cepInput');
  if (!input) return;
  input.addEventListener('input', () => {
    let v = input.value.replace(/\D/g, '').slice(0, 8);
    if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
    input.value = v;
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); calcFrete(); }
  });
}

function initShippingCalc() {
  const btn = document.getElementById('calcFreteBtn');
  if (btn) btn.addEventListener('click', calcFrete);
}

async function calcFrete() {
  const input = document.getElementById('cepInput');
  const results = document.getElementById('shippingResults');
  if (!input || !results) return;

  const rawCep = input.value.replace(/\D/g, '');
  if (rawCep.length !== 8) {
    results.innerHTML = '<div class="shipping-error">⚠️ Digite um CEP válido com 8 dígitos (ex: 01310-100).</div>';
    return;
  }

  const cepNum = parseInt(rawCep, 10);
  results.innerHTML = '<div style="font-size:.82rem;color:#8a8279;padding:.5rem 0;">🔎 Consultando CEP nos Correios...</div>';

  let city = '';
  let uf = '';
  let neighborhood = '';

  try {
    const resp = await fetch(`https://viacep.com.br/ws/${rawCep}/json/`);
    const data = await resp.json();
    if (data && !data.erro) {
      city = data.localidade || '';
      uf = data.uf || '';
      neighborhood = data.bairro ? `, ${data.bairro}` : '';
    }
  } catch (err) {
    console.warn('Erro ao consultar ViaCEP:', err);
  }

  if (!uf) {
    if (cepNum >= 1000000 && cepNum <= 19999999) uf = 'SP';
    else if (cepNum >= 20000000 && cepNum <= 28999999) uf = 'RJ';
    else uf = 'SP';
  }

  const rates = calculateCorreiosRates(uf, cepNum, city);
  const locationText = city ? `📍 ${city} / ${uf}${neighborhood}` : (uf ? `📍 Região ${uf}` : '📍 Brasil');

  results.innerHTML = `
    <div class="shipping-city">${locationText} · Envio saindo de Botucatu/SP</div>
    <div class="shipping-option highlight">
      <div>
        <span class="shipping-option-name">📚 ${rates.modico.name}</span>
        <span class="shipping-option-days">${rates.modico.days}</span>
      </div>
      <span class="shipping-option-price">R$ ${rates.modico.price.toFixed(2).replace('.', ',')}</span>
    </div>
    <div class="shipping-option">
      <div>
        <span class="shipping-option-name">📦 ${rates.pac.name}</span>
        <span class="shipping-option-days">${rates.pac.days}</span>
      </div>
      <span class="shipping-option-price">R$ ${rates.pac.price.toFixed(2).replace('.', ',')}</span>
    </div>
    <div class="shipping-option">
      <div>
        <span class="shipping-option-name">⚡ ${rates.sedex.name}</span>
        <span class="shipping-option-days">${rates.sedex.days}</span>
      </div>
      <span class="shipping-option-price">R$ ${rates.sedex.price.toFixed(2).replace('.', ',')}</span>
    </div>
  `;
}

/**
 * Validação do algoritmo oficial de CPF (dígitos verificadores)
 */
export function validarCPF(cpf) {
  const clean = String(cpf || '').replace(/\D/g, '');
  if (clean.length !== 11 || /^(\d)\1{10}$/.test(clean)) return false;
  let soma = 0, resto;
  for (let i = 1; i <= 9; i++) soma += parseInt(clean.substring(i - 1, i), 10) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(clean.substring(9, 10), 10)) return false;
  soma = 0;
  for (let i = 1; i <= 10; i++) soma += parseInt(clean.substring(i - 1, i), 10) * (12 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(clean.substring(10, 11), 10)) return false;
  return true;
}

/* ══════════════════════════════
   CHECKOUT MULTI-STEP LOGIC
   ══════════════════════════════ */
function initCheckoutInputs() {
  const cpfInput = document.getElementById('clientCpf');
  if (cpfInput) {
    cpfInput.addEventListener('input', () => {
      let v = cpfInput.value.replace(/\D/g, '').slice(0, 11);
      if (v.length > 9) {
        v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
      } else if (v.length > 6) {
        v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
      } else if (v.length > 3) {
        v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
      }
      cpfInput.value = v;
    });
  }

  const phoneInput = document.getElementById('clientPhone');
  if (phoneInput) {
    phoneInput.addEventListener('input', () => {
      let v = phoneInput.value.replace(/\D/g, '').slice(0, 11);
      if (v.length > 10) {
        v = `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
      } else if (v.length > 6) {
        v = `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
      } else if (v.length > 2) {
        v = `(${v.slice(0, 2)}) ${v.slice(2)}`;
      }
      phoneInput.value = v;
    });
  }

  const cepInput = document.getElementById('clientCep');
  if (cepInput) {
    cepInput.addEventListener('input', () => {
      let v = cepInput.value.replace(/\D/g, '').slice(0, 8);
      if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
      cepInput.value = v;

      if (v.replace(/\D/g, '').length === 8) {
        handleCheckoutCepSearch();
      }
    });
  }

  // Card Number mask
  const cardInput = document.getElementById('cardNumber');
  if (cardInput) {
    cardInput.addEventListener('input', () => {
      let v = cardInput.value.replace(/\D/g, '').slice(0, 16);
      v = v.replace(/(\d{4})/g, '$1 ').trim();
      cardInput.value = v;
    });
  }

  // Card Expiry mask
  const expiryInput = document.getElementById('cardExpiry');
  if (expiryInput) {
    expiryInput.addEventListener('input', () => {
      let v = expiryInput.value.replace(/\D/g, '').slice(0, 4);
      expiryInput.value = v;
    });
  }

  // Frete selection listener
  const freteContainer = document.getElementById('checkoutFreteOptions');
  if (freteContainer) {
    freteContainer.addEventListener('change', () => {
      updateCheckoutCalculations();
    });
  }

  // Máscara CEP do Presenteado
  const giftCepInput = document.getElementById('giftCep');
  if (giftCepInput) {
    giftCepInput.addEventListener('input', () => {
      let v = giftCepInput.value.replace(/\D/g, '').slice(0, 8);
      if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
      giftCepInput.value = v;

      if (v.replace(/\D/g, '').length === 8) {
        handleGiftCepSearch();
      }
    });
  }

  // Contador de caracteres da mensagem de presente
  const giftMsgInput = document.getElementById('giftMessage');
  const giftMsgCounter = document.getElementById('giftMsgCharCount');
  if (giftMsgInput && giftMsgCounter) {
    giftMsgInput.addEventListener('input', () => {
      giftMsgCounter.innerText = giftMsgInput.value.length;
    });
  }
}

export function toggleGiftSection(isChecked) {
  const container = document.getElementById('giftFieldsContainer');
  const box = document.getElementById('giftSectionBox');
  if (container) container.style.display = isChecked ? 'flex' : 'none';
  if (box) box.classList.toggle('active', isChecked);

  if (isChecked) {
    const recInput = document.getElementById('giftRecipientName');
    if (recInput) recInput.focus();
  }
}

export function toggleGiftAddressFields(isChecked) {
  const container = document.getElementById('giftAddressFields');
  if (container) container.style.display = isChecked ? 'flex' : 'none';

  if (isChecked) {
    const cepInput = document.getElementById('giftCep');
    if (cepInput) cepInput.focus();
  }
}

export async function handleGiftCepSearch() {
  const cepInput = document.getElementById('giftCep');
  const statusSpan = document.getElementById('giftCepStatus');
  if (!cepInput) return;

  const rawCep = cepInput.value.replace(/\D/g, '');
  if (rawCep.length !== 8) {
    if (statusSpan) statusSpan.innerHTML = '<span style="color:#dc2626;">Digite um CEP com 8 dígitos.</span>';
    return;
  }

  if (statusSpan) statusSpan.innerHTML = '<span style="color:#d97706;">Buscando endereço do destinatário...</span>';

  try {
    const res = await fetch(`https://viacep.com.br/ws/${rawCep}/json/`);
    const data = await res.json();

    if (data && !data.erro) {
      document.getElementById('giftLogradouro').value = data.logradouro || '';
      document.getElementById('giftBairro').value = data.bairro || '';
      document.getElementById('giftCidade').value = data.localidade || '';
      document.getElementById('giftUf').value = data.uf || '';
      if (statusSpan) statusSpan.innerHTML = `<span style="color:#16a34a;">✓ ${data.localidade}/${data.uf} localizado!</span>`;
      document.getElementById('giftNumero').focus();
    } else {
      if (statusSpan) statusSpan.innerHTML = '<span style="color:#dc2626;">CEP não encontrado. Preencha manualmente.</span>';
    }
  } catch (err) {
    console.warn('Erro na busca de CEP do presente:', err);
    if (statusSpan) statusSpan.innerHTML = 'Preencha o endereço manualmente abaixo.';
  }
}

export async function handleCheckoutCepSearch() {
  const cepInput = document.getElementById('clientCep');
  const statusSpan = document.getElementById('cepStatus');
  if (!cepInput) return;

  const rawCep = cepInput.value.replace(/\D/g, '');
  if (rawCep.length !== 8) {
    if (statusSpan) statusSpan.innerHTML = '<span style="color:#dc2626;">Digite um CEP com 8 dígitos.</span>';
    return;
  }

  if (statusSpan) statusSpan.innerHTML = '<span style="color:#d97706;">Buscando endereço...</span>';

  try {
    const res = await fetch(`https://viacep.com.br/ws/${rawCep}/json/`);
    const data = await res.json();

    if (data && !data.erro) {
      document.getElementById('clientLogradouro').value = data.logradouro || '';
      document.getElementById('clientBairro').value = data.bairro || '';
      document.getElementById('clientCidade').value = data.localidade || '';
      document.getElementById('clientUf').value = data.uf || '';
      if (statusSpan) statusSpan.innerHTML = `<span style="color:#16a34a;">✓ ${data.localidade}/${data.uf} localizado!</span>`;

      // Atualiza valores de PAC e SEDEX na lista de fretes
      const cepNum = parseInt(rawCep, 10);
      const rates = calculateCorreiosRates(data.uf, cepNum, data.localidade);
      
      const pacRadio = document.querySelector('input[name="shippingOption"][value="pac"]');
      const sedexRadio = document.querySelector('input[name="shippingOption"][value="sedex"]');
      const pacDisplay = document.getElementById('fretePacPrice');
      const sedexDisplay = document.getElementById('freteSedexPrice');

      if (pacRadio && pacDisplay) {
        pacRadio.dataset.price = rates.pac.price.toFixed(2);
        pacDisplay.innerText = `R$ ${rates.pac.price.toFixed(2).replace('.', ',')}`;
      }
      if (sedexRadio && sedexDisplay) {
        sedexRadio.dataset.price = rates.sedex.price.toFixed(2);
        sedexDisplay.innerText = `R$ ${rates.sedex.price.toFixed(2).replace('.', ',')}`;
      }

      updateCheckoutCalculations();
      document.getElementById('clientNumero').focus();
    } else {
      if (statusSpan) statusSpan.innerHTML = '<span style="color:#dc2626;">CEP não encontrado na base dos Correios. Digite manualmente.</span>';
    }
  } catch (err) {
    console.warn('Erro na busca de CEP:', err);
    if (statusSpan) statusSpan.innerHTML = 'Preencha o endereço manualmente abaixo.';
  }
}

async function carregarPrecosDinamicos() {
  try {
    const config = await obterConfiguracoes();
    if (config && config.preco_livro) {
      checkoutState.valorLivro = config.preco_livro;

      const precoFmt = `R$ ${config.preco_livro.toFixed(2).replace('.', ',')}`;
      const precoOriginalFmt = `R$ ${config.preco_original.toFixed(2).replace('.', ',')}`;

      document.querySelectorAll('.preco-livro-dinamico').forEach(el => { el.innerText = precoFmt; el.classList.add('preco-carregado'); });
      document.querySelectorAll('.preco-original-dinamico').forEach(el => { el.innerText = precoOriginalFmt; el.classList.add('preco-carregado'); });

      const [inteiro, centavos] = config.preco_livro.toFixed(2).split('.');
      document.querySelectorAll('.preco-val-dinamico').forEach(el => { el.innerText = inteiro; el.classList.add('preco-carregado'); });
      document.querySelectorAll('.preco-cents-dinamico').forEach(el => { el.innerText = `,${centavos}`; el.classList.add('preco-carregado'); });

      // Atualiza estado e badges dinâmicos de Estoque
      if (config.estoque_livros !== undefined) {
        checkoutState.estoque.livros = config.estoque_livros;
        checkoutState.estoque.limitar = config.limitar_estoque === 'true';

        const stockBadges = document.querySelectorAll('.stock-badge');
        const buyBtns = document.querySelectorAll('.btn-primary.btn-full');

        if (checkoutState.estoque.limitar && checkoutState.estoque.livros <= 0) {
          stockBadges.forEach(badge => {
            badge.innerHTML = '<span class="stock-dot" style="background:#dc2626; box-shadow:0 0 8px #dc2626;"></span> <strong style="color:#dc2626;">Estoque Esgotado</strong> — Aguardando nova remessa';
          });
          buyBtns.forEach(btn => {
            btn.innerText = '🔴 ESTOQUE ESGOTADO';
            btn.disabled = true;
            btn.style.opacity = '0.65';
            btn.style.cursor = 'not-allowed';
          });
        } else if (checkoutState.estoque.limitar && checkoutState.estoque.livros <= 10) {
          stockBadges.forEach(badge => {
            badge.innerHTML = `<span class="stock-dot" style="background:#d97706; box-shadow:0 0 8px #d97706;"></span> <strong style="color:#d97706;">ÚLTIMAS UNIDADES!</strong> Apenas ${checkoutState.estoque.livros} exemplar(es) em estoque`;
          });
          buyBtns.forEach(btn => {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
          });
        } else {
          stockBadges.forEach(badge => {
            badge.innerHTML = '<span class="stock-dot"></span> Em estoque — envio imediato';
          });
          buyBtns.forEach(btn => {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
          });
        }
      }

      // Atualiza opções do select de quantidade
      const selectQty = document.getElementById('clientQty');
      if (selectQty) {
        selectQty.options[0].text = `1 exemplar — ${precoFmt}`;
        selectQty.options[1].text = `2 exemplares — R$ ${(config.preco_livro * 2).toFixed(2).replace('.', ',')} (Presenteie alguém)`;
        selectQty.options[2].text = `3 exemplares — R$ ${(config.preco_livro * 3).toFixed(2).replace('.', ',')}`;
        selectQty.options[3].text = `5 exemplares — R$ ${(config.preco_livro * 5).toFixed(2).replace('.', ',')}`;
      }

      updateCheckoutCalculations();
    }
  } catch (err) {
    console.warn('Erro ao carregar configurações de preço:', err);
  }
}

export async function aplicarCupomCheckout() {
  const input = document.getElementById('checkoutCouponInput');
  const btn = document.getElementById('btnApplyCoupon');
  const feedback = document.getElementById('couponFeedback');
  if (!input || !feedback) return;

  const codigo = input.value.trim().toUpperCase();
  if (!codigo) {
    feedback.className = 'coupon-feedback error';
    feedback.style.display = 'block';
    feedback.innerText = 'Digite um código de cupom para aplicar.';
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Validando...';
  }

  try {
    const { data: res, error } = await validarCupom(codigo);

    if (res && res.valido) {
      checkoutState.cupomCodigo = res.codigo;
      checkoutState.tipoCupom = res.tipo;
      checkoutState.valorCupom = parseFloat(res.valor) || 0;

      // Se o cupom for frete grátis e o cliente estiver com SEDEX selecionado,
      // direciona para Registro Módico para aproveitar a gratuidade imediatamente
      if (res.tipo === 'frete_gratis') {
        const currentShipping = document.querySelector('input[name="shippingOption"]:checked');
        if (currentShipping && (currentShipping.value === 'sedex' || currentShipping.dataset.name.toUpperCase().includes('SEDEX'))) {
          const modicoRadio = document.querySelector('input[name="shippingOption"][value="modico"]');
          if (modicoRadio) modicoRadio.checked = true;
        }
      }

      updateCheckoutCalculations();

      feedback.style.display = 'block';
      if (res.tipo === 'frete_gratis') {
        feedback.className = 'coupon-feedback success';
        feedback.innerHTML = `✅ <strong>Cupom ${res.codigo} ativado!</strong> Frete Grátis aplicado (válido para Envio Normal e PAC).`;
      } else if (res.tipo === 'porcentagem') {
        feedback.className = 'coupon-feedback success';
        feedback.innerHTML = `✅ <strong>Cupom ${res.codigo} ativado!</strong> ${res.valor}% de desconto aplicado no livro.`;
      } else {
        feedback.className = 'coupon-feedback success';
        feedback.innerHTML = `✅ <strong>Cupom ${res.codigo} ativado!</strong> R$ ${parseFloat(res.valor).toFixed(2).replace('.', ',')} de desconto aplicado.`;
      }
    } else {
      feedback.className = 'coupon-feedback error';
      feedback.style.display = 'block';
      feedback.innerText = res?.mensagem || 'Cupom inválido ou expirado.';

      checkoutState.cupomCodigo = null;
      checkoutState.tipoCupom = null;
      checkoutState.valorCupom = 0;
      checkoutState.valorDesconto = 0;
      updateCheckoutCalculations();
    }
  } catch (err) {
    feedback.className = 'coupon-feedback error';
    feedback.style.display = 'block';
    feedback.innerText = 'Erro de comunicação ao verificar cupom.';
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = 'Aplicar';
    }
  }
}

export function updateCheckoutCalculations() {
  const qtySelect = document.getElementById('clientQty');
  const qty = qtySelect ? parseInt(qtySelect.value, 10) : 1;
  const bookPrice = checkoutState.valorLivro || 59.90;
  const bookTotal = qty * bookPrice;

  const selectedShipping = document.querySelector('input[name="shippingOption"]:checked');
  const shippingVal = selectedShipping ? selectedShipping.value : 'modico';
  const shippingPrice = selectedShipping ? parseFloat(selectedShipping.dataset.price) : 12.90;
  const shippingName = selectedShipping ? selectedShipping.dataset.name : 'Registro Módico (Livros)';

  const pacRadio = document.querySelector('input[name="shippingOption"][value="pac"]');
  const sedexRadio = document.querySelector('input[name="shippingOption"][value="sedex"]');
  const modicoRadio = document.querySelector('input[name="shippingOption"][value="modico"]');

  const pacPrice = pacRadio ? parseFloat(pacRadio.dataset.price) || 21.90 : 21.90;
  const sedexPrice = sedexRadio ? parseFloat(sedexRadio.dataset.price) || 34.90 : 34.90;
  const modicoPrice = modicoRadio ? parseFloat(modicoRadio.dataset.price) || 12.90 : 12.90;

  const modicoDisplay = document.getElementById('freteModicoPrice');
  const pacDisplay = document.getElementById('fretePacPrice');
  const sedexDisplay = document.getElementById('freteSedexPrice');
  const feedback = document.getElementById('couponFeedback');

  // Cálculo do Desconto do Cupom com regras de negócio
  let valorDesconto = 0;
  if (checkoutState.cupomCodigo && checkoutState.tipoCupom) {
    if (checkoutState.tipoCupom === 'frete_gratis') {
      const isSedex = (shippingVal === 'sedex' || shippingName.toUpperCase().includes('SEDEX'));

      // REGRA: Frete grátis apenas para Normal (módico) e PAC. SEDEX não entra!
      if (isSedex) {
        valorDesconto = 0;
        if (feedback && feedback.style.display !== 'none') {
          feedback.className = 'coupon-feedback warning';
          feedback.innerHTML = `⚠️ <strong>Cupom ${checkoutState.cupomCodigo} ativo:</strong> O benefício de frete grátis é exclusivo para <strong>Registro Módico</strong> e <strong>PAC</strong>. O SEDEX não é elegível. Selecione Registro Módico ou PAC para ter frete grátis.`;
        }
      } else {
        valorDesconto = shippingPrice;
        if (feedback && feedback.style.display !== 'none') {
          feedback.className = 'coupon-feedback success';
          feedback.innerHTML = `✅ <strong>Cupom ${checkoutState.cupomCodigo} ativado!</strong> Frete Grátis aplicado no envio (${shippingName}).`;
        }
      }

      // Atualiza visualmente os cartões com badges
      if (modicoDisplay) {
        modicoDisplay.innerHTML = `<span style="text-decoration: line-through; opacity: 0.6; font-size: 0.8rem; margin-right: 4px;">R$ ${modicoPrice.toFixed(2).replace('.', ',')}</span><strong style="color: #16a34a;">GRÁTIS</strong>`;
      }
      if (pacDisplay) {
        pacDisplay.innerHTML = `<span style="text-decoration: line-through; opacity: 0.6; font-size: 0.8rem; margin-right: 4px;">R$ ${pacPrice.toFixed(2).replace('.', ',')}</span><strong style="color: #16a34a;">GRÁTIS</strong>`;
      }
      if (sedexDisplay) {
        sedexDisplay.innerHTML = `R$ ${sedexPrice.toFixed(2).replace('.', ',')} <span style="display:block; font-size:0.68rem; color:#94a3b8; font-weight:normal;">(Não inclui frete grátis)</span>`;
      }
    } else {
      // Cupom de porcentagem ou fixo
      if (modicoDisplay) modicoDisplay.innerText = `R$ ${modicoPrice.toFixed(2).replace('.', ',')}`;
      if (pacDisplay) pacDisplay.innerText = `R$ ${pacPrice.toFixed(2).replace('.', ',')}`;
      if (sedexDisplay) sedexDisplay.innerText = `R$ ${sedexPrice.toFixed(2).replace('.', ',')}`;

      if (checkoutState.tipoCupom === 'porcentagem') {
        valorDesconto = (bookTotal * checkoutState.valorCupom) / 100;
      } else if (checkoutState.tipoCupom === 'fixo') {
        valorDesconto = Math.min(bookTotal + shippingPrice, checkoutState.valorCupom);
      }
    }
  } else {
    // Sem cupom
    if (modicoDisplay) modicoDisplay.innerText = `R$ ${modicoPrice.toFixed(2).replace('.', ',')}`;
    if (pacDisplay) pacDisplay.innerText = `R$ ${pacPrice.toFixed(2).replace('.', ',')}`;
    if (sedexDisplay) sedexDisplay.innerText = `R$ ${sedexPrice.toFixed(2).replace('.', ',')}`;
  }

  const grandTotal = Math.max(0, (bookTotal + shippingPrice) - valorDesconto);

  checkoutState.quantidade = qty;
  checkoutState.valorLivro = bookPrice;
  checkoutState.opcaoFrete = shippingName;
  checkoutState.valorFrete = shippingPrice;
  checkoutState.valorDesconto = valorDesconto;
  checkoutState.valorTotal = grandTotal;

  // Atualiza tags de radio ativas
  document.querySelectorAll('.frete-radio-card').forEach(card => {
    const radio = card.querySelector('input[type="radio"]');
    card.classList.toggle('active', Boolean(radio && radio.checked));
  });

  // Atualiza sumário topo
  const summaryQty = document.getElementById('summaryBookQty');
  const summaryBookPrice = document.getElementById('summaryBookPrice');
  const summaryFretePrice = document.getElementById('summaryFretePrice');
  const summaryDiscountRow = document.getElementById('summaryDiscountRow');
  const summaryCouponCode = document.getElementById('summaryCouponCodeDisplay');
  const summaryDiscountPrice = document.getElementById('summaryDiscountPrice');
  const summaryTotalPrice = document.getElementById('summaryTotalPrice');

  if (summaryQty) summaryQty.innerText = `${qty}x`;
  if (summaryBookPrice) summaryBookPrice.innerText = bookTotal.toFixed(2).replace('.', ',');
  if (summaryFretePrice) summaryFretePrice.innerText = shippingPrice.toFixed(2).replace('.', ',');

  if (valorDesconto > 0 && summaryDiscountRow) {
    summaryDiscountRow.style.display = 'flex';
    if (summaryCouponCode) summaryCouponCode.innerText = checkoutState.cupomCodigo;
    if (summaryDiscountPrice) summaryDiscountPrice.innerText = valorDesconto.toFixed(2).replace('.', ',');
  } else if (summaryDiscountRow) {
    summaryDiscountRow.style.display = 'none';
  }

  if (summaryTotalPrice) summaryTotalPrice.innerText = grandTotal.toFixed(2).replace('.', ',');

  const summaryFreteName = document.getElementById('summaryFreteNameDisplay');
  if (summaryFreteName) {
    if (shippingName.includes('PAC')) summaryFreteName.innerText = 'PAC';
    else if (shippingName.includes('SEDEX')) summaryFreteName.innerText = 'SEDEX';
    else summaryFreteName.innerText = 'Módico';
  }
}

export function openCheckout() {
  if (checkoutState.estoque.limitar && checkoutState.estoque.livros <= 0) {
    alert('Desculpe! O estoque de exemplares está temporariamente esgotado. Por favor, tente novamente mais tarde.');
    return;
  }
  const m = document.getElementById('checkoutModal');
  if (m) {
    m.classList.add('open');
    document.body.style.overflow = 'hidden';
    goToStep1();
  }
}

export function closeCheckout(e) {
  if (e && e.target !== e.currentTarget) return;
  const m = document.getElementById('checkoutModal');
  if (m) {
    m.classList.remove('open');
    document.body.style.overflow = '';
  }
}

export function goToStep1() {
  checkoutState.currentStep = 1;
  setStepUI(1);
}

export function goToStep2(e) {
  if (e) e.preventDefault();

  // Validação de saldo de estoque
  if (checkoutState.estoque.limitar && checkoutState.quantidade > checkoutState.estoque.livros) {
    alert(`A quantidade selecionada (${checkoutState.quantidade} exemplares) é maior do que o estoque disponível (${checkoutState.estoque.livros} unidades). Por favor, ajuste a quantidade.`);
    return;
  }

  // Coleta dados dos inputs
  checkoutState.cliente.nome = document.getElementById('clientName').value.trim();
  checkoutState.cliente.email = document.getElementById('clientEmail').value.trim();
  checkoutState.cliente.cpf = document.getElementById('clientCpf') ? document.getElementById('clientCpf').value.trim() : '';
  checkoutState.cliente.telefone = document.getElementById('clientPhone').value.trim();
  checkoutState.cliente.cep = document.getElementById('clientCep').value.trim();
  checkoutState.cliente.uf = document.getElementById('clientUf').value.trim().toUpperCase();
  checkoutState.cliente.logradouro = document.getElementById('clientLogradouro').value.trim();
  checkoutState.cliente.numero = document.getElementById('clientNumero').value.trim();
  checkoutState.cliente.complemento = document.getElementById('clientComplemento').value.trim();
  checkoutState.cliente.bairro = document.getElementById('clientBairro').value.trim();
  checkoutState.cliente.cidade = document.getElementById('clientCidade').value.trim();

  // Validações básicas
  if (!checkoutState.cliente.nome || !checkoutState.cliente.email || !checkoutState.cliente.telefone || !checkoutState.cliente.cep || !checkoutState.cliente.logradouro || !checkoutState.cliente.numero) {
    alert('Por favor, preencha todos os campos obrigatórios marcados com * para entrega do livro.');
    return;
  }

  // Validação estrita do CPF para o Mercado Pago
  if (!checkoutState.cliente.cpf || !validarCPF(checkoutState.cliente.cpf)) {
    alert('Por favor, digite um CPF válido. O CPF é obrigatório para emissão de pagamentos (PIX / Cartão).');
    const cpfEl = document.getElementById('clientCpf');
    if (cpfEl) cpfEl.focus();
    return;
  }

  // Coleta dados de presente se estiver marcado
  const isGift = Boolean(document.getElementById('checkIsGift')?.checked);
  checkoutState.isPresente = isGift;

  if (isGift) {
    const recipientName = document.getElementById('giftRecipientName')?.value.trim() || '';
    if (!recipientName) {
      alert('Por favor, informe o nome de quem vai receber o presente.');
      document.getElementById('giftRecipientName')?.focus();
      return;
    }
    checkoutState.presenteDestinatario = recipientName;
    checkoutState.presenteMensagem = document.getElementById('giftMessage')?.value.trim() || '';

    const hasDiffAddress = Boolean(document.getElementById('checkGiftDiffAddress')?.checked);
    checkoutState.presenteEnderecoDiferente = hasDiffAddress;

    if (hasDiffAddress) {
      const gCep = document.getElementById('giftCep')?.value.trim() || '';
      const gLog = document.getElementById('giftLogradouro')?.value.trim() || '';
      const gNum = document.getElementById('giftNumero')?.value.trim() || '';
      const gCompl = document.getElementById('giftComplemento')?.value.trim() || '';
      const gBairro = document.getElementById('giftBairro')?.value.trim() || '';
      const gCidade = document.getElementById('giftCidade')?.value.trim() || '';
      const gUf = document.getElementById('giftUf')?.value.trim().toUpperCase() || '';

      if (!gCep || !gLog || !gNum || !gCidade || !gUf) {
        alert('Por favor, informe o endereço completo de entrega do presenteado (CEP, Rua, Número, Cidade e UF).');
        return;
      }

      checkoutState.presenteEndereco = {
        cep: gCep,
        logradouro: gLog,
        numero: gNum,
        complemento: gCompl,
        bairro: gBairro,
        cidade: gCidade,
        uf: gUf
      };
    } else {
      checkoutState.presenteEndereco = null;
    }
  } else {
    checkoutState.presenteDestinatario = '';
    checkoutState.presenteMensagem = '';
    checkoutState.presenteEnderecoDiferente = false;
    checkoutState.presenteEndereco = null;
  }

  // Preenche tela de conferência (Step 2)
  document.getElementById('reviewName').innerText = checkoutState.cliente.nome;
  if (document.getElementById('reviewCpf')) {
    document.getElementById('reviewCpf').innerText = checkoutState.cliente.cpf;
  }
  document.getElementById('reviewPhone').innerText = checkoutState.cliente.telefone;
  document.getElementById('reviewEmail').innerText = checkoutState.cliente.email;

  const complText = checkoutState.cliente.complemento ? ` (${checkoutState.cliente.complemento})` : '';
  document.getElementById('reviewAddress').innerText = `${checkoutState.cliente.logradouro}, nº ${checkoutState.cliente.numero}${complText}`;
  document.getElementById('reviewAddressCityCep').innerText = `Bairro ${checkoutState.cliente.bairro} — ${checkoutState.cliente.cidade}/${checkoutState.cliente.uf} · CEP: ${checkoutState.cliente.cep}`;

  document.getElementById('reviewFrete').innerText = `${checkoutState.opcaoFrete} (R$ ${checkoutState.valorFrete.toFixed(2).replace('.', ',')})`;
  document.getElementById('reviewQty').innerText = `${checkoutState.quantidade} exemplar(es)`;
  
  // Exibição do cupom aplicado na revisão
  const reviewCouponBlock = document.getElementById('reviewCouponBlock');
  const reviewCouponText = document.getElementById('reviewCouponText');
  if (checkoutState.valorDesconto > 0 && reviewCouponBlock && reviewCouponText) {
    reviewCouponBlock.style.display = 'block';
    const tipoTxt = checkoutState.tipoCupom === 'frete_gratis' ? 'Frete Grátis' : (checkoutState.tipoCupom === 'porcentagem' ? `${checkoutState.valorCupom}% OFF` : 'Valor Fixo');
    reviewCouponText.innerText = `${checkoutState.cupomCodigo} (${tipoTxt}) — Desconto de R$ ${checkoutState.valorDesconto.toFixed(2).replace('.', ',')}`;
  } else if (checkoutState.cupomCodigo && checkoutState.tipoCupom === 'frete_gratis' && reviewCouponBlock && reviewCouponText) {
    reviewCouponBlock.style.display = 'block';
    reviewCouponText.innerHTML = `<span style="color: #92400e; font-size: 0.85rem;">⚠️ Cupom ${checkoutState.cupomCodigo} ativo, mas não aplicável ao frete SEDEX (exclusivo para Registro Módico e PAC).</span>`;
  } else if (reviewCouponBlock) {
    reviewCouponBlock.style.display = 'none';
  }

  // Exibição dos dados do presente na revisão
  const reviewGiftBlock = document.getElementById('reviewGiftBlock');
  const reviewGiftRecipient = document.getElementById('reviewGiftRecipient');
  const reviewGiftMsgRow = document.getElementById('reviewGiftMsgRow');
  const reviewGiftMsg = document.getElementById('reviewGiftMsg');
  const reviewGiftAddressRow = document.getElementById('reviewGiftAddressRow');
  const reviewGiftAddress = document.getElementById('reviewGiftAddress');

  if (checkoutState.isPresente && reviewGiftBlock) {
    reviewGiftBlock.style.display = 'block';
    if (reviewGiftRecipient) reviewGiftRecipient.innerText = checkoutState.presenteDestinatario;

    if (checkoutState.presenteMensagem && reviewGiftMsgRow && reviewGiftMsg) {
      reviewGiftMsgRow.style.display = 'block';
      reviewGiftMsg.innerText = checkoutState.presenteMensagem;
    } else if (reviewGiftMsgRow) {
      reviewGiftMsgRow.style.display = 'none';
    }

    if (checkoutState.presenteEnderecoDiferente && checkoutState.presenteEndereco && reviewGiftAddressRow && reviewGiftAddress) {
      reviewGiftAddressRow.style.display = 'block';
      const gComplTxt = checkoutState.presenteEndereco.complemento ? ` (${checkoutState.presenteEndereco.complemento})` : '';
      reviewGiftAddress.innerText = `${checkoutState.presenteEndereco.logradouro}, nº ${checkoutState.presenteEndereco.numero}${gComplTxt}, ${checkoutState.presenteEndereco.bairro}, ${checkoutState.presenteEndereco.cidade}/${checkoutState.presenteEndereco.uf} · CEP ${checkoutState.presenteEndereco.cep}`;
    } else if (reviewGiftAddressRow) {
      reviewGiftAddressRow.style.display = 'none';
    }
  } else if (reviewGiftBlock) {
    reviewGiftBlock.style.display = 'none';
  }

  document.getElementById('reviewTotal').innerText = `R$ ${checkoutState.valorTotal.toFixed(2).replace('.', ',')}`;

  checkoutState.currentStep = 2;
  setStepUI(2);
}

export async function confirmAndGoToPayment() {
  const btn = document.getElementById('btnConfirmAndPay');
  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Gravando pedido e gerando pagamento...';
  }

  // Gera número do pedido simulado ou temporário
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  checkoutState.orderNumber = `TB-${randomNum}`;

  // Grava pedido no Supabase com suporte a presente
  const payload = {
    nome: checkoutState.cliente.nome,
    email: checkoutState.cliente.email,
    cpf: checkoutState.cliente.cpf,
    telefone: checkoutState.cliente.telefone,
    cep: checkoutState.cliente.cep,
    logradouro: checkoutState.cliente.logradouro,
    numero: checkoutState.cliente.numero,
    complemento: checkoutState.cliente.complemento,
    bairro: checkoutState.cliente.bairro,
    cidade: checkoutState.cliente.cidade,
    uf: checkoutState.cliente.uf,
    quantidade: checkoutState.quantidade,
    opcaoFrete: checkoutState.opcaoFrete,
    valorLivro: checkoutState.valorLivro,
    valorFrete: checkoutState.valorFrete,
    valorTotal: checkoutState.valorTotal,
    metodoPagamento: checkoutState.metodoPagamento,
    statusPagamento: 'pendente',
    cupomCodigo: checkoutState.cupomCodigo,
    valorDesconto: checkoutState.valorDesconto,
    isPresente: checkoutState.isPresente,
    presenteDestinatario: checkoutState.presenteDestinatario,
    presenteMensagem: checkoutState.presenteMensagem,
    presenteEnderecoDiferente: checkoutState.presenteEnderecoDiferente,
    presenteCep: checkoutState.presenteEndereco?.cep || null,
    presenteLogradouro: checkoutState.presenteEndereco?.logradouro || null,
    presenteNumero: checkoutState.presenteEndereco?.numero || null,
    presenteComplemento: checkoutState.presenteEndereco?.complemento || null,
    presenteBairro: checkoutState.presenteEndereco?.bairro || null,
    presenteCidade: checkoutState.presenteEndereco?.cidade || null,
    presenteUf: checkoutState.presenteEndereco?.uf || null
  };

  const { data: pedidoCriado, error } = await salvarPedido(payload);
  if (pedidoCriado && pedidoCriado.id) {
    checkoutState.orderId = pedidoCriado.id;
    if (pedidoCriado.numero_pedido) {
      checkoutState.orderNumber = `TB-${pedidoCriado.numero_pedido}`;
    }

    // Baixa automática de estoque
    if (checkoutState.estoque.limitar && checkoutState.estoque.livros > 0) {
      const novoEstoque = Math.max(0, checkoutState.estoque.livros - checkoutState.quantidade);
      checkoutState.estoque.livros = novoEstoque;
      atualizarConfiguracao('estoque_livros', novoEstoque.toString()).catch(e => console.warn('Aviso ao dar baixa de estoque:', e));
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.innerText = '✅ Tudo Correto, Ir para Pagamento →';
  }

  // Prepara Step 3
  document.getElementById('orderNumberDisplay').innerText = `#${checkoutState.orderNumber}`;
  const totalFormatted = `R$ ${checkoutState.valorTotal.toFixed(2).replace('.', ',')}`;
  document.getElementById('paymentTotalDisplay').innerText = totalFormatted;
  const pixInitialTotal = document.getElementById('pixInitialTotal');
  if (pixInitialTotal) pixInitialTotal.innerText = totalFormatted;
  const pixTotalDisplay = document.getElementById('pixTotalDisplay');
  if (pixTotalDisplay) pixTotalDisplay.innerText = totalFormatted;
  const cardTotalDisplay = document.getElementById('cardTotalDisplay');
  if (cardTotalDisplay) cardTotalDisplay.innerText = totalFormatted;

  // Reseta estado do PIX (aguarda o cliente escolher e clicar em gerar)
  const initialBox = document.getElementById('pixInitialBox');
  const genArea = document.getElementById('pixGeneratedArea');
  const loadBox = document.getElementById('pixLoadingBox');
  const readyBox = document.getElementById('pixReadyBox');
  const feedback = document.getElementById('pixStatusFeedback');

  if (initialBox) initialBox.style.display = 'flex';
  if (genArea) genArea.style.display = 'none';
  if (loadBox) loadBox.style.display = 'none';
  if (readyBox) readyBox.style.display = 'none';
  if (feedback) { feedback.style.display = 'none'; feedback.innerHTML = ''; }

  const btnGerar = document.getElementById('btnGerarPix');
  if (btnGerar) {
    btnGerar.disabled = false;
    btnGerar.innerText = '⚡ Gerar QR Code PIX →';
  }

  // Define PIX como aba padrão ativa
  switchPaymentMethod('pix');

  checkoutState.currentStep = 3;
  setStepUI(3);
}

function setStepUI(step) {
  // Stepper Header
  const ind1 = document.getElementById('stepIndicator1');
  const ind2 = document.getElementById('stepIndicator2');
  const ind3 = document.getElementById('stepIndicator3');
  const line1 = document.getElementById('stepLine1');
  const line2 = document.getElementById('stepLine2');

  if (ind1 && ind2 && ind3) {
    ind1.className = 'step-item ' + (step === 1 ? 'active' : step > 1 ? 'completed' : '');
    ind2.className = 'step-item ' + (step === 2 ? 'active' : step > 2 ? 'completed' : '');
    ind3.className = 'step-item ' + (step === 3 ? 'active' : '');
  }
  if (line1) line1.className = 'step-line ' + (step > 1 ? 'active' : '');
  if (line2) line2.className = 'step-line ' + (step > 2 ? 'active' : '');

  // Panes
  const pane1 = document.getElementById('stepPane1');
  const pane2 = document.getElementById('stepPane2');
  const pane3 = document.getElementById('stepPane3');
  const success = document.getElementById('modalSuccess');

  if (pane1) pane1.classList.toggle('active', step === 1);
  if (pane2) pane2.classList.toggle('active', step === 2);
  if (pane3) pane3.classList.toggle('active', step === 3);
  if (success) success.classList.remove('show');
}

export function switchPaymentMethod(method) {
  checkoutState.metodoPagamento = method;
  const tabPix = document.getElementById('tabPix');
  const tabCartao = document.getElementById('tabCartao');
  const contentPix = document.getElementById('paymentContentPix');
  const contentCartao = document.getElementById('paymentContentCartao');

  if (tabPix) tabPix.classList.toggle('active', method === 'pix');
  if (tabCartao) tabCartao.classList.toggle('active', method === 'cartao');
  if (contentPix) contentPix.classList.toggle('active', method === 'pix');
  if (contentCartao) contentCartao.classList.toggle('active', method === 'cartao');

  // Atualiza no Supabase se o pedido já foi gravado
  if (checkoutState.orderId) {
    atualizarPedido(checkoutState.orderId, { metodo_pagamento: method });
  }

  // Inicializa o Card Payment Brick do Mercado Pago com os dados e valor atualizados
  if (method === 'cartao') {
    inicializarCardPaymentBrick(
      {
        id: checkoutState.orderId,
        numeroPedido: checkoutState.orderNumber,
        valorTotal: checkoutState.valorTotal,
        quantidade: checkoutState.quantidade,
        nome: checkoutState.cliente.nome,
        email: checkoutState.cliente.email,
        cpf: checkoutState.cliente.cpf,
        telefone: checkoutState.cliente.telefone,
        cep: checkoutState.cliente.cep,
        logradouro: checkoutState.cliente.logradouro,
        numero: checkoutState.cliente.numero,
        complemento: checkoutState.cliente.complemento,
        bairro: checkoutState.cliente.bairro,
        cidade: checkoutState.cliente.cidade,
        uf: checkoutState.cliente.uf
      },
      (resultado) => {
        showOrderSuccess();
      },
      (resultado) => {
        console.warn('Transação com cartão não aprovada:', resultado);
      }
    );
  }
}

/**
 * Gera o QR Code PIX somente quando o cliente clica para pagar por PIX
 */
export async function solicitarGeracaoPix() {
  const btn = document.getElementById('btnGerarPix');
  const initialBox = document.getElementById('pixInitialBox');
  const genArea = document.getElementById('pixGeneratedArea');
  const loadBox = document.getElementById('pixLoadingBox');
  const readyBox = document.getElementById('pixReadyBox');
  const feedback = document.getElementById('pixStatusFeedback');

  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ Gerando QR Code PIX...';
  }

  if (initialBox) initialBox.style.display = 'none';
  if (genArea) genArea.style.display = 'block';
  if (loadBox) loadBox.style.display = 'flex';
  if (readyBox) readyBox.style.display = 'none';
  if (feedback) feedback.style.display = 'none';

  try {
    const pixResult = await gerarPixMercadoPago({
      id: checkoutState.orderId,
      numeroPedido: checkoutState.orderNumber,
      nome: checkoutState.cliente.nome,
      email: checkoutState.cliente.email,
      cpf: checkoutState.cliente.cpf,
      telefone: checkoutState.cliente.telefone,
      cep: checkoutState.cliente.cep,
      logradouro: checkoutState.cliente.logradouro,
      numero: checkoutState.cliente.numero,
      complemento: checkoutState.cliente.complemento,
      bairro: checkoutState.cliente.bairro,
      cidade: checkoutState.cliente.cidade,
      uf: checkoutState.cliente.uf,
      valorTotal: parseFloat(checkoutState.valorTotal.toFixed(2)),
      quantidade: checkoutState.quantidade
    });

    if (loadBox) loadBox.style.display = 'none';

    if (pixResult && pixResult.sucesso && pixResult.copiaECola) {
      if (readyBox) readyBox.style.display = 'block';

      const pixInput = document.getElementById('pixCopyInput');
      if (pixInput) pixInput.value = pixResult.copiaECola;

      const qrImg = document.getElementById('pixQrImage');
      if (qrImg) qrImg.src = pixResult.qrCodeImgUrl;

      if (checkoutState.orderId && pixResult.paymentId) {
        await atualizarPedido(checkoutState.orderId, {
          mercado_pago_id: pixResult.paymentId,
          metodo_pagamento: 'pix'
        });
      }

      // Conecta escuta em tempo real para aprovação automática do webhook
      iniciarEscutaPagamentoRealtime();

    } else {
      if (initialBox) initialBox.style.display = 'flex';
      if (genArea) genArea.style.display = 'none';
      if (btn) {
        btn.disabled = false;
        btn.innerText = '⚡ Tentar Gerar Novamente';
      }
      alert(pixResult?.error || 'Ainda não foi possível conectar com o gateway de pagamento. Seu pedido foi gravado, tente gerar novamente em instantes.');
    }
  } catch (err) {
    console.error('Exceção ao gerar PIX:', err);
    if (initialBox) initialBox.style.display = 'flex';
    if (genArea) genArea.style.display = 'none';
    if (btn) {
      btn.disabled = false;
      btn.innerText = '⚡ Tentar Gerar Novamente';
    }
    alert('Erro de conexão ao gerar PIX. Tente novamente.');
  }
}

/**
 * Copia o código Copia e Cola do PIX para a área de transferência
 */
export function copyPixCode() {
  const input = document.getElementById('pixCopyInput');
  const btn = document.getElementById('btnCopyPix');
  if (!input) return;

  input.select();
  input.setSelectionRange(0, 99999);

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(input.value).then(() => {
      if (btn) {
        const orig = btn.innerText;
        btn.innerText = '✅ Copiado!';
        setTimeout(() => { btn.innerText = orig; }, 2000);
      }
    }).catch(() => {
      document.execCommand('copy');
      if (btn) {
        const orig = btn.innerText;
        btn.innerText = '✅ Copiado!';
        setTimeout(() => { btn.innerText = orig; }, 2000);
      }
    });
  } else {
    document.execCommand('copy');
    if (btn) {
      const orig = btn.innerText;
      btn.innerText = '✅ Copiado!';
      setTimeout(() => { btn.innerText = orig; }, 2000);
    }
  }
}

/**
 * Escuta atualização em tempo real quando o pagamento for aprovado pelo webhook
 */
function iniciarEscutaPagamentoRealtime() {
  if (!checkoutState.orderId) return;

  supabase
    .channel(`checkout-order-${checkoutState.orderId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'pedidos', filter: `id=eq.${checkoutState.orderId}` },
      (change) => {
        if (change.new && (change.new.status_pagamento === 'aprovado' || change.new.status_pagamento === 'pago')) {
          console.log('⚡ Pagamento confirmado em tempo real pelo banco!');
          showOrderSuccess();
        }
      }
    )
    .subscribe();
}

/**
 * Consulta se o banco já confirmou o pagamento (NÃO aprova falsamente)
 */
export async function verificarStatusPixCliente() {
  const btn = document.getElementById('btnCheckPix');
  const feedback = document.getElementById('pixStatusFeedback');

  if (btn) {
    btn.disabled = true;
    btn.innerText = '🔍 Consultando compensação no banco...';
  }

  try {
    const { data, error } = await supabase.rpc('consultar_status_pedido', {
      p_id: checkoutState.orderId
    });

    if (data && (data.status_pagamento === 'aprovado' || data.status_pagamento === 'pago')) {
      showOrderSuccess();
      return;
    }

    // Se ainda estiver pendente:
    if (feedback) {
      feedback.style.display = 'block';
      const termo = checkoutState.cliente.email || checkoutState.cliente.telefone || checkoutState.orderNumber;
      feedback.innerHTML = `
        <p>⏱️ <strong>Pagamento ainda em processamento pelo seu banco.</strong></p>
        <p style="margin-top: .3rem; font-size: .78rem; color: #1e3a8a;">Assim que o PIX for compensado, a confirmação acontecerá aqui nesta tela automaticamente em instantes.</p>
        <a href="rastreio.html?q=${encodeURIComponent(termo)}" target="_blank" style="display: inline-block; margin-top: .6rem; color: #1e40af; font-weight: 700; text-decoration: underline;">
          📦 Acompanhar Pedido na Página de Rastreamento →
        </a>
      `;
    }
  } catch (err) {
    console.error('Erro ao consultar status:', err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '🔄 Já Fiz o Pagamento pelo Meu Banco';
    }
  }
}

export async function finalizeCardOrder(e) {
  if (e) e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Registrando pedido com cartão...';
  }

  if (checkoutState.orderId) {
    await atualizarPedido(checkoutState.orderId, {
      metodo_pagamento: 'cartao',
      status_pagamento: 'pendente'
    });
  }

  alert('Pedido registrado com sucesso! Estamos aguardando a compensação da operadora do cartão.');
  showOrderSuccess();
}

function showOrderSuccess() {
  // Esconde todas as panes de etapas
  document.getElementById('stepPane1')?.classList.remove('active');
  document.getElementById('stepPane2')?.classList.remove('active');
  document.getElementById('stepPane3')?.classList.remove('active');

  const success = document.getElementById('modalSuccess');
  if (success) {
    document.getElementById('successOrderNum').innerText = `#${checkoutState.orderNumber}`;
    document.getElementById('successClientName').innerText = checkoutState.cliente.nome;
    document.getElementById('successAddress').innerText = `${checkoutState.cliente.logradouro}, ${checkoutState.cliente.numero} - ${checkoutState.cliente.bairro}, ${checkoutState.cliente.cidade}/${checkoutState.cliente.uf}`;

    const trackingLink = document.getElementById('successTrackingLink');
    if (trackingLink) {
      const query = checkoutState.cliente.email || checkoutState.cliente.telefone || checkoutState.orderNumber;
      trackingLink.href = `rastreio.html?q=${encodeURIComponent(query)}`;
    }

    const msg = `Olá Ingrid! Acabei de realizar o pedido #${checkoutState.orderNumber} do livro Tesouros em Vaso de Barro para o endereço em ${checkoutState.cliente.cidade}/${checkoutState.cliente.uf}.`;
    const waLink = `https://wa.me/5514991292490?text=${encodeURIComponent(msg)}`;
    const waBtn = document.getElementById('successWhatsappBtn');
    if (waBtn) waBtn.href = waLink;

    success.classList.add('show');
  }
}

// Expõe funções no objeto window para callbacks em tags HTML
window.openCheckout = openCheckout;
window.closeCheckout = closeCheckout;
window.goToStep1 = goToStep1;
window.goToStep2 = goToStep2;
window.confirmAndGoToPayment = confirmAndGoToPayment;
window.switchPaymentMethod = switchPaymentMethod;
window.solicitarGeracaoPix = solicitarGeracaoPix;
window.copyPixCode = copyPixCode;
window.verificarStatusPixCliente = verificarStatusPixCliente;
window.finalizeCardOrder = finalizeCardOrder;
window.handleCheckoutCepSearch = handleCheckoutCepSearch;
window.updateCheckoutCalculations = updateCheckoutCalculations;
window.aplicarCupomCheckout = aplicarCupomCheckout;
window.toggleGiftSection = toggleGiftSection;
window.toggleGiftAddressFields = toggleGiftAddressFields;
window.handleGiftCepSearch = handleGiftCepSearch;
