
const KC_BY_MONTH={4:.6,5:.6,6:.75,7:.9,8:.9,9:.9,10:.6};

const DEFAULTS={
  surfaceHa:1,
  latitude:43.793931,
  longitude:4.014810,
  lastIrrigation:localDate(new Date()),
  programStart:localDate(new Date()),
  programDays:7,
  frequency:"daily",
  rainEfficiency:25,
  rainAutoSystem:null,
  kcOverride:null,
  systemType:"drip",
  rateMode:"known",
  knownRate:3,
  emitterFlow:1.6,
  emitterSpacing:.5,
  rowSpacing:4
};

const STORAGE_KEY="samIrrigationPeriodV1";
const WEATHER_CACHE_KEY="samIrrigationPeriodWeatherV1";

let weatherRows=[];
let deferredInstallPrompt=null;

document.addEventListener("DOMContentLoaded",()=>{
  bindEvents();
  setupInstallPrompt();
  loadForm();
  updatePeriodPreview();
  refreshWeather();
  registerServiceWorker();
});

function q(selector){return document.querySelector(selector)}
function val(id){return q("#"+id).value}
function num(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback}
function round(value,decimals=2){const factor=10**decimals;return Math.round((num(value)+Number.EPSILON)*factor)/factor}
function sum(values){return values.reduce((total,value)=>total+num(value),0)}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms))}

function localDate(date){
  const parts=new Intl.DateTimeFormat("fr-CA",{
    timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(date);
  const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return`${map.year}-${map.month}-${map.day}`;
}

function addDays(dateString,days){
  const date=new Date(dateString+"T12:00:00");
  date.setDate(date.getDate()+days);
  return localDate(date);
}

function formatLongDate(dateString){
  return new Date(dateString+"T12:00:00").toLocaleDateString("fr-FR",{
    day:"2-digit",month:"2-digit",year:"numeric"
  });
}

function formatShortDate(dateString){
  return new Date(dateString+"T12:00:00").toLocaleDateString("fr-FR",{
    day:"2-digit",month:"2-digit"
  });
}

function formatDuration(hours){
  if(!Number.isFinite(hours)||hours<=0)return"0 h 00";
  const totalMinutes=Math.round(hours*60);
  return`${Math.floor(totalMinutes/60)} h ${String(totalMinutes%60).padStart(2,"0")}`;
}

function settings(){
  try{return{...DEFAULTS,...JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}")}}
  catch{return{...DEFAULTS}}
}

function persist(settingsValue){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(settingsValue));
}

function rainEfficiencyCoefficient(settingsValue){
  const stored=num(settingsValue.rainEfficiency,80);
  return stored>1?stored/100:stored;
}

function monthlyKc(dateString){
  const month=new Date(dateString+"T12:00:00").getMonth()+1;
  return KC_BY_MONTH[month]??0;
}

function kcForDate(dateString,settingsValue){
  if(settingsValue.kcOverride!==null&&settingsValue.kcOverride!==""){
    return num(settingsValue.kcOverride);
  }
  return monthlyKc(dateString);
}

function rainRecommendationForSystem(systemType){
switch(systemType){

    case "micro":
      return{
        percent:60,
        message:"Valeur recommandée pour la part de pluie en micro-aspersion : 60 %."
      };

    case "sprinkler":
      return{
        percent:90,
        message:"Valeur recommandée pour la part de pluie en aspersion : 90 %."
      };

    case "drip":
    default:
      return{
        percent:25,
        message:"Valeur recommandée pour la part de pluie en goutte-à-goutte : 25 %."
      };

  }

}

function updateRainRecommendation(applyValue=false){
  const systemType=val("systemType")||"drip";
  const recommendation=rainRecommendationForSystem(systemType);

  if(applyValue){
    q("#rainEfficiency").value=recommendation.percent;
  }

  const help=q("#rainHelp");
  if(help){
    help.textContent=recommendation.message;
  }
}

function bindEvents(){
  q("#refreshButton").addEventListener("click",refreshWeather);
  q("#gpsButton").addEventListener("click",useGps);
  q("#calculateButton").addEventListener("click",saveMainAndCalculate);
  q("#resetKcButton").addEventListener("click",resetKc);
  q("#rateMode").addEventListener("change",toggleRateFields);
  q("#systemType").addEventListener("change",()=>updateRainRecommendation(true));
  q("#programStart").addEventListener("change",updatePeriodPreview);
  q("#programDays").addEventListener("change",updatePeriodPreview);
  q("#installButton").addEventListener("click",installApp);
  window.addEventListener("resize",()=>weatherRows.length&&renderChart());
}

function loadForm(){
  const s=settings();

  [
    "surfaceHa","latitude","longitude","lastIrrigation","programStart",
    "programDays","frequency","systemType","rateMode",
    "knownRate","emitterFlow","emitterSpacing","rowSpacing"
  ].forEach(id=>q("#"+id).value=s[id]);

  const rainEfficiencyPercent =
    num(s.rainEfficiency,80) <= 1
      ? num(s.rainEfficiency,0.8) * 100
      : num(s.rainEfficiency,80);

  if(s.rainAutoSystem===null){
    const recommendation=rainRecommendationForSystem(s.systemType);
    s.rainEfficiency=recommendation.percent;
    s.rainAutoSystem=s.systemType;
    persist(s);
    q("#rainEfficiency").value=recommendation.percent;
  }else{
    q("#rainEfficiency").value=round(rainEfficiencyPercent,0);
  }

  q("#kcValue").value=s.kcOverride===null?"":s.kcOverride;
  updateKcInfo();
  updateRainRecommendation(false);
  toggleRateFields();
}

function updatePeriodPreview(){
  const start=val("programStart")||localDate(new Date());
  const days=Math.max(1,num(val("programDays"),7));
  const end=addDays(start,days-1);

  q("#periodPreview").innerHTML=
    `<strong>Période calculée :</strong> du ${formatLongDate(start)} au ${formatLongDate(end)} inclus`;
}

function saveMainAndCalculate(){
  const s=settings();

  s.surfaceHa=num(val("surfaceHa"),1);
  s.latitude=num(val("latitude"),DEFAULTS.latitude);
  s.longitude=num(val("longitude"),DEFAULTS.longitude);
  s.lastIrrigation=val("lastIrrigation");
  s.programStart=val("programStart");
  s.programDays=num(val("programDays"),7);
  s.frequency=val("frequency");
  s.rainEfficiency=num(val("rainEfficiency"),80);
  s.kcOverride=val("kcValue")===""?null:num(val("kcValue"));
  s.systemType=val("systemType");
  s.rainAutoSystem=s.systemType;
  s.rateMode=val("rateMode");
  s.knownRate=num(val("knownRate"),3);
  s.emitterFlow=num(val("emitterFlow"),1.6);
  s.emitterSpacing=num(val("emitterSpacing"),.5);
  s.rowSpacing=num(val("rowSpacing"),4);

  persist(s);
  updatePeriodPreview();
  refreshWeather();
}


function resetKc(){
  const s=settings();
  s.kcOverride=null;
  persist(s);
  q("#kcValue").value="";
  updateKcInfo();
  render();
}

function updateKcInfo(){
  const s=settings();

  if(s.kcOverride!==null&&s.kcOverride!==""){
    q("#kcInfo").textContent=`Kc personnalisé appliqué à toute la période : ${num(s.kcOverride).toFixed(2)}.`;
    return;
  }

q("#kcInfo").innerHTML =
`Kc mensuels automatiques :
<br>
Avril 0,60 · Mai 0,60 · Juin 0,75 · Juillet 0,90 · Août 0,90 · Septembre 0,90 · Octobre 0,60
`;
}



function toggleRateFields(){
  const calculated=val("rateMode")==="calculated";
  q("#knownRateLabel").hidden=calculated;
  q("#emitterFlowLabel").hidden=!calculated;
  q("#emitterSpacingLabel").hidden=!calculated;
  q("#rowSpacingLabel").hidden=!calculated;
}

async function refreshWeather(){
  setLoading(true);
  hideError();

  const s=settings();

  try{
    const variables=["et0_fao_evapotranspiration","precipitation_sum"].join(",");
    const url=new URL("https://api.open-meteo.com/v1/forecast");

    url.search=new URLSearchParams({
      latitude:s.latitude,
      longitude:s.longitude,
      daily:variables,
      timezone:"Europe/Paris",
      past_days:"15",
      forecast_days:"16"
    }).toString();

    let response=await fetch(url,{cache:"no-store"});

    if(!response.ok){
      await wait(1000);
      response=await fetch(url,{cache:"no-store"});
    }

    if(!response.ok){
      throw new Error(`Open-Meteo répond ${response.status}.`);
    }

    const data=await response.json();

    weatherRows=data.daily.time.map((date,index)=>({
      date,
      etp:num(data.daily.et0_fao_evapotranspiration[index]),
      rain:num(data.daily.precipitation_sum[index])
    }));

    localStorage.setItem(WEATHER_CACHE_KEY,JSON.stringify({
      savedAt:new Date().toISOString(),
      rows:weatherRows
    }));

    updateDateLimits();
    render();
  }catch(error){
    const cached=JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY)||"null");

    if(cached?.rows?.length){
      weatherRows=cached.rows;
      updateDateLimits();
      showError("Données hors connexion : dernière météo enregistrée utilisée.");
      render(cached.savedAt);
    }else{
      showError("Impossible de récupérer la météo. "+error.message);
    }
  }finally{
    setLoading(false);
  }
}

function updateDateLimits(){
  if(!weatherRows.length)return;

  q("#programStart").min=weatherRows[0].date;
  q("#programStart").max=weatherRows[weatherRows.length-1].date;
  q("#lastIrrigation").min=weatherRows[0].date;
  q("#lastIrrigation").max=weatherRows[weatherRows.length-1].date;
}

function systemRate(s){
  if(s.rateMode==="calculated"){
    const denominator=num(s.emitterSpacing)*num(s.rowSpacing);
    return denominator>0?num(s.emitterFlow)/denominator:0;
  }

  return num(s.knownRate);
}

function numberOfApplications(frequency,days){
  switch(frequency){
    case"daily":
      return days;
    case"every2":
      return Math.ceil(days/2);
    case"twiceWeekly":
      return Math.max(1,Math.ceil(days*2/7));
    case"weekly":
      return Math.max(1,Math.ceil(days/7));
    default:
      return days;
  }
}

function rowsBetween(start,end){
  return weatherRows.filter(row=>row.date>=start&&row.date<=end);
}

function render(cachedAt=null){
  if(!weatherRows.length)return;

  const s=settings();
  const start=s.programStart;
  const days=Math.max(1,num(s.programDays,7));
  const end=addDays(start,days-1);
  const dayBeforeStart=addDays(start,-1);

  if(s.lastIrrigation>dayBeforeStart){
    showError("Le dernier arrosage doit être antérieur à la date de début de programmation.");
    return;
  }

  const availableStart=weatherRows[0].date;
  const availableEnd=weatherRows[weatherRows.length-1].date;

  if(s.lastIrrigation<availableStart||end>availableEnd){
    showError(
      `La période choisie dépasse les données disponibles (${formatLongDate(availableStart)} au ${formatLongDate(availableEnd)}).`
    );
    return;
  }

  hideError();

  const deficitRows=rowsBetween(addDays(s.lastIrrigation,1),dayBeforeStart);
  const periodRows=rowsBetween(start,end);

  if(periodRows.length!==days){
    showError("Toutes les journées de la période choisie ne sont pas disponibles.");
    return;
  }

  const pastEtc=sum(deficitRows.map(row=>row.etp*kcForDate(row.date,s)));
  const pastEffectiveRain=sum(deficitRows.map(row=>row.rain))*rainEfficiencyCoefficient(s);
  const pastDeficit=Math.max(0,pastEtc-pastEffectiveRain);

  const periodGross=sum(periodRows.map(row=>row.etp*kcForDate(row.date,s)));
  const periodRain=sum(periodRows.map(row=>row.rain));
  const periodEffectiveRain=periodRain*rainEfficiencyCoefficient(s);
  const periodNet=Math.max(0,periodGross-periodEffectiveRain);

  const totalNeed=pastDeficit+periodNet;
  const count=numberOfApplications(s.frequency,days);
  const dose=totalNeed/count;
  const volume=dose*num(s.surfaceHa)*10;
  const rate=systemRate(s);
  const duration=rate>0?dose/rate:0;

  q("#resultPeriod").textContent=
    `Du ${formatLongDate(start)} au ${formatLongDate(end)} inclus`;

  q("#totalNeed").textContent=`${round(totalNeed,2)} mm`;
  q("#applicationCount").textContent=String(count);
  q("#dosePerApplication").textContent=`${round(dose,2)} mm`;
  q("#volumePerApplication").textContent=`${round(volume,1)} m³`;
  q("#durationPerApplication").textContent=formatDuration(duration);

  q("#pastDeficit").textContent=`${round(pastDeficit,2)} mm`;
  q("#periodGrossNeed").textContent=`${round(periodGross,2)} mm`;
  q("#periodRain").textContent=`${round(periodRain,2)} mm`;
  q("#periodEffectiveRain").textContent=`${round(periodEffectiveRain,2)} mm`;
  q("#periodNetNeed").textContent=`${round(periodNet,2)} mm`;

  q("#updatedAt").textContent=cachedAt
    ?`Données enregistrées le ${new Date(cachedAt).toLocaleString("fr-FR")}`
    :`Météo actualisée à ${new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`;

  renderChart();
}

function renderChart(){
  const canvas=q("#weatherChart");
  const context=canvas.getContext("2d");
  const ratio=window.devicePixelRatio||1;
  const width=canvas.clientWidth||800;
  const height=270;

  canvas.width=width*ratio;
  canvas.height=height*ratio;
  context.scale(ratio,ratio);
  context.clearRect(0,0,width,height);

  const s=settings();
  const periodStart=s.programStart;
  const periodEnd=addDays(periodStart,Math.max(1,num(s.programDays,7))-1);
  const chartStart=addDays(periodStart,-7);

  const rows=weatherRows.filter(row=>row.date>=chartStart&&row.date<=periodEnd);

  if(!rows.length)return;

  const padding={left:48,right:12,top:20,bottom:42};
  const chartWidth=width-padding.left-padding.right;
  const chartHeight=height-padding.top-padding.bottom;
  const maximum=Math.ceil(Math.max(1,...rows.flatMap(row=>[row.etp,row.rain])));
  const groupWidth=chartWidth/rows.length;
  const barWidth=Math.min(13,groupWidth*.25);

  context.font="10px system-ui";
  context.textBaseline="middle";

  for(let index=0;index<=4;index++){
    const y=padding.top+chartHeight*index/4;
    const value=maximum*(1-index/4);

    context.strokeStyle="#e7dfe1";
    context.beginPath();
    context.moveTo(padding.left,y);
    context.lineTo(width-padding.right,y);
    context.stroke();

    context.fillStyle="#75686c";
    context.textAlign="right";
    context.fillText(`${round(value,1)} mm`,padding.left-6,y);
  }

  context.strokeStyle="#8f8185";
  context.beginPath();
  context.moveTo(padding.left,padding.top);
  context.lineTo(padding.left,padding.top+chartHeight);
  context.lineTo(width-padding.right,padding.top+chartHeight);
  context.stroke();

  const labelStep=width<500
    ?Math.max(1,Math.ceil(rows.length/7))
    :width<700
      ?Math.max(1,Math.ceil(rows.length/10))
      :1;

  rows.forEach((row,index)=>{
    const x=padding.left+index*groupWidth+groupWidth/2;

    drawBar(x-barWidth-2,row.etp,"#d98d3d");
    drawBar(x+2,row.rain,"#4b98c7");

    if(index%labelStep===0){
      context.fillStyle=row.date<=localDate(new Date())?"#57494d":"#8B1E2D";
      context.font=width<500?"8px system-ui":"9px system-ui";
      context.textAlign="center";
      context.textBaseline="alphabetic";
      context.fillText(formatShortDate(row.date),x,height-14);
    }

    function drawBar(barX,value,color){
      const barHeight=value/maximum*chartHeight;
      context.fillStyle=color;
      context.fillRect(
        barX,
        padding.top+chartHeight-barHeight,
        barWidth,
        barHeight
      );
    }
  });

  const today=localDate(new Date());
  const forecastIndex=rows.findIndex(row=>row.date>today);

  if(forecastIndex>0){
    const x=padding.left+forecastIndex*groupWidth;
    context.strokeStyle="#8B1E2D";
    context.setLineDash([5,4]);
    context.beginPath();
    context.moveTo(x,padding.top);
    context.lineTo(x,padding.top+chartHeight);
    context.stroke();
    context.setLineDash([]);
  }
}

function useGps(){
  const status=q("#gpsStatus");

  if(!navigator.geolocation){
    status.textContent="Géolocalisation indisponible.";
    return;
  }

  status.textContent="Recherche de la position…";

  navigator.geolocation.getCurrentPosition(
    position=>{
      q("#latitude").value=round(position.coords.latitude,6);
      q("#longitude").value=round(position.coords.longitude,6);
      status.textContent="Position mise à jour.";
    },
    ()=>status.textContent="Impossible d’obtenir la position.",
    {enableHighAccuracy:true,timeout:15000}
  );
}

function setLoading(loading){
  q("#refreshButton").disabled=loading;
  q("#refreshButton").textContent=loading?"…":"↻";
}

function showError(message){
  q("#errorMessage").hidden=false;
  q("#errorMessage").textContent=message;
}

function hideError(){
  q("#errorMessage").hidden=true;
}

function setupInstallPrompt(){
  window.addEventListener("beforeinstallprompt",event=>{
    event.preventDefault();
    deferredInstallPrompt=event;
    q("#installCard").hidden=false;
  });

  window.addEventListener("appinstalled",()=>{
    deferredInstallPrompt=null;
    q("#installCard").hidden=true;
  });
}

async function installApp(){
  if(!deferredInstallPrompt)return;

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt=null;
  q("#installCard").hidden=true;
}

function registerServiceWorker(){
  if("serviceWorker"in navigator){
    navigator.serviceWorker.register("./service-worker.js").catch(console.error);
  }
}
