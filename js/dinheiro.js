export function textoParaCentavos(texto, { zero = false, legado = false } = {}) {
  if (typeof texto === 'number') {
    if (!legado || !Number.isFinite(texto)) throw new Error('Valor monetário inválido.');
    texto = String(texto);
  }
  let s = String(texto ?? '').trim().replace(/^R\$\s*/, '');
  // Grouping is only accepted with an explicit comma decimal separator.
  if (s.includes(',')) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(s)) throw new Error('Informe um valor com até duas casas decimais.');
    s = s.replaceAll('.', '').replace(',', '.');
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) throw new Error('Informe um valor com até duas casas decimais.');
  const [reais, fracao = ''] = s.split('.');
  const n = BigInt(reais) * 100n + BigInt(fracao.padEnd(2, '0'));
  if (n > 999999999999n || n < (zero ? 0n : 1n)) throw new Error('Valor fora do limite permitido.');
  return n.toString();
}
export function formatarBRL(centavos) {
  const n = BigInt(centavos);
  const a = n < 0n ? -n : n;
  return `${n < 0n ? '-' : ''}R$ ${(a / 100n).toLocaleString('pt-BR')},${(a % 100n).toString().padStart(2, '0')}`;
}
export function valorGrafico(centavos) {
  const n = BigInt(centavos);
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < 0n) throw new Error('Valor fora da escala do gráfico.');
  return Number(n) / 100;
}
