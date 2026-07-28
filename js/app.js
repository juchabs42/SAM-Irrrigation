const KC_BY_MONTH={4:.6,5:.6,6:.75,7:.9,8:.9,9:.9,10:.6};
const DEFAULTS={surfaceHa:1,latitude:43.793931,longitude:4.014810,lastIrrigation:localDate(new Date()),rainEfficiency:.8,kcOverride:null,systemType:"drip",rateMode:"known",knownRate:3,emitterFlow:1.6,emitterSpacing:.5,rowSpacing:4,expert:false,rainCorrections:{}};
const STORAGE_KEY="samIrrigationV2";
const WEATHER_CACHE_KEY="samIrrigationWeatherV2";
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
function formatLongDate(s){return new Date(s+"T12:00:00").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}
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
function dailyNetDose(row,kc,efficiency){return Math.max(0,row.etp*kc-row.rain*efficiency)}

function render(cachedAt=null){
  if(!weatherRows.length)return;
  const s=settings(),today=localDate(new Date()),kc=activeKc(s),rate=systemRate(s);
  const past=weatherRows.filter(r=>r.date>s.lastIrrigation&&r.date<=today);
  const etpTotal=sum(past.map(r=>r.etp));
  const etcTotal=etpTotal*kc;
  const rainRaw=sum(past.map(r=>correctedRain(r,s)));
  const rainEffective=rainRaw*number(s.rainEfficiency);
  const currentNeed=Math.max(0,etcTotal-rainEffective);

  const future7=weatherRows.filter(r=>r.date>today).slice(0,7);
  const rain7=sum(future7.map(r=>r.rain));
  const futureEtc7=sum(future7.map(r=>r.etp*kc));
  const futureRainEff7=rain7*number(s.rainEfficiency);
  const need7=Math.max(0,currentNeed+futureEtc7-futureRainEff7);
  const future3=future7.slice(0,3);
  const rain3=sum(future3.map(r=>r.rain));
  const rainFutureEffective=rain3*number(s.rainEfficiency);
  const vpdMax7=Math.max(0,...future7.map(r=>r.vpd));

  const plan=buildIrrigationPlan(s,{today,kc,rate,currentNeed,future7,need7});
  const status=statusForPlan(plan,currentNeed);
  q("#statusCard").className=`card hero status-${status.level}`;
  q("#statusBadge").textContent=status.badge;
  q("#advice").textContent=status.title;
  q("#adviceDetail").textContent=status.detail;
  q("#currentNeed").textContent=`${round(currentNeed,2)} mm`;
  q("#need7d").textContent=`${round(need7,2)} mm`;
  q("#recommendedDose").textContent=`${round(plan.headlineDose,2)} mm`;
  q("#volume").textContent=`${round(plan.headlineVolume,1)} m³`;
  q("#duration").textContent=formatDuration(plan.headlineDuration);
  q("#rain7d").textContent=`${round(rain7,1)} mm`;
  q("#rain3d").textContent=`${round(rain3,1)} mm`;
  q("#effectiveForecastRain").textContent=`${round(rainFutureEffective,1)} mm efficaces`;
  q("#doseLabel").textContent=plan.doseLabel;
  q("#volumeLabel").textContent=plan.volumeLabel;
  q("#durationLabel").textContent=plan.durationLabel;

  q("#etpTotal").textContent=`${round(etpTotal,2)} mm`;
  q("#kcApplied").textContent=kc.toFixed(2);
  q("#etcTotal").textContent=`${round(etcTotal,2)} mm`;
  q("#rainRaw").textContent=`${round(rainRaw,2)} mm`;
  q("#rainEffective").textContent=`${round(rainEffective,2)} mm`;
  q("#systemRate").textContent=`${round(rate,2)} mm/h`;
  q("#vpdMax7d").textContent=`${round(vpdMax7,2)} kPa`;
  q("#updatedAt").textContent=cachedAt?`Cache du ${new Date(cachedAt).toLocaleString("fr-FR")}`:`Mis à jour à ${new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`;

  renderSchedule(plan,s);
  renderCorrections(s,today);
  renderChart();
}

function buildIrrigationPlan(s,ctx){
  const surface=number(s.surfaceHa),eff=number(s.rainEfficiency),rate=ctx.rate;
  if(s.systemType==="drip"){
    const rows=[];
    const todayRow=weatherRows.find(r=>r.date===ctx.today);
    rows.push({date:ctx.today,etp:todayRow?.etp||0,rain:correctedRain(todayRow||{date:ctx.today,rain:0},s),dose:ctx.currentNeed});
    ctx.future7.slice(0,6).forEach(r=>rows.push({date:r.date,etp:r.etp,rain:r.rain,dose:dailyNetDose(r,ctx.kc,eff)}));
    rows.forEach(r=>{r.volume=r.dose*surface*10;r.duration=rate>0?r.dose/rate:0});
    return{
      type:"drip",title:"Programme quotidien — goutte-à-goutte",systemLabel:"Quotidien",
      intro:"Une dose est proposée pour chaque jour. La pluie efficace réduit la dose ; si elle couvre l’ETc du jour, aucune irrigation n’est proposée.",
      rows,
      headlineDose:rows[0]?.dose||0,headlineVolume:rows[0]?.volume||0,headlineDuration:rows[0]?.duration||0,
      doseLabel:"Dose conseillée aujourd’hui",volumeLabel:"Volume aujourd’hui",durationLabel:"Durée aujourd’hui"
    };
  }

  const weeklyDose=ctx.need7;
  if(s.systemType==="micro"){
    if(weeklyDose>20){
      const dose1=weeklyDose/2,dose2=weeklyDose-dose1;
      const date2=ctx.future7[3]?.date||ctx.future7[Math.floor(ctx.future7.length/2)]?.date||ctx.today;
      const rows=[
        {date:ctx.today,dose:dose1,volume:dose1*surface*10,duration:rate>0?dose1/rate:0,label:"Apport 1"},
        {date:date2,dose:dose2,volume:dose2*surface*10,duration:rate>0?dose2/rate:0,label:"Apport 2"}
      ];
      return{type:"micro",title:"Programme hebdomadaire — micro-aspersion",systemLabel:"2 apports",intro:`Le besoin hebdomadaire dépasse 20 mm : il est fractionné en deux apports d’environ ${round(dose1,1)} mm.`,rows,headlineDose:dose1,headlineVolume:rows[0].volume,headlineDuration:rows[0].duration,doseLabel:"Dose par apport",volumeLabel:"Volume par apport",durationLabel:"Durée par apport"};
    }
    const row={date:ctx.today,dose:weeklyDose,volume:weeklyDose*surface*10,duration:rate>0?weeklyDose/rate:0,label:"Apport hebdomadaire"};
    return{type:"micro",title:"Programme hebdomadaire — micro-aspersion",systemLabel:"1 apport",intro:"Un apport unique couvre le besoin net prévu sur 7 jours.",rows:[row],headlineDose:row.dose,headlineVolume:row.volume,headlineDuration:row.duration,doseLabel:"Dose hebdomadaire",volumeLabel:"Volume hebdomadaire",durationLabel:"Durée hebdomadaire"};
  }

  const row={date:ctx.today,dose:weeklyDose,volume:weeklyDose*surface*10,duration:rate>0?weeklyDose/rate:0,label:"Apport hebdomadaire"};
  return{type:"sprinkler",title:"Programme hebdomadaire — aspersion",systemLabel:"1 apport",intro:"Un apport unique est calculé pour couvrir le besoin net prévu sur 7 jours.",rows:[row],headlineDose:row.dose,headlineVolume:row.volume,headlineDuration:row.duration,doseLabel:"Dose hebdomadaire",volumeLabel:"Volume hebdomadaire",durationLabel:"Durée hebdomadaire"};
}

function statusForPlan(plan,current){
  const total=sum(plan.rows.map(r=>r.dose));
  if(total<=.01)return{level:"green",badge:"0 mm",title:"Pas d’irrigation à prévoir",detail:"La pluie efficace couvre les besoins calculés sur l’horizon proposé."};
  if(plan.type==="drip")return{level:plan.headlineDose>6?"red":plan.headlineDose>3?"orange":"yellow",badge:"Quotidien",title:"Programme quotidien disponible",detail:`Dose conseillée aujourd’hui : ${round(plan.headlineDose,1)} mm. Consulte le détail des 7 jours ci-dessous.`};
  if(plan.type==="micro"&&plan.rows.length===2)return{level:"orange",badge:"Fractionner",title:"Deux apports recommandés",detail:`Besoin net à 7 jours : ${round(total,1)} mm, réparti en deux apports.`};
  return{level:total>20?"red":total>6?"orange":"yellow",badge:"Hebdomadaire",title:"Un apport hebdomadaire est recommandé",detail:`Besoin net à 7 jours : ${round(total,1)} mm.`};
}

function renderSchedule(plan,s){
  q("#scheduleTitle").textContent=plan.title;
  q("#scheduleSystem").textContent=plan.systemLabel;
  q("#scheduleIntro").textContent=plan.intro;
  const box=q("#irrigationSchedule");box.innerHTML="";
  plan.rows.forEach((r,i)=>{
    const row=document.createElement("div");
    row.className=`schedule-row ${i===0?"today":""} ${r.dose<=.01?"no-irrigation":""}`;
    if(plan.type==="drip"){
      const effectiveRain=r.rain*number(s.rainEfficiency);
      row.innerHTML=`<strong>${formatLongDate(r.date)}</strong><span>ETP ${round(r.etp,1)} mm</span><span>Pluie eff. ${round(effectiveRain,1)} mm</span><span>Dose ${round(r.dose,1)} mm</span><span>${round(r.volume,1)} m³ · ${formatDuration(r.duration)}</span>`;
    }else{
      row.innerHTML=`<strong>${r.label} — ${formatLongDate(r.date)}</strong><span>Dose ${round(r.dose,1)} mm</span><span>Volume ${round(r.volume,1)} m³</span><span>Durée ${formatDuration(r.duration)}</span><span></span>`;
    }
    box.appendChild(row);
  });
}

function renderCorrections(s,today){const box=q("#rainCorrectionList");box.innerHTML="";weatherRows.filter(r=>r.date<=today).slice(-7).forEach(r=>{const row=document.createElement("div");row.className="correction-row";const correction=s.rainCorrections?.[r.date];row.innerHTML=`<strong>${formatDate(r.date)}</strong><span>Open-Meteo : ${round(r.rain,1)} mm</span><input type="number" min="0" step="0.1" placeholder="Pluie corrigée" data-rain-date="${r.date}" value="${correction===undefined?"":correction}">`;box.appendChild(row)})}

function renderChart(){
  const canvas=q("#weatherChart"),ctx=canvas.getContext("2d"),ratio=window.devicePixelRatio||1,width=canvas.clientWidth||800,height=270;
  canvas.width=width*ratio;canvas.height=height*ratio;ctx.scale(ratio,ratio);ctx.clearRect(0,0,width,height);
  const today=localDate(new Date()),rows=[...weatherRows.filter(r=>r.date<=today).slice(-7),...weatherRows.filter(r=>r.date>today).slice(0,7)];if(!rows.length)return;
  const pad={left:48,right:12,top:20,bottom:42},w=width-pad.left-pad.right,h=height-pad.top-pad.bottom,max=Math.ceil(Math.max(1,...rows.flatMap(r=>[r.etp,r.rain]))),group=w/rows.length,bar=Math.min(13,group*.25);
  ctx.font="10px system-ui";ctx.textBaseline="middle";
  for(let i=0;i<=4;i++){const y=pad.top+h*i/4,v=max*(1-i/4);ctx.strokeStyle="#e7dfe1";ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(width-pad.right,y);ctx.stroke();ctx.fillStyle="#75686c";ctx.textAlign="right";ctx.fillText(`${round(v,1)} mm`,pad.left-6,y)}
  ctx.strokeStyle="#8f8185";ctx.beginPath();ctx.moveTo(pad.left,pad.top);ctx.lineTo(pad.left,pad.top+h);ctx.lineTo(width-pad.right,pad.top+h);ctx.stroke();
  rows.forEach((r,i)=>{const x=pad.left+i*group+group/2;drawBar(x-bar-2,r.etp,"#d98d3d");drawBar(x+2,r.rain,"#4b98c7");ctx.fillStyle=r.date<=today?"#57494d":"#8B1E2D";ctx.font="9px system-ui";ctx.textAlign="center";ctx.textBaseline="alphabetic";ctx.fillText(new Date(r.date+"T12:00:00").toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit"}),x,height-14);function drawBar(bx,v,c){const bh=v/max*h;ctx.fillStyle=c;ctx.fillRect(bx,pad.top+h-bh,bar,bh)}});
  const split=rows.findIndex(r=>r.date>today);if(split>0){const sx=pad.left+split*group;ctx.strokeStyle="#8B1E2D";ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(sx,pad.top);ctx.lineTo(sx,pad.top+h);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle="#8B1E2D";ctx.font="10px system-ui";ctx.textAlign="left";ctx.fillText("Prévisions",sx+5,pad.top+10)}
}

function useGps(){const status=q("#gpsStatus");if(!navigator.geolocation){status.textContent="Géolocalisation indisponible.";return}status.textContent="Recherche de la position…";navigator.geolocation.getCurrentPosition(pos=>{q("#latitude").value=round(pos.coords.latitude,6);q("#longitude").value=round(pos.coords.longitude,6);status.textContent="Position trouvée. Clique sur Enregistrer."},()=>status.textContent="Impossible d’obtenir la position.",{enableHighAccuracy:true,timeout:15000})}
function setLoading(v){q("#refreshButton").disabled=v;q("#refreshButton").textContent=v?"…":"↻"}
function showError(m){q("#errorMessage").hidden=false;q("#errorMessage").textContent=m}
function hideError(){q("#errorMessage").hidden=true}
function setupInstallPrompt(){window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstallPrompt=e;q("#installCard").hidden=false});window.addEventListener("appinstalled",()=>{deferredInstallPrompt=null;q("#installCard").hidden=true})}
async function installApp(){if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;q("#installCard").hidden=true}
function registerServiceWorker(){if("serviceWorker"in navigator)navigator.serviceWorker.register("./service-worker.js").catch(console.error)}
