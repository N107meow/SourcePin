const launch=document.querySelector('#launch');
launch.addEventListener('click',async()=>{
  launch.disabled=true;
  try{
    const script=document.createElement('script');script.src=`/dist/sourcepin.js?t=${Date.now()}`;
    await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=reject;document.body.append(script);});script.remove();
  }catch{alert('请先运行 npm run build，再启动验收页。');}
  finally{launch.disabled=false;}
});
const toggle=document.querySelector('[data-testid="project-toggle"]');
toggle.addEventListener('click',()=>{
  const expanded=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(expanded));
  document.querySelector('#project-details').hidden=!expanded;document.querySelector('.workspace-card').classList.toggle('is-open',expanded);
});
document.querySelector('#reorder').addEventListener('click',()=>{const list=document.querySelector('#dynamic-list');list.prepend(list.lastElementChild);});
document.querySelector('#add-item').addEventListener('click',()=>{const li=document.createElement('li');li.dataset.convId=`idea-${Date.now()}`;li.textContent='新的灵感，正在发生。';document.querySelector('#dynamic-list').append(li);});
const shadow=document.querySelector('demo-widget').attachShadow({mode:'open'});
shadow.innerHTML='<style>button{padding:14px;border:1px solid #b9cba9;border-radius:8px;background:#e9f0dd;color:#4e693d;font:12px system-ui}button:hover{background:#cee1b3}</style><button data-testid="shadow-button">Shadow DOM 中的按钮</button>';
const canvas=document.querySelector('#art-canvas'),ctx=canvas.getContext('2d');
ctx.fillStyle='#dfe9d2';ctx.fillRect(0,0,300,150);ctx.fillStyle='#90a87a';ctx.beginPath();ctx.arc(130,85,55,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f4f6e7';ctx.beginPath();ctx.arc(190,55,35,0,Math.PI*2);ctx.fill();
fetch('/dist/sourcepin.bookmarklet.txt').then(r=>r.text()).then(text=>{if(text.startsWith('javascript:'))document.querySelector('#bookmarklet').href=text;});
