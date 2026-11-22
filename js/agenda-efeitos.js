export function iniciarConfetesAgenda(){
	if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
	const canvas = document.getElementById("agenda-confete")
	if(!canvas) return

	const contexto = canvas.getContext("2d")
	if (!contexto) return
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
		if (document.hidden) { animationFrameId = null; return; }
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

	document.addEventListener("visibilitychange", () => { if (!document.hidden && animationFrameId === null) animar(); });
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

