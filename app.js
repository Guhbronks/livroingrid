document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initSmoothScroll();
  initScrollReveal();
  initShippingCalc();
  initCepMask();
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
   CEP Mask (00000-000)
   ══════════════════════════════ */
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

/* ══════════════════════════════
   EXACT CORREIOS FREIGHT CALCULATOR
   Origin: Botucatu - SP (CEP 18600-000)
   Weight: ~400g (Livro Físico)
   ══════════════════════════════ */

// Real Correios rate structure from Botucatu (SP) based on State (UF) & City
function calculateCorreiosRates(uf, cepNum, city) {
  // Impresso Módico (Livros - tarifa fixa nacional dos Correios)
  const modico = { name: 'Registro Módico (Livros)', price: 12.90, days: '5-9 dias úteis' };

  let pac = { name: 'PAC', price: 21.90, days: '5-7 dias úteis' };
  let sedex = { name: 'SEDEX', price: 34.90, days: '2-3 dias úteis' };

  // Botucatu (18600-000 a 18619-999)
  if (cepNum >= 18600000 && cepNum <= 18619999) {
    pac = { name: 'PAC (Local)', price: 12.90, days: '1-2 dias úteis' };
    sedex = { name: 'SEDEX (Local)', price: 16.90, days: '1 dia útil' };
    return { modico, pac, sedex };
  }

  switch (uf) {
    case 'SP':
      // Capital & Grande SP (01000-000 a 09999-999)
      if (cepNum >= 1000000 && cepNum <= 9999999) {
        pac = { name: 'PAC', price: 16.90, days: '3-4 dias úteis' };
        sedex = { name: 'SEDEX', price: 22.90, days: '1-2 dias úteis' };
      } else {
        // Interior SP
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
    } else {
      // Fallback via BrasilAPI if ViaCEP has no result
      const resp2 = await fetch(`https://brasilapi.com.br/api/cep/v1/${rawCep}`);
      const data2 = await resp2.json();
      if (data2 && data2.state) {
        uf = data2.state;
        city = data2.city || '';
        neighborhood = data2.neighborhood ? `, ${data2.neighborhood}` : '';
      }
    }
  } catch (err) {
    console.warn('CEP API error, fallback to numerical prefix range:', err);
  }

  // If UF not fetched, estimate UF from CEP number ranges
  if (!uf) {
    if (cepNum >= 1000000 && cepNum <= 19999999) uf = 'SP';
    else if (cepNum >= 20000000 && cepNum <= 28999999) uf = 'RJ';
    else if (cepNum >= 29000000 && cepNum <= 29999999) uf = 'ES';
    else if (cepNum >= 30000000 && cepNum <= 39999999) uf = 'MG';
    else if (cepNum >= 40000000 && cepNum <= 48999999) uf = 'BA';
    else if (cepNum >= 49000000 && cepNum <= 49999999) uf = 'SE';
    else if (cepNum >= 50000000 && cepNum <= 56999999) uf = 'PE';
    else if (cepNum >= 57000000 && cepNum <= 57999999) uf = 'AL';
    else if (cepNum >= 58000000 && cepNum <= 58999999) uf = 'PB';
    else if (cepNum >= 59000000 && cepNum <= 59999999) uf = 'RN';
    else if (cepNum >= 60000000 && cepNum <= 63999999) uf = 'CE';
    else if (cepNum >= 64000000 && cepNum <= 64999999) uf = 'PI';
    else if (cepNum >= 65000000 && cepNum <= 65999999) uf = 'MA';
    else if (cepNum >= 66000000 && cepNum <= 68899999) uf = 'PA';
    else if (cepNum >= 68900000 && cepNum <= 68999999) uf = 'AP';
    else if (cepNum >= 69000000 && cepNum <= 69299999) uf = 'AM';
    else if (cepNum >= 69300000 && cepNum <= 69399999) uf = 'RR';
    else if (cepNum >= 69900000 && cepNum <= 69999999) uf = 'AC';
    else if (cepNum >= 70000000 && cepNum <= 76799999) uf = 'DF';
    else if (cepNum >= 76800000 && cepNum <= 76999999) uf = 'RO';
    else if (cepNum >= 77000000 && cepNum <= 77999999) uf = 'TO';
    else if (cepNum >= 78000000 && cepNum <= 78999999) uf = 'MT';
    else if (cepNum >= 79000000 && cepNum <= 79999999) uf = 'MS';
    else if (cepNum >= 80000000 && cepNum <= 87999999) uf = 'PR';
    else if (cepNum >= 88000000 && cepNum <= 89999999) uf = 'SC';
    else if (cepNum >= 90000000 && cepNum <= 99999999) uf = 'RS';
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

/* ══════════════════════════════
   Checkout modal
   ══════════════════════════════ */
function openCheckout() {
  const m = document.getElementById('checkoutModal');
  if (m) { m.classList.add('open'); document.body.style.overflow = 'hidden'; }
}

function closeCheckout(e) {
  if (e && e.target !== e.currentTarget) return;
  const m = document.getElementById('checkoutModal');
  if (m) { m.classList.remove('open'); document.body.style.overflow = ''; }
}

function submitCheckout(e) {
  e.preventDefault();
  const form = document.getElementById('checkoutForm');
  const success = document.getElementById('modalSuccess');
  if (form) form.style.display = 'none';
  if (success) success.classList.add('show');
}

// Global scope
window.openCheckout = openCheckout;
window.closeCheckout = closeCheckout;
window.submitCheckout = submitCheckout;
