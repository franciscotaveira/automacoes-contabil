const root = document.querySelector('#items');
const tenant = localStorage.getItem('reviewTenant') || prompt('Tenant');
const key = sessionStorage.getItem('reviewKey') || prompt('Chave de revisão');
localStorage.setItem('reviewTenant', tenant || '');
sessionStorage.setItem('reviewKey', key || '');
const headers = {'X-Tenant-ID':tenant,'X-Review-Key':key,'Content-Type':'application/json'};
function field(tag,text){const node=document.createElement(tag);node.textContent=text;return node}
async function request(path,options={}){const response=await fetch(path,{...options,headers});const body=await response.json();if(!response.ok)throw new Error(body.error||'request_failed');return body}
async function load(){root.textContent='';let count=0;for(const status of ['PENDING','CLAIMED']){const body=await request(`/api/items?status=${status}`);for(const item of body.items||[]){count++;const card=document.createElement('article');card.append(field('strong',item.filename||item.correlation_id),field('p',item.reason),field('small',item.correlation_id));const action=document.createElement('button');if(status==='PENDING'){action.textContent='Assumir';action.onclick=async()=>{await request(`/api/items/${item.id}/claim`,{method:'POST',body:JSON.stringify({actor:'operador-web'})});load()}}else{action.textContent='Resolver';action.onclick=async()=>{const resolution=prompt('Decisão e evidência usada');if(resolution){await request(`/api/items/${item.id}/resolve`,{method:'POST',body:JSON.stringify({resolution})});load()}}}card.append(action);root.append(card)}}if(!count)root.textContent='Nenhum item pendente.'}
document.querySelector('#reload').onclick=load;load();
