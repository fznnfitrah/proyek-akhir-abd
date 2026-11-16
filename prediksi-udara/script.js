/* ===== PENGATURAN: sesuaikan dengan model Anda ===== */
const CONFIG={
  ENDPOINT:"/api",   // alamat server Python (server/app.py). Isi null untuk mode demo tanpa server
  MODEL_URL:{},    // opsi 2: model JSON per daerah, mis. {jakarta:"models/jakarta.json"} (format: lihat rfPredict)
  AMBANG:{sedang:35.5,berat:75}, // batas kelas dalam µg/m³ (CONTOH: ganti dengan ambang yang Anda pakai)
  // Nama variabel Open-Meteo, URUTANNYA HARUS SAMA dengan urutan kolom saat training model
  FITUR:["temperature_2m","relative_humidity_2m","precipitation","wind_speed_10m","surface_pressure"],
  // Versi gratis (non-komersial) tidak memerlukan KEY. Isi KEY hanya jika punya paket berbayar.
  OPENMETEO_BASE:"https://api.open-meteo.com",   // paket berbayar: "https://customer-api.open-meteo.com", atau URL proxy Anda
  OPENMETEO_KEY:null
};
const DAERAH=[
  {id:"jakarta",nama:"Jakarta",lat:-6.2,lon:106.85,dy:-14},
  {id:"depok",nama:"Depok",lat:-6.4,lon:106.82,dy:26},   // tambahkan model:"bogor" bila nama model berbeda
  {id:"malang",nama:"Malang",lat:-7.98,lon:112.63,dy:-14}
];
// Vektor masukan model, urutannya mengikuti CONFIG.FITUR
const fitur=c=>CONFIG.FITUR.map(k=>c[k]);

/* ===== Model ===== */
// Random forest hasil ekspor: {trees:[{l:[kiri],r:[kanan],f:[fitur],t:[ambang],v:[nilai daun]}]}; daun ditandai l[i] = -1
function rfPredict(m,x){let s=0;for(const t of m.trees){let i=0;while(t.l[i]!==-1)i=x[t.f[i]]<=t.t[i]?t.l[i]:t.r[i];s+=t.v[i]}return s/m.trees.length}
const cache={};
async function hitung(d,c){
  const u=CONFIG.MODEL_URL[d.id];
  if(u){cache[u]??=fetch(u).then(r=>r.json());return{nilai:rfPredict(await cache[u],fitur(c)),demo:false}}
  // Mode demo: rumus sederhana sementara, BUKAN model Anda
  return{nilai:Math.min(120,Math.max(5,25+(c.relative_humidity_2m-70)*.4-c.wind_speed_10m*1.2-c.precipitation*4)),demo:true};
}
const kelas=n=>n<CONFIG.AMBANG.sedang?"ringan":n<CONFIG.AMBANG.berat?"sedang":"berat";
const KLS={ringan:"Ringan",sedang:"Sedang",berat:"Berat"};
const DESK={ringan:"Udara relatif bersih. Aman untuk beraktivitas di luar ruangan.",
  sedang:"Kelompok sensitif sebaiknya mengurangi aktivitas berat di luar ruangan.",
  berat:"Kurangi aktivitas di luar ruangan dan pertimbangkan memakai masker."};
const MAX=Math.max(120,CONFIG.AMBANG.berat*1.6);
async function cuaca(d){
  // variabel untuk model + variabel yang ditampilkan di kartu cuaca
  const vars=[...new Set([...CONFIG.FITUR,"temperature_2m","relative_humidity_2m","wind_speed_10m","precipitation"])].join(",");
  let url=`${CONFIG.OPENMETEO_BASE}/v1/forecast?latitude=${d.lat}&longitude=${d.lon}&current=${vars}&timezone=Asia%2FJakarta`;
  if(CONFIG.OPENMETEO_KEY)url+=`&apikey=${CONFIG.OPENMETEO_KEY}`;
  const r=await fetch(url);
  if(!r.ok)throw new Error("Open-Meteo "+r.status);
  return (await r.json()).current;
}

/* ===== Peta ===== */
const $=s=>document.querySelector(s),svg=$("#svg"),stage=$("#stage"),panel=$("#panel");
const f=n=>n.toLocaleString("id-ID",{maximumFractionDigits:1});
const px=lon=>(lon-105)*100,py=lat=>(-5.6-lat)*100,FULL=[-10,-10,1000,350];
const path=P=>"M"+P.map(p=>px(p[0])+" "+py(p[1])).join("L")+"Z";
const JAWA=[[105.2,-6.8],[105.35,-6.2],[106,-5.9],[106.45,-6],[106.8,-6.1],[107.3,-5.95],[107.9,-6.2],[108.3,-6.3],[108.6,-6.75],[109.1,-6.85],[109.7,-6.85],[110.4,-6.95],[110.7,-6.5],[111.4,-6.7],[112,-6.9],[112.6,-7.15],[112.75,-7.25],[113.2,-7.7],[114,-7.75],[114.4,-8.2],[114.45,-8.7],[114,-8.7],[113.4,-8.4],[112.6,-8.4],[111.8,-8.3],[111.1,-8.25],[110.6,-8.2],[110.1,-8],[109.5,-7.75],[108.9,-7.7],[108.4,-7.75],[107.7,-7.45],[107,-7.4],[106.5,-7.35],[106.3,-7],[105.7,-6.8]];
const MADURA=[[112.75,-7.05],[113.3,-6.9],[113.9,-7],[114.15,-7.12],[113.6,-7.22],[112.95,-7.15]];
const NS="http://www.w3.org/2000/svg";
const el=(t,a={},p=svg)=>{const e=document.createElementNS(NS,t);for(const k in a)e.setAttribute(k,a[k]);p.append(e);return e};
svg.innerHTML='<defs><linearGradient id="landg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="s1"/><stop offset="1" class="s2"/></linearGradient></defs>';
let g="";for(let lo=105;lo<=115;lo++)g+=`M${px(lo)} -10V340`;for(let la=-6;la>=-9;la--)g+=`M-10 ${py(la)}H990`;
el("path",{class:"grat",d:g});
el("path",{class:"land",d:path(JAWA)});el("path",{class:"land",d:path(MADURA)});
const jw=el("text",{class:"jawa",x:px(109.6),y:py(-7.6)});jw.textContent="Pulau Jawa";
const M=DAERAH.map((d,i)=>{
  const gr=el("g",{class:"mk",tabindex:0,role:"button","aria-label":"Buka "+d.nama});
  const ring=el("circle",{class:"ring",cx:px(d.lon),cy:py(d.lat)},gr),c=el("circle",{class:"dot",cx:px(d.lon),cy:py(d.lat)},gr),t=el("text",{x:px(d.lon)},gr);
  t.textContent=d.nama;
  gr.onclick=()=>pilih(i);
  gr.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();pilih(i)}};
  return{gr,ring,c,t,d};
});
const tabs=DAERAH.map((d,i)=>{const b=document.createElement("button");b.textContent=d.nama;b.onclick=()=>pilih(i);$("#tabs").append(b);return b});
const tandai=()=>tabs.forEach((b,i)=>b.setAttribute("aria-current",i===cur));

let cur=-1,vb=FULL.slice(),raf;
function apply(){
  svg.setAttribute("viewBox",vb.join(" "));
  const k=vb[2]/1000;
  jw.style.fontSize=26*k+"px";jw.style.opacity=cur<0?.6:0;
  M.forEach(({ring,c,t,d})=>{
    c.setAttribute("r",7*k);c.style.strokeWidth=2.5*k+"px";
    ring.setAttribute("r",7*k);ring.style.strokeWidth=2*k+"px";
    t.style.fontSize=14*k+"px";t.style.strokeWidth=4*k+"px";t.setAttribute("y",py(d.lat)+d.dy*k);
  });
}
function goVB(to){
  cancelAnimationFrame(raf);
  const from=vb.slice(),t0=performance.now(),ms=matchMedia("(prefers-reduced-motion: reduce)").matches?1:850;
  const step=n=>{let p=Math.min(1,(n-t0)/ms);p=p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;vb=from.map((v,i)=>v+(to[i]-v)*p);apply();if(p<1)raf=requestAnimationFrame(step)};
  raf=requestAnimationFrame(step);
}
const box=i=>{const d=DAERAH[i],w=140,h=w*.35;return[px(d.lon)-w/2,py(d.lat)-h/2,w,h]};
function pilih(i){cur=i;stage.classList.add("zoomed");tandai();goVB(box(i));render()}
const geser=n=>pilih((cur+n+DAERAH.length)%DAERAH.length);
function kembali(){cur=-1;stage.classList.remove("zoomed");tandai();goVB(FULL)}
$("#prev").onclick=()=>geser(-1);$("#next").onclick=()=>geser(1);
addEventListener("keydown",e=>{if(cur<0)return;if(e.key==="ArrowLeft")geser(-1);if(e.key==="ArrowRight")geser(1);if(e.key==="Escape")kembali()});
panel.onclick=e=>{if(e.target.id==="back")kembali();if(e.target.id==="ulang")muat(cur)};
$("#summary").onclick=e=>{const b=e.target.closest(".sum");if(b)pilih(+b.dataset.i)};

/* ===== Data per daerah ===== */
const S=DAERAH.map(()=>({status:"muat"}));
async function muat(i){
  const d=DAERAH[i],s=S[i];s.status="muat";ringkas();if(cur===i)render();
  try{
    if(CONFIG.ENDPOINT){   // server Python: cuaca, model, dan kelas dihitung di server
      const r=await fetch(`${CONFIG.ENDPOINT}/prediksi/${d.id}`);
      if(!r.ok)throw new Error("server "+r.status);
      const j=await r.json();
      Object.assign(s,{c:j.cuaca,nilai:j.nilai,kelas:j.kelas,demo:false,status:"ok"});
    }else{
      const c=await cuaca(d),h=await hitung(d,c);
      Object.assign(s,h,{c,kelas:kelas(h.nilai),status:"ok"});
    }
    M[i].gr.style.setProperty("--k",`var(--${s.kelas})`);
  }catch(e){s.status="gagal";s.err=e.message}
  ringkas();if(cur===i)render();
}
const IC={
  suhu:'<path d="M10 4a2 2 0 0 1 4 0v9.2a4 4 0 1 1-4 0z"/>',
  lembap:'<path d="M12 3s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.2 12 3 12 3z"/>',
  angin:'<path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7"/>',
  hujan:'<path d="M7 15a4.5 4.5 0 1 1 1.4-8.8A5.5 5.5 0 0 1 19 8.5 3.3 3.3 0 0 1 18 15zM9 18l-1 3M13 18l-1 3M17 18l-1 3"/>'
};
const tile=(k,l,v)=>`<div class="tile"><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg></span><div><small>${l}</small><b>${v}</b></div></div>`;
const warna=k=>`--k:var(--${k});--kb:var(--${k}-bg)`;
function render(){
  const d=DAERAH[cur],s=S[cur];
  const foot=t=>`<div class="foot"><span>${t||""}</span><button class="back" id="back">Lihat peta Jawa</button></div>`;
  let h;
  if(s.status==="ok"){
    const c=s.c,k=s.kelas;
    h=`<div style="${warna(k)}"><h2>${d.nama}</h2>
      <p class="kelas"><i></i>${KLS[k]}</p><p class="desk">${DESK[k]}</p>
      ${s.nilai!=null?`<div class="val"><b>${f(s.nilai)}</b>µg/m³ perkiraan PM2.5</div>
      <div class="bar" style="--a:${CONFIG.AMBANG.sedang/MAX*100}%;--b:${CONFIG.AMBANG.berat/MAX*100}%"><span class="pin" style="--pos:${Math.min(100,s.nilai/MAX*100)}%"></span></div>`:""}
      ${s.demo?`<p class="demo">Mode demo: angka ini dari rumus sementara, belum dari model random forest.</p>`:""}</div>
      <div class="tiles">${tile("suhu","Suhu",f(c.temperature_2m)+" °C")}${tile("lembap","Kelembapan",f(c.relative_humidity_2m)+"%")}${tile("angin","Angin",f(c.wind_speed_10m)+" km/j")}${tile("hujan","Curah hujan",f(c.precipitation)+" mm")}</div>
      ${foot("Cuaca per "+c.time.replace("T"," ")+" WIB")}`;
  }else if(s.status==="gagal"){
    h=`<div><h2>${d.nama}</h2><p>Data gagal dimuat: ${s.err}. Periksa koneksi internet, lalu <button class="back" id="ulang">muat ulang</button></p></div>${foot()}`;
  }else{
    h=`<div><h2>${d.nama}</h2><p class="desk">Memuat data cuaca...</p></div>${foot()}`;
  }
  panel.innerHTML=h;
}
function ringkas(){
  $("#summary").innerHTML=DAERAH.map((d,i)=>{
    const s=S[i];
    const b=s.status==="ok"?`<span class="badge" style="${warna(s.kelas)}"><i></i>${KLS[s.kelas]}</span>${s.nilai!=null?`<small>${f(s.nilai)} µg/m³ perkiraan PM2.5</small>`:""}`
      :`<small>${s.status==="gagal"?"Gagal dimuat":"Memuat data..."}</small>`;
    return `<button class="sum" data-i="${i}"><b>${d.nama}</b>${b}</button>`;
  }).join("");
  const ok=S.filter(s=>s.status==="ok"),demo=ok.some(s=>s.demo),st=$("#status");
  st.className="chip"+(demo?" demo":"");
  st.textContent=S.some(s=>s.status==="muat")?"Memuat data":S.some(s=>s.status==="gagal")?"Sebagian data gagal dimuat":demo?"Mode demo":"Model aktif";
}
$("#legend").innerHTML=[["ringan",`di bawah ${CONFIG.AMBANG.sedang}`],["sedang",`${CONFIG.AMBANG.sedang} sampai ${CONFIG.AMBANG.berat}`],["berat",`di atas ${CONFIG.AMBANG.berat}`]]
  .map(([k,t])=>`<li><i style="background:var(--${k})"></i>${KLS[k]}, ${t.replace(/\./g,",")} µg/m³</li>`).join("");
apply();tandai();ringkas();DAERAH.forEach((_,i)=>muat(i));
