const usuario = localStorage.getItem("usuarioLogado")
const USUARIOS_APROVACAO = {
	Gustavo: "gustavo",
	Ivan: "ivan"
}

if(!usuario){
	window.location.href = "login.html"
}

function voltarDashboard(){
	window.location.href = "dashboard.html"
}

function voltar(){
	window.location.href = "obras.html"
}

function formatarMoeda(valor){
	const numero = Number(valor) || 0
	return numero.toLocaleString("pt-BR", {
		style: "currency",
		currency: "BRL"
	})
}

function converterMoeda(valor){
	if(typeof valor === "number"){
		return Number.isFinite(valor) ? valor : 0
	}

	const valorTexto = String(valor || "").trim()
	if(!valorTexto) return 0

	const valorSemEspacos = valorTexto.replace(/\s/g, "").replace("R$", "")

	if(valorSemEspacos.includes(",")){
		return Number(
			valorSemEspacos
				.replace(/\./g, "")
				.replace(",", ".")
		) || 0
	}

	return Number(valorSemEspacos) || 0
}

function normalizarStatus(status){
	const mapaStatus = {
		"Negociação": "Negociacao",
		"NegociaÃ§Ã£o": "Negociacao",
		"NegociaÃƒÂ§ÃƒÂ£o": "Negociacao",
		"Em Produção": "Em Producao",
		"Em ProduÃ§Ã£o": "Em Producao",
		"Em ProduÃƒÂ§ÃƒÂ£o": "Em Producao",
		"Em Execução": "Em Execucao",
		"Em ExecuÃ§Ã£o": "Em Execucao",
		"Em ExecuÃƒÂ§ÃƒÂ£o": "Em Execucao"
	}

	return mapaStatus[status] || status || "Negociacao"
}

function normalizarDeleteRequest(deleteRequest){
	return {
		gustavo: Boolean(deleteRequest && deleteRequest.gustavo),
		ivan: Boolean(deleteRequest && deleteRequest.ivan)
	}
}

function normalizarMovimentacao(item, tipoPadrao){
	return {
		id: item.id || Date.now() + Math.floor(Math.random() * 100000),
		tipoRegistro: item.tipoRegistro || tipoPadrao,
		tipo: item.tipo || (tipoPadrao === "entrada" ? "Entrada" : ""),
		descricao: item.descricao || "",
		valor: converterMoeda(item.valor),
		usuario: item.usuario || "",
		data: item.data || new Date().toLocaleDateString(),
		deleteRequest: normalizarDeleteRequest(item.deleteRequest)
	}
}

function normalizarObra(obra){
	return {
		...obra,
		status: normalizarStatus(obra.status),
		valor: converterMoeda(obra.valor),
		localizacao: obra.localizacao || "",
		responsavelCliente: obra.responsavelCliente || "",
		usuarioCriador: obra.usuarioCriador || obra.responsavel || "",
		dataExecucao: obra.dataExecucao || "",
		historico: Array.isArray(obra.historico)
			? obra.historico.map(evento => ({
				...evento,
				status: normalizarStatus(evento.status)
			}))
			: [],
		custos: Array.isArray(obra.custos)
			? obra.custos.map(item => normalizarMovimentacao(item, "custo"))
			: [],
		entradas: Array.isArray(obra.entradas)
			? obra.entradas.map(item => normalizarMovimentacao(item, "entrada"))
			: []
	}
}

function obterObras(){
	const obrasSalvas = JSON.parse(localStorage.getItem("obras")) || []
	const obrasNormalizadas = obrasSalvas.map(normalizarObra)
	localStorage.setItem("obras", JSON.stringify(obrasNormalizadas))
	return obrasNormalizadas
}

function salvarObras(obras){
	localStorage.setItem("obras", JSON.stringify(obras.map(normalizarObra)))
}

function obterObraAtual(){
	const id = localStorage.getItem("obraSelecionada")
	if(!id) return null

	const obras = obterObras()
	const indice = obras.findIndex(obra => String(obra.id) === String(id))
	if(indice === -1) return null

	return {
		id,
		obras,
		indice,
		obra: obras[indice]
	}
}

function obterChaveAprovacao(){
	return USUARIOS_APROVACAO[usuario] || null
}

function formatarStatus(status){
	return status || "Sem status"
}

function criarDeleteRequestTexto(deleteRequest){
	const aprovadores = []

	if(deleteRequest.gustavo) aprovadores.push("Gustavo")
	if(deleteRequest.ivan) aprovadores.push("Ivan")

	if(aprovadores.length === 2){
		return "Exclusao aprovada por Gustavo e Ivan"
	}

	if(aprovadores.length === 1){
		return "Aguardando segunda aprovacao. Aprovado por " + aprovadores[0]
	}

	return "Nenhuma solicitacao de exclusao"
}

function criarBotaoExclusao(item, tipoLista){
	const botao = document.createElement("button")
	const chaveUsuario = obterChaveAprovacao()
	const classeTipo = tipoLista === "custos" ? "custo" : "entrada"

	botao.type = "button"
	botao.className = "botao-exclusao " + classeTipo

	if(!chaveUsuario){
		botao.innerText = "Exclusao indisponivel"
		botao.disabled = true
		return botao
	}

	if(item.deleteRequest[chaveUsuario]){
		botao.innerText = "Exclusao aprovada por voce"
		botao.disabled = true
		return botao
	}

	botao.innerText = item.deleteRequest.gustavo || item.deleteRequest.ivan
		? "Aprovar exclusao"
		: "Solicitar exclusao"

	botao.onclick = evento => {
		evento.stopPropagation()
		solicitarExclusao(tipoLista, item.id)
	}

	return botao
}

function criarStatusExclusao(item){
	const status = document.createElement("div")
	status.className = "status-exclusao"

	const classe = item.deleteRequest.gustavo || item.deleteRequest.ivan
		? "pendente"
		: "sem-solicitacao"

	status.innerHTML = `
		<span class="badge-exclusao ${classe}">${criarDeleteRequestTexto(item.deleteRequest)}</span>
	`

	return status
}

function criarCardMovimentacao(item, tipoLista){
	const div = document.createElement("div")
	div.classList.add("obra-item", "movimentacao-item")

	const titulo = tipoLista === "custos"
		? `<b>${item.tipo || "Custo"}</b>`
		: `<b>${item.descricao}</b>`

	const descricao = tipoLista === "custos" && item.descricao
		? `${item.descricao}<br>`
		: ""

	div.innerHTML = `
		${titulo}<br>
		${descricao}
		${formatarMoeda(item.valor)}<br>
		${item.usuario} - ${item.data}
	`

	div.appendChild(criarStatusExclusao(item))
	div.appendChild(criarBotaoExclusao(item, tipoLista))

	return div
}

function criarObra(){
	const cliente = document.getElementById("cliente").value.trim()
	const descricao = document.getElementById("descricao").value.trim()
	const localizacao = document.getElementById("localizacao").value.trim()
	const responsavelCliente = document.getElementById("responsavel-loja").value.trim()
	const valor = converterMoeda(document.getElementById("valor").value)

	if(!cliente) return

	const obras = obterObras()
	const novaObra = normalizarObra({
		id: Date.now(),
		cliente,
		descricao,
		localizacao,
		responsavelCliente,
		usuarioCriador: usuario,
		valor,
		status: "Negociacao",
		data: new Date().toLocaleDateString(),
		historico: [
			{
				status: "Negociacao",
				usuario: usuario,
				data: new Date().toLocaleString()
			}
		],
		custos: [],
		entradas: []
	})

	obras.push(novaObra)
	salvarObras(obras)
	carregarObras()
	limparCampos()
}

function limparCampos(){
	const ids = ["cliente", "descricao", "localizacao", "responsavel-loja", "valor"]
	ids.forEach(id => {
		const campo = document.getElementById(id)
		if(campo){
			campo.value = ""
		}
	})
}

function carregarObras(){
	const lista = document.getElementById("lista")
	if(!lista) return

	const obras = obterObras()
	lista.innerHTML = ""

	obras.forEach(obra => {
		const div = document.createElement("div")
		div.classList.add("obra-item")
		div.innerHTML = `
			<b>${obra.cliente}</b><br>
			${obra.localizacao || obra.descricao || "Sem localizacao informada"}<br>
			Status: ${formatarStatus(obra.status)}
		`
		div.onclick = () => abrirObra(obra.id)
		lista.appendChild(div)
	})
}

function abrirObra(id){
	localStorage.setItem("obraSelecionada", id)
	window.location.href = "obras-detalhe.html"
}

function carregarDetalhe(){
	const contexto = obterObraAtual()
	if(!contexto) return

	const obra = contexto.obra
	const usuarioLogado = document.getElementById("usuario-logado")

	if(usuarioLogado){
		usuarioLogado.innerText = "Usuario logado: " + usuario
	}

	document.getElementById("cliente").innerText = obra.cliente
	document.getElementById("descricao").innerText = "Descricao: " + (obra.descricao || "Sem descricao informada")
	document.getElementById("status").innerText = "Status: " + formatarStatus(obra.status)
	document.getElementById("valor").innerText = formatarMoeda(obra.valor)
	document.getElementById("localizacao").innerText = obra.localizacao || "Nao informada"
	document.getElementById("responsavel-cliente").innerText = obra.responsavelCliente || "Nao informado"
	document.getElementById("usuario-criador").innerText = obra.usuarioCriador || "Nao informado"

	const selectStatus = document.getElementById("novo-status")
	if(selectStatus){
		selectStatus.value = obra.status
	}

	const campoDataExecucao = document.getElementById("data-execucao")
	if(campoDataExecucao){
		campoDataExecucao.value = obra.dataExecucao || ""
	}

	const textoDataAgendada = document.getElementById("data-agendada")
	if(textoDataAgendada){
		textoDataAgendada.innerText = obra.dataExecucao
			? "Data Agendada: " + obra.dataExecucao
			: ""
	}

	carregarHistorico(obra)
	carregarCustos(obra)
	carregarEntradas(obra)
}

function carregarHistorico(obra){
	const lista = document.getElementById("historico")
	if(!lista) return

	lista.innerHTML = ""

	if(!obra.historico.length){
		lista.innerHTML = '<p class="historico-vazio">Nenhuma atualizacao registrada ainda.</p>'
		return
	}

	obra.historico
		.slice()
		.reverse()
		.forEach(evento => {
			const item = document.createElement("div")
			item.className = "historico-item"
			item.innerHTML = `
				<b>${formatarStatus(evento.status)}</b><br>
				${evento.usuario} - ${evento.data}
			`
			lista.appendChild(item)
		})
}

function alterarStatus(){
	const contexto = obterObraAtual()
	if(!contexto) return

	const novoStatus = document.getElementById("novo-status").value
	if(!novoStatus || contexto.obra.status === novoStatus) return

	contexto.obra.status = novoStatus
	contexto.obra.historico.push({
		status: novoStatus,
		usuario: usuario,
		data: new Date().toLocaleString()
	})

	salvarObras(contexto.obras)
	carregarDetalhe()
	carregarObras()
}

function agendarObra(){
	const contexto = obterObraAtual()
	if(!contexto) return

	const data = document.getElementById("data-execucao").value
	if(!data) return

	contexto.obra.dataExecucao = data
	contexto.obra.status = "Agendada"
	contexto.obra.historico.push({
		status: "Agendada",
		usuario: usuario,
		data: new Date().toLocaleString(),
		dataExecucao: data
	})

	salvarObras(contexto.obras)
	carregarDetalhe()
	carregarObras()
}

function adicionarEntrada(){
	const contexto = obterObraAtual()
	if(!contexto) return

	const descricao = document.getElementById("descricao-entrada").value.trim()
	const valor = converterMoeda(document.getElementById("valor-entrada").value)

	if(!descricao || !valor) return

	const entrada = normalizarMovimentacao({
		id: Date.now(),
		tipo: "Entrada",
		descricao,
		valor,
		usuario,
		data: new Date().toLocaleDateString()
	}, "entrada")

	contexto.obra.entradas.push(entrada)

	let caixa = converterMoeda(localStorage.getItem("caixa"))
	caixa += valor
	localStorage.setItem("caixa", caixa)

	salvarObras(contexto.obras)
	carregarEntradas(contexto.obra)
	calcularLucro(contexto.obra)

	document.getElementById("descricao-entrada").value = ""
	document.getElementById("valor-entrada").value = ""
}

function carregarEntradas(obra){
	const lista = document.getElementById("entradas")
	if(!lista) return

	lista.innerHTML = ""
	let total = 0

	obra.entradas.forEach(entrada => {
		total += converterMoeda(entrada.valor)
		lista.appendChild(criarCardMovimentacao(entrada, "entradas"))
	})

	document.getElementById("total-entradas").innerText =
		"Total Entradas: " + formatarMoeda(total)

	calcularLucro(obra)
}

function adicionarCusto(){
	const contexto = obterObraAtual()
	if(!contexto) return

	const tipo = document.getElementById("tipo").value.trim()
	const descricao = document.getElementById("descricao-custo").value.trim()
	const valor = converterMoeda(document.getElementById("valor-custo").value)

	if(!tipo || !descricao || !valor) return

	const custo = normalizarMovimentacao({
		id: Date.now(),
		tipo,
		descricao,
		valor,
		usuario,
		data: new Date().toLocaleDateString()
	}, "custo")

	contexto.obra.custos.push(custo)

	let caixa = converterMoeda(localStorage.getItem("caixa"))
	caixa -= valor
	localStorage.setItem("caixa", caixa)

	salvarObras(contexto.obras)
	carregarCustos(contexto.obra)
	calcularLucro(contexto.obra)

	document.getElementById("tipo").value = ""
	document.getElementById("descricao-custo").value = ""
	document.getElementById("valor-custo").value = ""
}

function carregarCustos(obra){
	const lista = document.getElementById("custos")
	if(!lista) return

	lista.innerHTML = ""
	let total = 0

	obra.custos.forEach(custo => {
		total += converterMoeda(custo.valor)
		lista.appendChild(criarCardMovimentacao(custo, "custos"))
	})

	document.getElementById("total-custos").innerText =
		"Total Custos: " + formatarMoeda(total)

	const resumoCustos = document.getElementById("resumo-custos")
	if(resumoCustos){
		resumoCustos.innerText = formatarMoeda(total)
	}
}

function calcularLucro(obra){
	let totalCustos = 0
	let totalEntradas = 0

	obra.custos.forEach(custo => {
		totalCustos += converterMoeda(custo.valor)
	})

	obra.entradas.forEach(entrada => {
		totalEntradas += converterMoeda(entrada.valor)
	})

	const lucro = totalEntradas - totalCustos
	document.getElementById("lucro").innerText = formatarMoeda(lucro)
}

function solicitarExclusao(tipoLista, itemId){
	const contexto = obterObraAtual()
	if(!contexto) return

	const chaveUsuario = obterChaveAprovacao()
	if(!chaveUsuario) return

	const lista = contexto.obra[tipoLista]
	const item = lista.find(registro => String(registro.id) === String(itemId))
	if(!item) return

	item.deleteRequest[chaveUsuario] = true

	if(item.deleteRequest.gustavo && item.deleteRequest.ivan){
		contexto.obra[tipoLista] = lista.filter(
			registro => String(registro.id) !== String(itemId)
		)
	}

	salvarObras(contexto.obras)
	carregarDetalhe()
}

carregarObras()

if(window.location.pathname.includes("obras-detalhe")){
	carregarDetalhe()
}
