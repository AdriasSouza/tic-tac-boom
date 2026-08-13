/****************************************************************************************************************************************************
* LEVANTAMENTO DE CONTRIBUINTES (FRIGORÍFICOS) COM INCONSISTÊNCIA DE ICMS-ST NÃO DESTACADO
*
* OBJETIVO:
* Identificar estabelecimentos com atividade de frigorífico (CNAE) localizados no Acre que:
*   - emitiram NF-e em operações INTERNAS (AC -> AC) tanto para contribuintes quanto para não contribuintes;
*   - possuem, dentre essas NF-e, operações cujo CST/CSOSN exigia destaque de ICMS-ST e o valor não foi destacado
*     (ou o inverso: CST indicava ICMS-ST já retido anteriormente, mas ainda assim veio destacado).
*
* Período de apuração: últimos 5 anos.
*
* PENDÊNCIAS CONFIRMADAS PELO SOLICITANTE:
*   1. CSOSN gravado na mesma coluna CST de nfe.NFE_ICMS (Simples Nacional) - CONFIRMADO.
*   2. Município obtido de nfe.NFE_EMITENTE.XMUN - CONFIRMADO.
*   3. CST/CSOSN genéricos 90/900 INCLUÍDOS na regra de inconsistência, restritos a NCMs de carne
*      (0201, 0202, 0203, 0204, 0207, 1602 - regra geral CONFAZ/AC), para evitar falso positivo.
*   4. Considerada apenas a atividade PRINCIPAL do contribuinte (CONATVTIP = 'S') para classificar como frigorífico.
*   5. Perfil "destinatário inscrito x não inscrito" determinado pela presença do CNPJ do destinatário
*      no cadastro real (siat.EFCDCO), e não pelo campo INDIEDEST da NF-e (preenchimento livre, não confiável).
*      INDIEDEST é mantido na consulta apenas como coluna informativa auxiliar.
*   6. Período de apuração fixado em 01/01/2020 a 31/12/2025.
*
* AUTOR: Adrias Soares de Souza
****************************************************************************************************************************************************/
WITH
-- CTE 1: Cadastro geral do contribuinte (CNPJ, Razão Social, Inscrição Estadual), excluindo órgãos públicos (NATJURCOD = 9999).
cadastro AS (
SELECT
REGEXP_REPLACE(CONINSCNPJ, '[^0-9]', '') AS CNPJ_CLEAN,
CONRAZSOC,
CONINSEST
FROM siat.EFCDCO
WHERE NATJURCOD != '9999'
),
-- CTE 2: Contribuintes cuja atividade (principal ou secundária) é frigorífico/abate.
frigorificos AS (
SELECT DISTINCT
c.CNPJ_CLEAN,
c.CONRAZSOC,
c.CONINSEST,
atv.CONATVCOD
FROM cadastro c
INNER JOIN siat.EFCDATV atv
ON atv.CONINSEST = c.CONINSEST
WHERE atv.CONATVCOD IN (
'10.11-2/01', -- Frigorífico - abate de bovinos
'10.11-2/02', -- Frigorífico - abate de equinos
'10.11-2/03', -- Frigorífico - abate de ovinos e caprinos
'10.11-2/04', -- Frigorífico - abate de bufalinos
'10.12-1/01', -- Abate de aves
'10.12-1/03', -- Frigorífico - abate de suínos
'10.12-1/02' -- Abate de pequenos animais
)
AND atv.CONATVTIP = 'S' -- somente atividade principal
),
-- CTE 3: NF-e de operações INTERNAS (emitente e destinatário no Acre), autorizadas, de saída, período fixo.
--        O perfil de "contribuinte x não contribuinte" do destinatário é determinado pela presença (ou não)
--        do CNPJ dele no cadastro real (siat.EFCDCO), já que o campo INDIEDEST da NF-e é de preenchimento
--        livre pelo emissor e não é confiável. INDIEDEST é mantido apenas como informação auxiliar.
notas_internas AS (
SELECT
id.CHAVE_ACESSO,
id.CNPJ_CPF_EMITENTE,
id.DATA_EMISSAO,
des.INDIEDEST,        -- mantido apenas como referência auxiliar, não como critério de decisão
des.CNPJ_CPF AS CNPJ_DESTINATARIO,
nt.VALOR_NFE,
em.XMUN,               -- ASSUNÇÃO: município vindo do emitente da NF-e
CASE WHEN cad_dest.CNPJ_CLEAN IS NOT NULL THEN 'S' ELSE 'N' END AS DEST_INSCRITO
FROM NFE.NFE_IDENTIFICACAO id
INNER JOIN nfe.NFE_DESTINATARIO des
ON des.CHAVE_ACESSO = id.CHAVE_ACESSO
INNER JOIN nfe.NFE_TOTAL nt
ON nt.CHAVE_ACESSO = id.CHAVE_ACESSO
INNER JOIN nfe.NFE_EMITENTE em
ON em.CHAVE_ACESSO = id.CHAVE_ACESSO
LEFT JOIN cadastro cad_dest
ON cad_dest.CNPJ_CLEAN = des.CNPJ_CPF
WHERE
id.UF_EMITENTE IN ('AC', '12')
AND id.UF_DESTINARATIO IN ('AC', '12') -- operação INTERNA
AND id.STATUS = 1
AND id.FINALIDADE_EMISSAO <> '4'
AND id.TPNF = 1
AND id.DATA_EMISSAO BETWEEN TO_DATE('01/01/2020 00:00:00', 'DD/MM/YYYY HH24:MI:SS')
AND TO_DATE('31/12/2025 23:59:59', 'DD/MM/YYYY HH24:MI:SS') -- últimos 5 anos
),
-- CTE 4: Flag de inconsistência por item da NF-e, com base no CST/CSOSN, no valor de ICMS-ST destacado
--        e, para os códigos genéricos 90/900, também no NCM do produto (lista de carnes - regra geral CONFAZ/AC).
itens_st AS (
SELECT
icms.CHAVE_ACESSO,
icms.NUMERO_PRODUTO,
icms.CST,
icms.VICMSST,
pr.NCM,
CASE
-- ASSUNÇÃO 1: CSOSN gravado na mesma coluna CST para empresas do Simples Nacional.
-- Situações em que o ICMS-ST DEVERIA estar destacado e não está (códigos específicos, qualquer NCM):
WHEN icms.CST IN ('10','30','70','201','202','203')
AND NVL(icms.VICMSST, 0) = 0
THEN 'S'
-- Mesma situação para códigos GENÉRICOS (90/900), restrita a NCMs de carne (evita falso positivo):
WHEN icms.CST IN ('90','900')
AND NVL(icms.VICMSST, 0) = 0
AND (
pr.NCM LIKE '0201%' OR pr.NCM LIKE '0202%' OR pr.NCM LIKE '0203%'
OR pr.NCM LIKE '0204%' OR pr.NCM LIKE '0207%' OR pr.NCM LIKE '1602%'
)
THEN 'S'
-- Situações em que o ICMS-ST já deveria ter sido retido antes (substituído) e veio destacado indevidamente:
WHEN icms.CST IN ('60','500')
AND NVL(icms.VICMSST, 0) > 0
THEN 'S'
ELSE NULL
END AS FLAG_INCONSISTENCIA
FROM nfe.NFE_ICMS icms
INNER JOIN NFE.NFE_PRODUTO pr
ON pr.CHAVE_ACESSO = icms.CHAVE_ACESSO
AND pr.NUMERO_PRODUTO = icms.NUMERO_PRODUTO
),
-- CTE 5: NF-e (distintas) que possuem ao menos um item com inconsistência de ICMS-ST.
notas_inconsistentes AS (
SELECT DISTINCT
n.CHAVE_ACESSO,
n.CNPJ_CPF_EMITENTE,
n.VALOR_NFE,
n.INDIEDEST,  -- informativo apenas
n.DEST_INSCRITO,
n.XMUN
FROM notas_internas n
INNER JOIN itens_st ist
ON ist.CHAVE_ACESSO = n.CHAVE_ACESSO
WHERE ist.FLAG_INCONSISTENCIA = 'S'
),
-- CTE 6: Perfil de emissão do estabelecimento considerando TODAS as notas internas do período
--        (não apenas as inconsistentes), para checar se emitiu tanto para destinatário inscrito
--        quanto para não inscrito no cadastro estadual (critério: presença no cadastro EFCDCO).
perfil_emissor AS (
SELECT
CNPJ_CPF_EMITENTE,
COUNT(DISTINCT CASE WHEN DEST_INSCRITO = 'S' THEN CHAVE_ACESSO END) AS QTD_DEST_INSCRITO,
COUNT(DISTINCT CASE WHEN DEST_INSCRITO = 'N' THEN CHAVE_ACESSO END) AS QTD_DEST_NAO_INSCRITO
FROM notas_internas
GROUP BY CNPJ_CPF_EMITENTE
)
--===================================================================================================================================================
-- SELECT FINAL
--===================================================================================================================================================
SELECT
f.CONINSEST AS "Inscrição Estadual",
ni.CNPJ_CPF_EMITENTE AS "CNPJ",
f.CONRAZSOC AS "Razão Social",
MAX(ni.XMUN)                   AS "Município",
COUNT(DISTINCT ni.CHAVE_ACESSO) AS "Qtd NF-e com Inconsistência (5 anos)",
SUM(ni.VALOR_NFE)              AS "Valor Contábil Total das Operações"
FROM notas_inconsistentes ni
INNER JOIN frigorificos f
ON f.CNPJ_CLEAN = ni.CNPJ_CPF_EMITENTE
INNER JOIN perfil_emissor pe
ON pe.CNPJ_CPF_EMITENTE = ni.CNPJ_CPF_EMITENTE
WHERE
pe.QTD_DEST_INSCRITO > 0
AND pe.QTD_DEST_NAO_INSCRITO > 0 -- emitiu para destinatário inscrito E não inscrito no cadastro estadual
GROUP BY
f.CONINSEST, ni.CNPJ_CPF_EMITENTE, f.CONRAZSOC
ORDER BY
"Valor Contábil Total das Operações" DESC