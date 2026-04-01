const usuario = localStorage.getItem("usuarioLogado")

if(!usuario){
	window.location.href = "login.html"
}

function voltarDashboard(){
	window.location.href = "dashboard.html"
}

function formatarMoeda(valor){
	const numero = Number(valor) || 0
	return numero.toLocaleString("pt-BR", {
		style: "currency",
		currency: "BRL"
	})
}

function converterDataParaOrdem(dataTexto){
	if(!dataTexto) return 0

	const partes = dataTexto.split("/")
	if(partes.length !== 3) return 0

	const dia = Number(partes[0])
	const mes = Number(partes[1]) - 1
	const ano = Number(partes[2])

	return new Date(ano, mes, dia).getTime()
}

function carregarCaixa(){
	const caixa = Number(localStorage.getItem("caixa")) || 0

	document.getElementById("valor-caixa").innerText =
		"Valor em Caixa: " + formatarMoeda(caixa)

	const obras = JSON.parse(localStorage.getItem("obras")) || []
	const lista = document.getElementById("lista-caixa")

	if(!lista) return

	lista.innerHTML = ""

	const movimentacoes = []

	obras.forEach(obra => {
		if(obra.entradas){
			obra.entradas.forEach(entrada => {
				movimentacoes.push({
					tipo: "Entrada",
					cliente: obra.cliente,
					valor: entrada.valor,
					data: entrada.data,
					ordem: converterDataParaOrdem(entrada.data)
				})
			})
		}

		if(obra.custos){
			obra.custos.forEach(custo => {
				movimentacoes.push({
					tipo: "Saida",
					cliente: obra.cliente,
					valor: custo.valor,
					data: custo.data,
					ordem: converterDataParaOrdem(custo.data)
				})
			})
		}
	})

	movimentacoes
		.sort((a, b) => b.ordem - a.ordem)
		.forEach(item => {
			const div = document.createElement("div")
			div.classList.add("obra-item", "movimentacao-caixa")
			div.classList.add(item.tipo === "Entrada" ? "entrada-item" : "saida-item")
			div.innerHTML = `
				<span class="tag-movimento ${item.tipo === "Entrada" ? "entrada-tag" : "saida-tag"}">${item.tipo}</span><br>
				${item.cliente}<br>
				${formatarMoeda(item.valor)}<br>
				${item.data}
			`
			lista.appendChild(div)
		})

	if(!movimentacoes.length){
		lista.innerHTML = '<p class="historico-vazio">Nenhuma movimentacao registrada no caixa.</p>'
	}
}

carregarCaixa()
