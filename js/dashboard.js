const usuario = localStorage.getItem("usuarioLogado")

if(!usuario){
	window.location.href = "login.html"
}

document.getElementById("usuario-logado").innerText =
	"Usuario: " + usuario

function formatarMoeda(valor){
	const numero = Number(valor) || 0
	return numero.toLocaleString("pt-BR", {
		style: "currency",
		currency: "BRL"
	})
}

function irObras(){
	window.location.href = "obras.html"
}

function irCaixa(){
	window.location.href = "caixa.html"
}

function irAgenda(){
	window.location.href = "agenda.html"
}

function logout(){
	localStorage.removeItem("usuarioLogado")
	window.location.href = "login.html"
}

const obras = JSON.parse(localStorage.getItem("obras")) || []
const caixa = JSON.parse(localStorage.getItem("caixa")) || 0

document.getElementById("total-obras").innerText =
	"Total de Obras: " + obras.length

document.getElementById("caixa-total").innerText =
	"Caixa: " + formatarMoeda(caixa)

function calcularFinanceiro(){
	const obras = JSON.parse(localStorage.getItem("obras")) || []

	let lucroTotal = 0
	let emAndamento = 0

	const dadosGrafico = []
	const labelsGrafico = []

	obras.forEach(obra => {
		let entradas = 0
		let custos = 0

		if(obra.entradas){
			obra.entradas.forEach(entrada => {
				entradas += Number(entrada.valor)
			})
		}

		if(obra.custos){
			obra.custos.forEach(custo => {
				custos += Number(custo.valor)
			})
		}

		const lucro = entradas - custos

		lucroTotal += lucro

		if(obra.status !== "Finalizada"){
			emAndamento++
		}

		dadosGrafico.push(entradas)
		labelsGrafico.push(obra.cliente)
	})

	document.getElementById("lucro-total").innerText =
		"Lucro Total: " + formatarMoeda(lucroTotal)

	document.getElementById("obras-andamento").innerText =
		"Obras em andamento: " + emAndamento

	criarGrafico(labelsGrafico, dadosGrafico)
}

function criarGrafico(labels, dados){
	const ctx = document.getElementById("grafico").getContext("2d")

	new Chart(ctx, {
		type: "pie",
		data: {
			labels: labels,
			datasets: [{
				data: dados,
				backgroundColor: [
					"#145b7d",
					"#1b7f78",
					"#ffd166",
					"#ff6b6b",
					"#9b5de5",
					"#4cc9f0"
				]
			}]
		},
		options: {
			responsive: true,
			plugins: {
				legend: {
					position: "bottom"
				}
			}
		}
	})
}

calcularFinanceiro()
