-- ==============================================================================
-- SCHEMA DO SUPABASE: LIVRO "TESOUROS EM VASO DE BARRO"
-- Copie e cole este código no SQL Editor do Supabase (https://supabase.com/dashboard/project/otsbdtoxpxlvordvzjjq/sql)
-- e clique em "Run" (Executar).
-- ==============================================================================

-- 1. Criação da tabela de pedidos
CREATE TABLE IF NOT EXISTS public.pedidos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero_pedido BIGSERIAL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Dados do Comprador
    cliente_nome TEXT NOT NULL,
    cliente_email TEXT NOT NULL,
    cliente_cpf TEXT,
    cliente_telefone TEXT NOT NULL,
    
    -- Endereço de Entrega Completo
    cep TEXT NOT NULL,
    logradouro TEXT NOT NULL,
    numero TEXT NOT NULL,
    complemento TEXT DEFAULT '',
    bairro TEXT NOT NULL,
    cidade TEXT NOT NULL,
    uf VARCHAR(2) NOT NULL,
    
    -- Dados da Compra
    quantidade INTEGER DEFAULT 1 NOT NULL,
    opcao_frete TEXT NOT NULL DEFAULT 'Registro Módico (Livros)',
    valor_livro NUMERIC(10, 2) NOT NULL DEFAULT 59.90,
    valor_frete NUMERIC(10, 2) NOT NULL DEFAULT 12.90,
    valor_total NUMERIC(10, 2) NOT NULL,
    
    -- Pagamento
    metodo_pagamento TEXT NOT NULL DEFAULT 'pix', -- 'pix', 'cartao', 'boleto'
    status_pagamento TEXT NOT NULL DEFAULT 'pendente', -- 'pendente', 'aprovado', 'recusado', 'cancelado'
    mercado_pago_id TEXT,
    
    -- Envio e Rastreio dos Correios
    status_envio TEXT NOT NULL DEFAULT 'aguardando_envio', -- 'aguardando_envio', 'em_separacao', 'enviado', 'entregue'
    codigo_rastreio TEXT DEFAULT '',
    data_envio TIMESTAMPTZ,
    
    -- Notas e Observações Internas
    observacoes TEXT DEFAULT ''
);

-- Coluna gerada para busca rápida de telefone/WhatsApp sem pontuação
ALTER TABLE public.pedidos 
ADD COLUMN IF NOT EXISTS cliente_telefone_clean TEXT 
GENERATED ALWAYS AS (regexp_replace(cliente_telefone, '\D', '', 'g')) STORED;

-- 2. Habilitação de Row Level Security (RLS)
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;

-- 3. Políticas de Acesso (RLS Blindado)
-- Permitir que clientes anônimos insiram seus pedidos via checkout da loja
DROP POLICY IF EXISTS "Permitir criacao de pedidos" ON public.pedidos;
CREATE POLICY "Permitir criacao de pedidos"
ON public.pedidos
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Permitir leitura de pedidos APENAS para administradores autenticados (Supabase Auth)
DROP POLICY IF EXISTS "Permitir leitura de pedidos" ON public.pedidos;
DROP POLICY IF EXISTS "Admin ve tudo" ON public.pedidos;
DROP POLICY IF EXISTS "Cliente ve proprio pedido" ON public.pedidos;

CREATE POLICY "Admin ve tudo"
ON public.pedidos
FOR SELECT
TO authenticated
USING (true);

-- Permitir atualização de pedidos APENAS para administradores autenticados
DROP POLICY IF EXISTS "Permitir atualizacao de pedidos" ON public.pedidos;
DROP POLICY IF EXISTS "Admin atualiza pedidos" ON public.pedidos;

CREATE POLICY "Admin atualiza pedidos"
ON public.pedidos
FOR UPDATE
TO authenticated
USING (true);

-- Permitir exclusão de pedidos APENAS para administradores autenticados
DROP POLICY IF EXISTS "Ninguem deleta" ON public.pedidos;
DROP POLICY IF EXISTS "Admin deleta pedidos" ON public.pedidos;
CREATE POLICY "Admin deleta pedidos"
ON public.pedidos
FOR DELETE
TO authenticated
USING (true);

-- 4. Função de Busca de Rastreio (RPC segura para consulta por telefone, e-mail ou nº do pedido)
CREATE OR REPLACE FUNCTION public.buscar_pedido_rastreio(p_termo TEXT)
RETURNS SETOF public.pedidos
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_termo TEXT := trim(p_termo);
    v_digitos TEXT := regexp_replace(v_termo, '\D', '', 'g');
    v_phone TEXT;
    v_num BIGINT;
BEGIN
    IF v_termo IS NULL OR length(v_termo) = 0 THEN
        RETURN;
    END IF;

    -- 1. Se for e-mail (contém @)
    IF v_termo LIKE '%@%' THEN
        RETURN QUERY
        SELECT * FROM public.pedidos
        WHERE cliente_email ILIKE '%' || v_termo || '%'
        ORDER BY created_at DESC;
        RETURN;
    END IF;

    -- 2. Se tiver dígitos suficientes para ser telefone (8 ou mais dígitos)
    IF length(v_digitos) >= 8 THEN
        v_phone := v_digitos;
        -- Se começar com DDI 55 (Brasil) e tiver mais de 11 dígitos, remove o 55
        IF length(v_phone) >= 12 AND v_phone LIKE '55%' THEN
            v_phone := substr(v_phone, 3);
        END IF;

        RETURN QUERY
        SELECT * FROM public.pedidos
        WHERE cliente_telefone_clean ILIKE '%' || v_phone || '%'
           OR regexp_replace(cliente_telefone, '\D', '', 'g') ILIKE '%' || v_phone || '%'
           OR cliente_telefone ILIKE '%' || v_termo || '%'
        ORDER BY created_at DESC;
        RETURN;
    END IF;

    -- 3. Se for número do pedido (ex: 1, 1001 ou #TB-1)
    IF length(v_digitos) > 0 AND length(v_digitos) < 8 THEN
        BEGIN
            v_num := v_digitos::BIGINT;
            RETURN QUERY
            SELECT * FROM public.pedidos
            WHERE numero_pedido = v_num
            ORDER BY created_at DESC;
            
            IF FOUND THEN
                RETURN;
            END IF;
        EXCEPTION WHEN OTHERS THEN
        END;
    END IF;

    -- 4. Busca por nome do cliente ou código de rastreio
    RETURN QUERY
    SELECT * FROM public.pedidos
    WHERE cliente_nome ILIKE '%' || v_termo || '%'
       OR (codigo_rastreio IS NOT NULL AND codigo_rastreio <> '' AND codigo_rastreio ILIKE '%' || v_termo || '%')
    ORDER BY created_at DESC;

END;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_pedido_rastreio(TEXT) TO anon, authenticated, public;

-- 5. Índices para performance
CREATE INDEX IF NOT EXISTS idx_pedidos_created_at ON public.pedidos (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_status_pagamento ON public.pedidos (status_pagamento);
CREATE INDEX IF NOT EXISTS idx_pedidos_status_envio ON public.pedidos (status_envio);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_email ON public.pedidos (cliente_email);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_telefone ON public.pedidos (cliente_telefone);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_telefone_clean ON public.pedidos (cliente_telefone_clean);

-- 6. Comentários para documentação das colunas
COMMENT ON TABLE public.pedidos IS 'Tabela de pedidos do livro Tesouros em Vaso de Barro';
COMMENT ON COLUMN public.pedidos.opcao_frete IS 'Tipo de frete escolhido: Registro Módico, PAC ou SEDEX';
COMMENT ON COLUMN public.pedidos.status_pagamento IS 'Status: pendente, aprovado, recusado ou cancelado';
COMMENT ON COLUMN public.pedidos.status_envio IS 'Status de despacho: aguardando_envio, em_separacao, enviado, entregue';

-- ==============================================================================
-- 7. TABELA DE CONFIGURAÇÕES GERAIS (PREÇOS DO LIVRO / PROMOÇÕES)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.configuracoes (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL,
    descricao TEXT,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.configuracoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leitura publica configuracoes" ON public.configuracoes;
CREATE POLICY "Leitura publica configuracoes"
ON public.configuracoes FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Admin gerencia configuracoes" ON public.configuracoes;
CREATE POLICY "Admin gerencia configuracoes"
ON public.configuracoes FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Valores padrão iniciais de preço e estoque
INSERT INTO public.configuracoes (chave, valor, descricao)
VALUES 
    ('preco_livro', '59.90', 'Preço de venda atual do exemplar físico'),
    ('preco_original', '89.90', 'Preço cheio de capa (riscado)'),
    ('estoque_livros', '100', 'Quantidade de exemplares físicos disponíveis para venda'),
    ('limitar_estoque', 'true', 'Se true, bloqueia vendas no site ao atingir 0 exemplares')
ON CONFLICT (chave) DO NOTHING;

-- ==============================================================================
-- 8. TABELA DE CUPONS DE DESCONTO
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.cupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo TEXT UNIQUE NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('porcentagem', 'frete_gratis', 'fixo')),
    valor NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    ativo BOOLEAN NOT NULL DEFAULT true,
    usos_maximos INTEGER DEFAULT NULL,
    usos_atuais INTEGER NOT NULL DEFAULT 0,
    validade TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.cupons ENABLE ROW LEVEL SECURITY;

-- Proteção RLS: Apenas administradores autenticados podem ver a lista completa e cadastrar cupons
DROP POLICY IF EXISTS "Admin gerencia cupons" ON public.cupons;
CREATE POLICY "Admin gerencia cupons"
ON public.cupons FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Adicionar colunas de cupom, presente e CPF na tabela de pedidos se não existirem
ALTER TABLE public.pedidos 
ADD COLUMN IF NOT EXISTS cliente_cpf TEXT,
ADD COLUMN IF NOT EXISTS cupom_codigo TEXT,
ADD COLUMN IF NOT EXISTS valor_desconto NUMERIC(10, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS is_presente BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS presente_destinatario TEXT,
ADD COLUMN IF NOT EXISTS presente_mensagem TEXT,
ADD COLUMN IF NOT EXISTS presente_endereco_diferente BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS presente_cep TEXT,
ADD COLUMN IF NOT EXISTS presente_logradouro TEXT,
ADD COLUMN IF NOT EXISTS presente_numero TEXT,
ADD COLUMN IF NOT EXISTS presente_complemento TEXT,
ADD COLUMN IF NOT EXISTS presente_bairro TEXT,
ADD COLUMN IF NOT EXISTS presente_cidade TEXT,
ADD COLUMN IF NOT EXISTS presente_uf VARCHAR(2);

-- ==============================================================================
-- 9. FUNÇÃO RPC PARA VALIDAÇÃO SEGURA DE CUPONS (SECURITY DEFINER)
-- Clientes do checkout validam códigos sem permissão direta de leitura na tabela cupons
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.validar_cupom(p_codigo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_cupom RECORD;
BEGIN
    SELECT * INTO v_cupom 
    FROM public.cupons 
    WHERE upper(trim(codigo)) = upper(trim(p_codigo))
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('valido', false, 'mensagem', 'Cupom não encontrado.');
    END IF;

    IF NOT v_cupom.ativo THEN
        RETURN jsonb_build_object('valido', false, 'mensagem', 'Este cupom foi desativado.');
    END IF;

    IF v_cupom.validade IS NOT NULL AND v_cupom.validade < now() THEN
        RETURN jsonb_build_object('valido', false, 'mensagem', 'Este cupom já expirou.');
    END IF;

    IF v_cupom.usos_maximos IS NOT NULL AND v_cupom.usos_atuais >= v_cupom.usos_maximos THEN
        RETURN jsonb_build_object('valido', false, 'mensagem', 'Este cupom atingiu o limite máximo de usos.');
    END IF;

    RETURN jsonb_build_object(
        'valido', true,
        'codigo', v_cupom.codigo,
        'tipo', v_cupom.tipo,
        'valor', v_cupom.valor
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validar_cupom(text) TO anon, authenticated, public;

-- ==============================================================================
-- 10. FUNÇÃO RPC PARA SALVAR PEDIDO NO CHECKOUT (SECURITY DEFINER)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.salvar_pedido_checkout(p_pedido jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id UUID;
    v_num BIGINT;
    v_cupom_cod TEXT;
BEGIN
    v_cupom_cod := upper(trim(COALESCE(p_pedido->>'cupom_codigo', '')));

    INSERT INTO public.pedidos (
        cliente_nome,
        cliente_email,
        cliente_cpf,
        cliente_telefone,
        cep,
        logradouro,
        numero,
        complemento,
        bairro,
        cidade,
        uf,
        quantidade,
        opcao_frete,
        valor_livro,
        valor_frete,
        valor_total,
        metodo_pagamento,
        mercado_pago_id,
        observacoes,
        cupom_codigo,
        valor_desconto,
        is_presente,
        presente_destinatario,
        presente_mensagem,
        presente_endereco_diferente,
        presente_cep,
        presente_logradouro,
        presente_numero,
        presente_complemento,
        presente_bairro,
        presente_cidade,
        presente_uf
    ) VALUES (
        p_pedido->>'cliente_nome',
        p_pedido->>'cliente_email',
        p_pedido->>'cliente_cpf',
        p_pedido->>'cliente_telefone',
        p_pedido->>'cep',
        p_pedido->>'logradouro',
        p_pedido->>'numero',
        COALESCE(p_pedido->>'complemento', ''),
        p_pedido->>'bairro',
        p_pedido->>'cidade',
        p_pedido->>'uf',
        COALESCE((p_pedido->>'quantidade')::int, 1),
        COALESCE(p_pedido->>'opcao_frete', 'Registro Módico (Livros)'),
        COALESCE((p_pedido->>'valor_livro')::numeric, 59.90),
        COALESCE((p_pedido->>'valor_frete')::numeric, 12.90),
        (p_pedido->>'valor_total')::numeric,
        COALESCE(p_pedido->>'metodo_pagamento', 'pix'),
        p_pedido->>'mercado_pago_id',
        COALESCE(p_pedido->>'observacoes', ''),
        NULLIF(v_cupom_cod, ''),
        COALESCE((p_pedido->>'valor_desconto')::numeric, 0.00),
        COALESCE((p_pedido->>'is_presente')::boolean, false),
        p_pedido->>'presente_destinatario',
        p_pedido->>'presente_mensagem',
        COALESCE((p_pedido->>'presente_endereco_diferente')::boolean, false),
        p_pedido->>'presente_cep',
        p_pedido->>'presente_logradouro',
        p_pedido->>'presente_numero',
        p_pedido->>'presente_complemento',
        p_pedido->>'presente_bairro',
        p_pedido->>'presente_cidade',
        p_pedido->>'presente_uf'
    )
    RETURNING id, numero_pedido INTO v_id, v_num;

    -- Se usou cupom, contabiliza o uso
    IF v_cupom_cod IS NOT NULL AND v_cupom_cod <> '' THEN
        UPDATE public.cupons
        SET usos_atuais = usos_atuais + 1
        WHERE upper(trim(codigo)) = v_cupom_cod;
    END IF;

    RETURN jsonb_build_object(
        'id', v_id,
        'numero_pedido', v_num
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_pedido_checkout(jsonb) TO anon, authenticated, public;

