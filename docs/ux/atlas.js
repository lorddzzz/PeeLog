// Presentation navigation only. All screens and values are static design examples.
const catalog=document.getElementById('catalog');
const picker=document.getElementById('screen-picker');
for(const groupName of [...new Set(SCREENS.map(s=>s.group))]){
 const heading=document.createElement('h2');heading.textContent=groupName;catalog.append(heading);
 const optgroup=document.createElement('optgroup');optgroup.label=groupName;
 for(const screen of SCREENS.filter(s=>s.group===groupName)){
  const a=document.createElement('a');a.href='#'+screen.id;a.innerHTML=`<span>${screen.code}</span>${screen.name}`;catalog.append(a);
  const option=document.createElement('option');option.value=screen.id;option.textContent=`${screen.code} · ${screen.name}`;optgroup.append(option);
 }
 picker.append(optgroup);
}
const iconNames=['moon','toilet','carry','water','wake','drop','history','more','check','chevron-right','back','undo','plus','minus','close','edit','delete','clock','bed','sun','note','patterns','routine','backup','restore','share','print','shield','info','alert','phone','offline','appearance','reminder','filter','empty','review','dry','missing','complete'];
function render(){
 const id=location.hash.slice(1)||'welcome';const screen=SCREENS.find(s=>s.id===id)||SCREENS[0];const idx=SCREENS.indexOf(screen);
 document.getElementById('screen-id').textContent=`${screen.code} / ${screen.group}`;
 document.getElementById('study-title').textContent=screen.name;
 document.getElementById('screen').innerHTML=screen.html;
 document.getElementById('annotation').innerHTML=`<h2>WHAT THIS SCREEN DOES</h2><p>${screen.intent}</p><div class="note"><h2>INTERACTION NOTES</h2><ul>${screen.rules.map(r=>`<li>${r}</li>`).join('')}</ul></div><div class="note"><h2>DESIGN REFERENCE</h2><p>Values are illustrative. These screen studies specify appearance and behaviour for the separate implementation phase.</p><a href="../UX-HANDOFF.md">Full UX specification ↗</a></div>`;
 for(const a of catalog.querySelectorAll('a')){if(a.hash==='#'+screen.id)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
 for(const a of document.querySelectorAll('[data-tab]')){if(a.dataset.tab===screen.tab)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
 picker.value=screen.id;
 document.getElementById('previous').href='#'+SCREENS[(idx+SCREENS.length-1)%SCREENS.length].id;
 document.getElementById('next').href='#'+SCREENS[(idx+1)%SCREENS.length].id;
 const assetGrid=document.getElementById('asset-icons');
 if(assetGrid)assetGrid.innerHTML=iconNames.map(name=>`<a class="icon-tile" href="assets/icons/${name}.svg">${icon(name)}<span>${name}</span></a>`).join('');
 document.title=`PeeLog · ${screen.name} — UX study`;
}
picker.addEventListener('change',()=>{location.hash=picker.value;});
window.addEventListener('hashchange',()=>{render();document.getElementById('study-title').scrollIntoView({block:'start'});});
render();
