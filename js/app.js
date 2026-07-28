const KC_BY_MONTH={4:.6,5:.6,6:.75,7:.9,8:.9,9:.9,10:.6};
const DEFAULTS={surfaceHa:1,latitude:43.793931,longitude:4.014810,lastIrrigation:localDate(new Date()),rainEfficiency:.8,kcOverride:null,systemType:"drip",rateMode:"known",knownRate:3,emitterFlow:1.6,emitterSpacing:.5,rowSpacing:4,expert:false,rainCorrections:{}};
const STORAGE_KEY="samIrrigationV1";
const WEATHER_CACHE_KEY="samIrrigationWeatherV1";
let weatherRows=[];
let deferredInstallPrompt=null;

document.addEventListener("DOMContentLoaded",()=>{bindEvents();setupInstallPrompt();loadForm();refreshWeather();registerServiceWorker()});

function bindEvents(){
  q("#refreshButton").addEventListener("click",refreshWeather);
  q("#modeButton").addEventListener("click",toggleMode);
  q("#gpsButton").addEventListener("click",useGps);
  q("#saveMainButton").addEventListener("click",saveMain);
  q("#saveExpertButton").addEventListener("click",saveExpert);
  q("#saveCorrectionsButton").addEventListener("click",saveCorrections);
  q("#rateMode").addEventListener("change",toggleRateFields);
  q("#systemType").addEventListener("change",toggleRateFields);
  q("#installButton").addEventListener("click",installApp);
  window.addEventListener("resize",()=>weatherRows.length&&renderChart());
}
function q(sel){return document.querySelector(sel)}
function val(id){return q("#"+id).value}
function settings(){try{return{...DEFAULTS,...JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}")}}catch{return{...DEFAULTS}}}
function saveSettings(s){localStorage.setItem(STORAGE_KEY,JSON.stringify(s))}
function number(v,fallback=0){const n=Number(v);return Number.isFinite(n)?n:fallback}
function round(v,d=2){const f=10**d;return Math.round((number(v)+Number.EPSILON)*f)/f}
function sum(arr){return arr.reduce((a,b)=>a+number(b),0)}
function monthKc(){return KC_BY_MONTH[new Date().getMonth()+1]??0}
function activeKc(s){return s.kcOverride===null||s.kcOverride===""?monthKc():number(s.kcOverride)}
function localDate(date){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);const m=Object.fromEntries(p.map(x=>[x.type,x.value]));return`${m.year}-${m.month}-${m.day}`}
function formatDate(s){return new Date(s+"T12:00:00").toLocaleDateString("fr-FR",{weekday:"short",day:"2-digit",month:"2-digit"})}
function formatDuration(hours){if(!Number.isFinite(hours)||hours<=0)return"0 h 00";const total=Math.round(hours*60);return`${Math.floor(total/60)} h ${String(total%60).padStart(2,"0")}`}
function wait(ms){return new Promise(r=>setTimeout(r,ms))}

function loadForm(){
  const s=settings();
  ["surfaceHa","latitude","longitude","lastIrrigation","rainEfficiency","systemType","rateMode","knownRate","emitterFlow","emitterSpacing","rowSpacing"].forEach(id=>q("#"+id).value=s[id]);
  q("#kcValue").value=s.kcOverride===null?monthKc():s.kcOverride;
  q("#kcInfo").textContent=`Kc automatique du mois : ${monthKc().toFixed(2)}. La valeur ci-dessus peut être modifiée.`;
  applyMode(s.expert);toggleRateFields();
}
function saveMain(){const s=settings();s.surfaceHa=number(val("surfaceHa"),1);s.latitude=number(val("latitude"),DEFAULTS.latitude);s.longitude=number(val("longitude"),DEFAULTS.longitude);s.lastIrrigation=val("lastIrrigation");saveSettings(s);refreshWeather()}
function saveExpert(){const s=settings();s.rainEfficiency=number(val("rainEfficiency"),.8);s.kcOverride=number(val("kcValue"),monthKc());s.systemType=val("systemType");s.rateMode=val("rateMode");s.knownRate=number(val("knownRate"),3);s.emitterFlow=number(val("emitterFlow"),1.6);s.emitterSpacing=number(val("emitterSpacing"),.5);s.rowSpacing=number(val("rowSpacing"),4);saveSettings(s);render()}
function saveCorrections(){const s=settings();const corrections={...s.rainCorrections};document.querySelectorAll("[data-rain-date]").forEach(input=>{const date=input.dataset.rainDate;if(input.value==="")delete corrections[date];else corrections[date]=number(input.value)});s.rainCorrections=corrections;saveSettings(s);render()}
function toggleMode(){const s=settings();s.expert=!s.expert;saveSettings(s);applyMode(s.expert)}
function applyMode(expert){q("#expertSection").hidden=!expert;q("#modeButton").textContent=expert?"Mode Simple":"Mode Expert"}
function toggleRateFields(){const system=val("systemType");let mode=val("rateMode");if(system!=="drip"&&mode==="calculated"){mode="known";q("#rateMode").value="known"}q("#rateMode").querySelector('option[value="calculated"]').disabled=system!=="drip";const calc=mode==="calculated";q("#knownRateLabel").hidden=calc;q("#emitterFlowLabel").hidden=!calc;q("#emitterSpacingLabel").hidden=!calc;q("#rowSpacingLabel").hidden=!calc}

async function refreshWeather(){
  setLoading(true);hideError();const s=settings();
  try{
    const vars=["et0_fao_evapotranspiration","precipitation_sum","vapour_pressure_deficit_max"].join(",");
    const url=new URL("https://api.open-meteo.com/v1/forecast");
    url.search=new URLSearchParams({latitude:s.latitude,longitude:s.longitude,daily:vars,timezone:"Europe/Paris",past_days:"7",forecast_days:"8"}).toString();
    let response=await fetch(url,{cache:"no-store"});if(!response.ok){await wait(1000);response=await fetch(url,{cache:"no-store"})}if(!response.ok)throw new Error(`Open-Meteo répond ${response.status}.`);
    const data=await response.json();
    weatherRows=data.daily.time.map((date,i)=>({date,etp:number(data.daily.et0_fao_evapotranspiration[i]),rain:number(data.daily.precipitation_sum[i]),vpd:number(data.daily.vapour_pressure_deficit_max[i])}));
    localStorage.setItem(WEATHER_CACHE_KEY,JSON.stringify({savedAt:new Date().toISOString(),rows:weatherRows}));render();
  }catch(err){
    const cached=JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY)||"null");
    if(cached?.rows?.length){weatherRows=cached.rows;showError("Données hors connexion : dernière météo enregistrée affichée.");render(cached.savedAt)}
    else showError("Impossible de récupérer la météo. "+err.message);
  }finally{setLoading(false)}
}
function correctedRain(row,s){const correction=s.rainCorrections?.[row.date];return correction===undefined?row.rain:number(correction)}
function systemRate(s){if(s.rateMode==="calculated"&&s.systemType==="drip"){const den=number(s.emitterSpacing)*number(s.rowSpacing);return den>0?number(s.emitterFlow)/den:0}return number(s.knownRate)}

function render(cachedAt=null){
  if(!weatherRows.length)return;
  const s=settings(),today=localDate(new Date()),kc=activeKc(s);
  const past=weatherRows.filter(r=>r.date>s.lastIrrigation&&r.date<=today);
  const etpTotal=sum(past.map(r=>r.etp)),etcTotal=etpTotal*kc,rainRaw=sum(past.map(r=>correctedRain(r,s))),rainEffective=rainRaw*number(s.rainEfficiency),currentNeed=Math.max(0,etcTotal-rainEffective);
  const future3=weatherRows.filter(r=>r.date>today).slice(0,3),rain3=sum(future3.map(r=>r.rain)),rainFutureEffective=rain3*number(s.rainEfficiency),recommended=Math.max(0,currentNeed-rainFutureEffective);
  const volume=recommended*number(s.surfaceHa)*10,rate=systemRate(s),duration=rate>0?recommended/rate:0,status=statusFor(currentNeed,recommended,rain3);
  q("#statusCard").className=`card hero status-${status.level}`;q("#statusBadge").textContent=status.badge;q("#advice").textContent=status.title;q("#adviceDetail").textContent=status.detail;
  q("#currentNeed").textContent=`${round(currentNeed,2)} mm`;q("#recommendedDose").textContent=`${round(recommended,2)} mm`;q("#volume").textContent=`${round(volume,1)} m³`;q("#duration").textContent=formatDuration(duration);q("#rain3d").textContent=`${round(rain3,1)} mm`;q("#effectiveForecastRain").textContent=`${round(rainFutureEffective,1)} mm efficaces`;
  q("#etpTotal").textContent=`${round(etpTotal,2)} mm`;q("#kcApplied").textContent=kc.toFixed(2);q("#etcTotal").textContent=`${round(etcTotal,2)} mm`;q("#rainRaw").textContent=`${round(rainRaw,2)} mm`;q("#rainEffective").textContent=`${round(rainEffective,2)} mm`;q("#systemRate").textContent=`${round(rate,2)} mm/h`;
  q("#updatedAt").textContent=cachedAt?`Cache du ${new Date(cachedAt).toLocaleString("fr-FR")}`:`Mis à jour à ${new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`;
  renderCorrections(s,today);renderChart();
}
function statusFor(current,recommended,rain3){if(current<=1)return{level:"green",badge:"0–1 mm",title:"Pas besoin d’irriguer",detail:"Le déficit actuel reste inférieur à 1 mm."};if(recommended===0&&rain3>0)return{level:"yellow",badge:"Attendre",title:"Attendre la pluie prévue",detail:`Besoin actuel : ${round(current,1)} mm. La pluie prévue à 3 jours devrait couvrir ce besoin.`};if(current<=3)return{level:"yellow",badge:"1–3 mm",title:"Déficit faible",detail:"Surveille l’évolution du bilan hydrique."};if(current<=6)return{level:"orange",badge:"3–6 mm",title:"Irrigation conseillée",detail:`Dose éventuelle après pluie prévue : ${round(recommended,1)} mm.`};return{level:"red",badge:"> 6 mm",title:"Irrigation prioritaire",detail:`Dose éventuelle après pluie prévue : ${round(recommended,1)} mm.`}}
function renderCorrections(s,today){const box=q("#rainCorrectionList");box.innerHTML="";weatherRows.filter(r=>r.date<=today).slice(-7).forEach(r=>{const row=document.createElement("div");row.className="correction-row";const correction=s.rainCorrections?.[r.date];row.innerHTML=`<strong>${formatDate(r.date)}</strong><span>Open-Meteo : ${round(r.rain,1)} mm</span><input type="number" min="0" step="0.1" placeholder="Pluie corrigée" data-rain-date="${r.date}" value="${correction===undefined?"":correction}">`;box.appendChild(row)})}

function renderChart(){
  const canvas=q("#weatherChart"),ctx=canvas.getContext("2d"),ratio=window.devicePixelRatio||1,width=canvas.clientWidth||800,height=270;
  canvas.width=width*ratio;canvas.height=height*ratio;ctx.scale(ratio,ratio);ctx.clearRect(0,0,width,height);
  const today=localDate(new Date()),rows=[...weatherRows.filter(r=>r.date<=today).slice(-7),...weatherRows.filter(r=>r.date>today).slice(0,7)];if(!rows.length)return;
  const pad={left:48,right:12,top:20,bottom:42},w=width-pad.left-pad.right,h=height-pad.top-pad.bottom,max=Math.ceil(Math.max(1,...rows.flatMap(r=>[r.etp,r.rain,r.vpd]))),group=w/rows.length,bar=Math.min(13,group*.25);
  ctx.font="10px system-ui";ctx.textBaseline="middle";
  for(let i=0;i<=4;i++){const y=pad.top+h*i/4,v=max*(1-i/4);ctx.strokeStyle="#e7dfe1";ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(width-pad.right,y);ctx.stroke();ctx.fillStyle="#75686c";ctx.textAlign="right";ctx.fillText(`${round(v,1)}`,pad.left-6,y)}
  ctx.strokeStyle="#8f8185";ctx.beginPath();ctx.moveTo(pad.left,pad.top);ctx.lineTo(pad.left,pad.top+h);ctx.lineTo(width-pad.right,pad.top+h);ctx.stroke();
  rows.forEach((r,i)=>{const x=pad.left+i*group+group/2;drawBar(x-bar-2,r.etp,"#d98d3d");drawBar(x+2,r.rain,"#4b98c7");ctx.fillStyle=r.date<=today?"#57494d":"#8B1E2D";ctx.font="9px system-ui";ctx.textAlign="center";ctx.textBaseline="alphabetic";ctx.fillText(new Date(r.date+"T12:00:00").toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit"}),x,height-14);function drawBar(bx,v,c){const bh=v/max*h;ctx.fillStyle=c;ctx.fillRect(bx,pad.top+h-bh,bar,bh)}});
  const split=rows.findIndex(r=>r.date>today);if(split>0){const sx=pad.left+split*group;ctx.strokeStyle="#8B1E2D";ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(sx,pad.top);ctx.lineTo(sx,pad.top+h);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle="#8B1E2D";ctx.font="10px system-ui";ctx.textAlign="left";ctx.fillText("Prévisions",sx+5,pad.top+10)}
  ctx.strokeStyle="#8B1E2D";ctx.lineWidth=2;ctx.beginPath();rows.forEach((r,i)=>{const x=pad.left+i*group+group/2,y=pad.top+h-(r.vpd/max*h);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.stroke();
}

function useGps(){const status=q("#gpsStatus");if(!navigator.geolocation){status.textContent="Géolocalisation indisponible.";return}status.textContent="Recherche de la position…";navigator.geolocation.getCurrentPosition(pos=>{q("#latitude").value=round(pos.coords.latitude,6);q("#longitude").value=round(pos.coords.longitude,6);status.textContent="Position trouvée. Clique sur Enregistrer."},()=>status.textContent="Impossible d’obtenir la position.",{enableHighAccuracy:true,timeout:15000})}
function setLoading(v){q("#refreshButton").disabled=v;q("#refreshButton").textContent=v?"…":"↻"}
function showError(m){q("#errorMessage").hidden=false;q("#errorMessage").textContent=m}
function hideError(){q("#errorMessage").hidden=true}
function setupInstallPrompt(){window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstallPrompt=e;q("#installCard").hidden=false});window.addEventListener("appinstalled",()=>{deferredInstallPrompt=null;q("#installCard").hidden=true})}
async function installApp(){if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;q("#installCard").hidden=true}
function registerServiceWorker(){if("serviceWorker"in navigator)navigator.serviceWorker.register("./service-worker.js").catch(console.error)}
