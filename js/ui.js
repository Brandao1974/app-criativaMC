export function elemento(tag, texto, classe) {
  const el = document.createElement(tag);
  if (texto !== undefined) el.textContent = texto;
  if (classe) el.className = classe;
  return el;
}
export function linhas(classe, textos) {
  const el = elemento('div', undefined, classe);
  for (const texto of textos) el.append(elemento('p', texto));
  return el;
}
export function dataTexto(iso) {
  if (!iso) return 'Não informado';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.split('-').reverse().join('/');
  return new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(iso));
}
