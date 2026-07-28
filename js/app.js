
const KC_BY_MONTH={4:.6,5:.6,6:.75,7:.9,8:.9,9:.9,10:.6};
const DEFAULTS={
  surfaceHa:1,latitude:43.793931,longitude:4.014810,
  lastIrrigation:localDate(new Date()),frequency:7,
  rainEfficiency:.8,kcOverride:null,
  systemType:"drip",rateMode:"known",knownRate:3,
  emitterFlow:1.6,emitterSpacing:.5,rowSpacing:4,
  expert:false,rainCorrections:{}
};
const STORAGE_KEY="samIrrigationWeeklyV1";
const WEATHER_CACHE_KEY="samIrrigationWeeklyWeatherV1";
let weatherRows=[];
let deferredInstallPrompt=null;

document.addEventListener("DOMContentLoaded",()=>{
  bindEvents();setupInstallPrompt();loadForm();refreshWeather();registerServiceWorker();
});

function q(s){return document.querySelector(s)}
function val(id){return q("#"+id).value}
function num(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f}
function round(v,d=2){const f=10**d;return Math.round((num(v)+Number.EPSILON)*f)/f}
function sum(a){return a.reduce((x,y)=>x+num(y),0)}
function wait(ms){return new Promise(r=>setTimeout(r,ms))}
function localDate(date){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);const m=Object.fromEntries(p.map(x=>[x.type,x.value]));return`${m.year}-${m.month}-${m.day}`}
function formatDate(s){return new Date(s+"T12:00:00").toLocaleDateString("fr-FR",{weekday:"short",day:"2-digit",month:"2-digit"})}
function formatDuration(hours){if(!Number.isFinite(hours)||hours<=0)return"0 h 00";const t=Math.round(hours*60);return`${Math.floor(t/60)} h ${String(t%60).padStart(2,"0")}`}
function monthKc(){return KC_BY_MONTH[new Date().getMonth()+1]??0}
function activeKc(s){return s.kcOverride===null||s.kcOverride===""?monthKc():num(s.kcOverride)}
function settings(){try{return{...DEFAULTS,...JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}")}}catch{return{...DEFAULTS}}}
function persist(s){localStorage.setItem(STORAGE_KEY,JSON.stringify(s))}

function bindEvents(){
  q("#refreshButton").addEventListener("click",refreshWeather);
  q("#modeButton").addEventListener("click",toggleMode);
  q("#gpsButton").addEventListener("click",useGps);
  q("#calculateButton").addEventListener("click",saveMainAndRender);
  q("#saveExpertButton").addEventListener("click",saveExpert);
  q("#saveCorrectionsButton").addEventListener("click",saveCorrections);
  q("#rateMode").addEventListener("change",toggleRateFields);
  q("#installButton").addEventListener("click",installApp);
  window.addEventListener("resize",()=>weatherRows.length&&renderChart());
}

function loadForm(){
  const s=settings();
  ["surfaceHa","latitude","longitude","lastIrrigation","frequency","rainEfficiency","systemType","rateMode","knownRate","emitterFlow","emitterSpacing","rowSpacing"].forEach(id=>q("#"+id).value=s[id]);
  q("#kcValue").value=s.kcOverride===null?monthKc():s.kcOverride;
  q("#kcInfo").textContent=`Kc automatique du mois : ${monthKc().toFixed(2)}.`;
  applyMode(s.expert);toggleRateFields();
}

function saveMainAndRender(){
  const s=settings();
  s.surfaceHa=num(val("surfaceHa"),1);
  s.latitude=num(val("latitude"),DEFAULTS.latitude);
  s.longitude=num(val("longitude"),DEFAULTS.longitude);
  s.lastIrrigation=val("lastIrrigation");
  s.frequency=num(val("frequency"),7);
  persist(s);
  refreshWeather();
}

function saveExpert(){
  const s=settings();
  s.rainEfficiency=num(val("rainEfficiency"),.8);
  s.kcOverride=num(val("kcValue"),monthKc());
  s.systemType=val("systemType");
  s.rateMode=val("rateMode");
  s.knownRate=num(val("knownRate"),3);
  s.emitterFlow=num(val("emitterFlow"),1.6);
  s.emitterSpacing=num(val("emitterSpacing"),.5);
  s.rowSpacing=num(val("rowSpacing"),4);
  persist(s);render();
}

function saveCorrections(){
  const s=settings(),cor={...s.rainCorrections};
  document.querySelectorAll("[data-rain-date]").forEach(i=>{
    if(i.value==="")delete cor[i.dataset.rainDate];else cor[i.dataset.rainDate]=num(i.value);
  });
  s.rainCorrections=cor;persist(s);render();
}

function toggleMode(){const s=settings();s.expert=!s.expert;persist(s);applyMode(s.expert)}
function applyMode(expert){q("#expertSection").hidden=!expert;q("#modeButton").textContent=expert?"Mode Simple":"Mode Expert"}
function toggleRateFields(){const calc=val("rateMode")==="calculated";q("#knownRateLabel").hidden=calc;q("#emitterFlowLabel").hidden=!calc;q("#emitterSpacingLabel").hidden=!calc;q("#rowSpacingLabel").hidden=!calc}

async function refreshWeather(){
  setLoading(true);hideError();
  const s=settings();
  try{
    const vars=["et0_fao_evapotranspiration","precipitation_sum"].join(",");
    const url=new URL("https://api.open-meteo.com/v1/forecast");
    url.search=new URLSearchParams({
      latitude:s.latitude,longitude:s.longitude,daily:vars,
      timezone:"Europe/Paris",past_days:"7",forecast_days:"8"
    }).toString();
    let r=await fetch(url,{cache:"no-store"});
    if(!r.ok){await wait(1000);r=await fetch(url,{cache:"no-store"})}
    if(!r.ok)throw new Error(`Open-Meteo répond ${r.status}.`);
    const d=await r.json();
    weatherRows=d.daily.time.map((date,i)=>({date,etp:num(d.daily.et0_fao_evapotranspiration[i]),rain:num(d.daily.precipitation_sum[i])}));
    localStorage.setItem(WEATHER_CACHE_KEY,JSON.stringify({savedAt:new Date().toISOString(),rows:weatherRows}));
    render();
  }catch(e){
    const c=JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY)||"null");
    if(c?.rows?.length){weatherRows=c.rows;showError("Données hors connexion : dernière météo enregistrée.");render(c.savedAt)}
    else showError("Impossible de récupérer la météo. "+e.message);
  }finally{setLoading(false)}
}

function correctedRain(r,s){const c=s.rainCorrections?.[r.date];return c===undefined?r.rain:num(c)}
function systemRate(s){
  if(s.rateMode==="calculated"){
    const den=num(s.emitterSpacing)*num(s.rowSpacing);
    return den>0?num(s.emitterFlow)/den:0;
  }
  return num(s.knownRate);
}

function render(cachedAt=null){
  if(!weatherRows.length)return;
  const s=settings(),today=localDate(new Date()),kc=activeKc(s);
  const past=weatherRows.filter(r=>r.date>s.lastIrrigation&&r.date<=today);
  const pastEtc=sum(past.map(r=>r.etp*kc));
  const pastRainEff=sum(past.map(r=>correctedRain(r,s)))*num(s.rainEfficiency);
  const pastDeficit=Math.max(0,pastEtc-pastRainEff);

  const future=weatherRows.filter(r=>r.date>today).slice(0,7);
  const futureGross=sum(future.map(r=>r.etp*kc));
  const futureRain=sum(future.map(r=>r.rain));
  const futureRainEff=futureRain*num(s.rainEfficiency);
  const futureNet=Math.max(0,futureGross-futureRainEff);

  const total=pastDeficit+futureNet;
  const count=Math.max(1,num(s.frequency,7));
  const dose=total/count;
  const volume=dose*num(s.surfaceHa)*10;
  const rate=systemRate(s);
  const duration=rate>0?dose/rate:0;

  q("#totalNeed").textContent=`${round(total,2)} mm`;
  q("#applicationCount").textContent=String(count);
  q("#dosePerApplication").textContent=`${round(dose,2)} mm`;
  q("#volumePerApplication").textContent=`${round(volume,1)} m³`;
  q("#durationPerApplication").textContent=formatDuration(duration);
  q("#pastDeficit").textContent=`${round(pastDeficit,2)} mm`;
  q("#futureGrossNeed").textContent=`${round(futureGross,2)} mm`;
  q("#futureRain").textContent=`${round(futureRain,2)} mm`;
  q("#futureEffectiveRain").textContent=`${round(futureRainEff,2)} mm`;
  q("#futureNetNeed").textContent=`${round(futureNet,2)} mm`;
  q("#updatedAt").textContent=cachedAt?`Données enregistrées le ${new Date(cachedAt).toLocaleString("fr-FR")}`:`Météo actualisée à ${new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`;
  renderProgram(count,dose,volume,duration);
  renderCorrections(s,today);
  renderChart();
}

function renderProgram(count,dose,volume,duration){
  const box=q("#programList");box.innerHTML="";
  for(let i=1;i<=count;i++){
    const row=document.createElement("div");row.className="program-row";
    row.innerHTML=`<span>Apport ${i}</span><strong>${round(dose,2)} mm · ${round(volume,1)} m³ · ${formatDuration(duration)}</strong>`;
    box.appendChild(row);
  }
}

function renderCorrections(s,today){
  const box=q("#rainCorrectionList");box.innerHTML="";
  weatherRows.filter(r=>r.date<=today).slice(-7).forEach(r=>{
    const c=s.rainCorrections?.[r.date],row=document.createElement("div");
    row.className="correction-row";
    row.innerHTML=`<strong>${formatDate(r.date)}</strong><span>Open-Meteo : ${round(r.rain,1)} mm</span><input type="number" min="0" step="0.1" placeholder="Pluie corrigée" data-rain-date="${r.date}" value="${c===undefined?"":c}">`;
    box.appendChild(row);
  });
}

function renderChart(){
  const canvas=q("#weatherChart"),ctx=canvas.getContext("2d"),ratio=window.devicePixelRatio||1;
  const width=canvas.clientWidth||800,height=270;
  canvas.width=width*ratio;canvas.height=height*ratio;ctx.scale(ratio,ratio);ctx.clearRect(0,0,width,height);
  const today=localDate(new Date());
  const rows=[...weatherRows.filter(r=>r.date<=today).slice(-7),...weatherRows.filter(r=>r.date>today).slice(0,7)];
  if(!rows.length)return;
  const pad={left:48,right:12,top:20,bottom:42},w=width-pad.left-pad.right,h=height-pad.top-pad.bottom;
  const max=Math.ceil(Math.max(1,...rows.flatMap(r=>[r.etp,r.rain])));
  const group=w/rows.length,bar=Math.min(13,group*.25);
  ctx.font="10px system-ui";ctx.textBaseline="middle";
  for(let i=0;i<=4;i++){
    const y=pad.top+h*i/4,v=max*(1-i/4);
    ctx.strokeStyle="#e7dfe1";ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(width-pad.right,y);ctx.stroke();
    ctx.fillStyle="#75686c";ctx.textAlign="right";ctx.fillText(`${round(v,1)} mm`,pad.left-6,y);
  }
  ctx.strokeStyle="#8f8185";ctx.beginPath();ctx.moveTo(pad.left,pad.top);ctx.lineTo(pad.left,pad.top+h);ctx.lineTo(width-pad.right,pad.top+h);ctx.stroke();
  rows.forEach((r,i)=>{
  const x=pad.left+i*group+group/2;

  draw(x-bar-2,r.etp,"#d98d3d");
  draw(x+2,r.rain,"#4b98c7");

  /*
   * Sur téléphone, on affiche une date sur deux.
   * Sur écran large, on affiche toutes les dates.
   */
  const afficherDate =
    width >= 650 ||
    i % 2 === 0 ||
    i === rows.length - 1;

  if (afficherDate) {
    ctx.fillStyle =
      r.date <= today ? "#57494d" : "#8B1E2D";

    ctx.font =
      width < 450
        ? "8px system-ui"
        : "9px system-ui";

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    const estTelephone =
  window.matchMedia("(max-width: 600px)").matches;

const afficherDate =
  !estTelephone ||
  i % 2 === 0;

if (afficherDate) {
  ctx.fillText(
    new Date(r.date + "T12:00:00")
      .toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit"
      }),
    x,
    height - 14
  );
}
  }
    function draw(bx,v,c){const bh=v/max*h;ctx.fillStyle=c;ctx.fillRect(bx,pad.top+h-bh,bar,bh)}
  });
  const split=rows.findIndex(r=>r.date>today);
  if(split>0){const x=pad.left+split*group;ctx.strokeStyle="#8B1E2D";ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(x,pad.top);ctx.lineTo(x,pad.top+h);ctx.stroke();ctx.setLineDash([])}
}

function useGps(){
  const status=q("#gpsStatus");
  if(!navigator.geolocation){status.textContent="Géolocalisation indisponible.";return}
  status.textContent="Recherche de la position…";
  navigator.geolocation.getCurrentPosition(p=>{
    q("#latitude").value=round(p.coords.latitude,6);q("#longitude").value=round(p.coords.longitude,6);
    status.textContent="Position trouvée. Clique sur Calculer la programmation.";
  },()=>status.textContent="Impossible d’obtenir la position.",{enableHighAccuracy:true,timeout:15000});
}
function setLoading(v){q("#refreshButton").disabled=v;q("#refreshButton").textContent=v?"…":"↻"}
function showError(m){q("#errorMessage").hidden=false;q("#errorMessage").textContent=m}
function hideError(){q("#errorMessage").hidden=true}
function setupInstallPrompt(){window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstallPrompt=e;q("#installCard").hidden=false});window.addEventListener("appinstalled",()=>{deferredInstallPrompt=null;q("#installCard").hidden=true})}
async function installApp(){if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;q("#installCard").hidden=true}
function registerServiceWorker(){if("serviceWorker"in navigator)navigator.serviceWorker.register("./service-worker.js").catch(console.error)}
