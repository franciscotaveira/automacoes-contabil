// Executa somente o snapshot local, sem rede, credenciais ou acesso ao Drive.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const code = fs.readFileSync(path.join(__dirname, 'hierarquia-snapshot.js'), 'utf8');
const base = {reference_date:'2026-10-10',source_filename:'exemplo.pdf',document_type:'nf-e',department:'fiscal',document_number:'TESTE',issuer_name:'Fornecedor Exemplo',recipient_name:'Empresa Beta',review_required:false};
const cases = [
 ['sem_politica',{},false],
 ['nome_por_substring',{archive_owner_name:'Empresa',recipient_name:'Empresa Distinta Ltda'},false],
 ['cnpj_sem_nome',{archive_owner_cnpj:'11111111111111',recipient_cnpj:'22222222222222'},false],
 ['modo_invalido',{archive_mode:'typo'},false],
 ['cnpj_conflitante_controle',{archive_owner_name:'Empresa Beta',archive_owner_cnpj:'11111111111111',recipient_cnpj:'22222222222222'},true]
];
for (const [id, extra, expectedCurrent] of cases) {
 const output = new Function('$input', code)({first:()=>({json:{...base,...extra}})})[0].json;
 assert.equal(output.review_required, expectedCurrent, id);
 console.log(JSON.stringify({id,review:output.review_required,folder:output.client_folder,diagnostic_reproduced:true}));
}
console.log('5 reproduções confirmadas; 4 lacunas e 1 controle. Não é aprovação de produção.');
