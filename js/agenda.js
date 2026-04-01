const usuario = localStorage.getItem("usuarioLogado")

if(!usuario){
	window.location.href = "login.html"
}

function voltarDashboard(){
	window.location.href = "dashboard.html"
}

function formatarResponsavelAgenda(obra){
	return obra.responsavelCliente || obra.usuarioCriador || "Nao informado"
}

function formatarDataAgenda(dataTexto){
	if(!dataTexto) return "Sem data"

	const [ano, mes, dia] = dataTexto.split("-")
	if(!ano || !mes || !dia) return dataTexto

	return `${dia}/${mes}/${ano}`
}

function iniciarConfetesAgenda(){
	const canvas = document.getElementById("agenda-confete")
	if(!canvas) return

	const contexto = canvas.getContext("2d")
	const cores = ["#ff6b6b", "#ffd166", "#06d6a0", "#4cc9f0", "#9b5de5", "#f15bb5"]
	const particulas = []
	const quantidadeBase = 90
	let largura = 0
	let altura = 0
	let animationFrameId = null

	function redimensionar(){
		largura = window.innerWidth
		altura = window.innerHeight
		canvas.width = largura
		canvas.height = altura
	}

	function criarParticula(inicioAleatorio){
		const progressoInicial = inicioAleatorio ? Math.random() : 0
		const yBase = -20 + (altura + 40) * progressoInicial
		const tamanho = 4 + Math.random() * 8

		return {
			x: Math.random() * largura,
			y: yBase,
			largura: tamanho,
			altura: tamanho * (0.55 + Math.random() * 0.9),
			velocidadeY: 1.2 + Math.random() * 2.4,
			velocidadeX: (Math.random() - 0.5) * 1.2,
			rotacao: Math.random() * Math.PI * 2,
			rotacaoVelocidade: (Math.random() - 0.5) * 0.08,
			cor: cores[Math.floor(Math.random() * cores.length)],
			opacidade: 0.9
		}
	}

	function popularParticulas(){
		particulas.length = 0
		const quantidade = Math.max(quantidadeBase, Math.floor(largura / 16))

		for(let indice = 0; indice < quantidade; indice++){
			particulas.push(criarParticula(true))
		}
	}

	function desenharParticula(particula){
		const fadeInicio = altura * 0.72
		const distanciaFade = Math.max(altura - fadeInicio, 1)
		const fade = particula.y > fadeInicio
			? Math.max(0, 1 - ((particula.y - fadeInicio) / distanciaFade))
			: 1

		contexto.save()
		contexto.translate(particula.x, particula.y)
		contexto.rotate(particula.rotacao)
		contexto.globalAlpha = particula.opacidade * fade
		contexto.fillStyle = particula.cor
		contexto.fillRect(
			-particula.largura / 2,
			-particula.altura / 2,
			particula.largura,
			particula.altura
		)
		contexto.restore()
	}

	function animar(){
		contexto.clearRect(0, 0, largura, altura)

		particulas.forEach((particula, indice) => {
			particula.y += particula.velocidadeY
			particula.x += particula.velocidadeX + Math.sin((particula.y + indice) * 0.02) * 0.35
			particula.rotacao += particula.rotacaoVelocidade

			if(particula.y > altura + 30){
				particulas[indice] = criarParticula(false)
				return
			}

			if(particula.x < -30){
				particula.x = largura + 20
			}

			if(particula.x > largura + 30){
				particula.x = -20
			}

			desenharParticula(particula)
		})

		animationFrameId = window.requestAnimationFrame(animar)
	}

	redimensionar()
	popularParticulas()
	animar()

	window.addEventListener("resize", () => {
		redimensionar()
		popularParticulas()
	})

	window.addEventListener("beforeunload", () => {
		if(animationFrameId){
			window.cancelAnimationFrame(animationFrameId)
		}
	})
}

function carregarAgenda(){
	const obras = JSON.parse(localStorage.getItem("obras")) || []
	const lista = document.getElementById("lista-agenda")
	const total = document.getElementById("agenda-total")
	const proxima = document.getElementById("agenda-proxima")

	if(!lista) return

	lista.innerHTML = ""

	const obrasAgendadas = obras
		.filter(obra => obra.dataExecucao)
		.sort((a, b) => new Date(a.dataExecucao) - new Date(b.dataExecucao))

	if(total){
		total.innerText = obrasAgendadas.length
	}

	if(proxima){
		proxima.innerText = obrasAgendadas.length
			? formatarDataAgenda(obrasAgendadas[0].dataExecucao)
			: "Sem data"
	}

	if(!obrasAgendadas.length){
		lista.innerHTML = `
			<div class="agenda-vazia">
				<p class="agenda-vazia-titulo">Nenhuma obra agendada no momento.</p>
				<p class="historico-vazio">Assim que uma obra receber data de execucao, ela aparece aqui.</p>
			</div>
		`
		return
	}

	obrasAgendadas.forEach((obra, indice) => {
		const div = document.createElement("div")
		div.classList.add("agenda-card")
		div.innerHTML = `
			<div class="agenda-card-topo">
				<span class="agenda-ordem">${String(indice + 1).padStart(2, "0")}</span>
				<span class="agenda-status">${obra.status}</span>
			</div>
			<h3>${obra.cliente}</h3>
			<p class="agenda-data">Execucao em ${formatarDataAgenda(obra.dataExecucao)}</p>
			<div class="agenda-meta">
				<span>Responsavel: ${formatarResponsavelAgenda(obra)}</span>
				<span>Toque para abrir</span>
			</div>
		`

		div.onclick = () => {
			localStorage.setItem("obraSelecionada", obra.id)
			window.location.href = "obras-detalhe.html"
		}

		lista.appendChild(div)
	})
}

carregarAgenda()
iniciarConfetesAgenda()
