const usuarios = [

{
usuario:"gustavo",
senha:"1234",
nome:"Gustavo"
},

{
usuario:"ivan",
senha:"1234",
nome:"Ivan"
}

]


function fazerLogin(){

const usuario = document.getElementById("usuario").value
const senha = document.getElementById("senha").value

const usuarioEncontrado = usuarios.find(user => 
user.usuario === usuario && user.senha === senha
)

if(usuarioEncontrado){

localStorage.setItem(
"usuarioLogado",
usuarioEncontrado.nome
)

window.location.href = "dashboard.html"

}else{

document.getElementById("erro-login").innerText =
"Usuário ou senha inválidos"

}

}