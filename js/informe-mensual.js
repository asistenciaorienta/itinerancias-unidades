/* SAE Granada · Unidades · informe mensual GLOBAL de registro de atenciones.
 * Solo lectura sobre Supabase. Se limita a la unidad activa y convocatoria activa.
 * No precisa seleccionar una itinerancia y no altera js/app.js. 2026-10-19 · v2.
 */
(() => {
  'use strict';
  const ID = 'informeMensualGlobal';
  const PAGINA = 500;
  const $ = (id) => document.getElementById(id);
  let generando = false;

  function valorGlobal(nombre) {
    switch (nombre) {
      case 'perfil': return typeof perfilActual !== 'undefined' ? perfilActual : null;
      case 'convocatoria': return typeof convocatoriaActual !== 'undefined' ? convocatoriaActual : null;
      case 'publicadas': return typeof publicadasActuales !== 'undefined' ? publicadasActuales : [];
      default: return null;
    }
  }

  function crearInterfaz() {
    if ($(ID)) return;
    const encabezado = document.querySelector('.panel-unificado-header');
    if (!encabezado) return;
    const bloque = document.createElement('section');
    bloque.id = ID;
    bloque.className = 'informe-global-mensual';
    bloque.setAttribute('aria-label', 'Informe mensual de atenciones de todas las itinerancias');
    bloque.innerHTML = `
      <div class="informe-global-mensual__titulo">
        <strong>Informe mensual de atenciones · todas las itinerancias</strong>
        <span>Resumen de personal técnico, municipios y atenciones de la unidad activa.</span>
      </div>
      <div class="informe-global-mensual__acciones">
        <label for="mesInformeGlobal">Mes
          <input type="month" id="mesInformeGlobal" required>
        </label>
        <button type="button" id="btnInformeGlobal" class="secundario">
          <span id="textoBtnInformeGlobal">Descargar informe mensual (PDF)</span>
          <span id="spinnerInformeGlobal" class="informe-global-mensual__spinner" aria-hidden="true" hidden></span>
        </button>
      </div>
      <p id="estadoInformeGlobal" role="status" aria-live="polite"></p>`;
    encabezado.insertAdjacentElement('afterend', bloque);
    // Elegir el mes vigente en el huso horario de la unidad.
    const partes = new Intl.DateTimeFormat('es-ES', {
      year: 'numeric', month: '2-digit', timeZone: 'Europe/Madrid'
    }).formatToParts(new Date());
    const get = (tipo) => partes.find(p => p.type === tipo)?.value;
    $('mesInformeGlobal').value = `${get('year')}-${get('month')}`;
    $('btnInformeGlobal').addEventListener('click', descargar);
    // El control V1 estaba dentro del modal de UNA itinerancia; no debe ofrecerse más.
    ocultarControlAntiguo();
  }

  function ocultarControlAntiguo() {
    document.querySelectorAll('.acciones-informe-mensual').forEach(el => {
      el.hidden = true;
      el.style.display = 'none';
    });
  }

  function estilos() {
    if ($('estiloInformeGlobal')) return;
    const el = document.createElement('style');
    el.id = 'estiloInformeGlobal';
    el.textContent = `
      .informe-global-mensual{border:1px solid #d2dee8;border-left:4px solid #236087;
        padding:13px 16px;margin:14px 0 20px;background:#f8fbfd;border-radius:7px;}
      .informe-global-mensual__titulo{display:flex;flex-direction:column;gap:3px;margin-bottom:10px;}
      .informe-global-mensual__titulo strong{font-size:1rem;color:#153e5a;}
      .informe-global-mensual__titulo span{font-size:.88rem;color:#526171;}
      .informe-global-mensual__acciones{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;}
      .informe-global-mensual__acciones label{display:flex;flex-direction:column;gap:4px;font-weight:600;}
      #mesInformeGlobal{min-height:38px;width:160px;}
      #btnInformeGlobal{display:inline-flex;gap:9px;align-items:center;justify-content:center;min-height:40px;min-width:275px;}
      #btnInformeGlobal:disabled{opacity:.70;cursor:wait;}
      #estadoInformeGlobal{margin:8px 0 0;font-size:.88rem;min-height:1.2em;}
      #estadoInformeGlobal.error{color:#a12626;font-weight:600;}
      .informe-global-mensual__spinner{width:16px;height:16px;border-radius:50%;
        border:2px solid currentColor;border-right-color:transparent;
        display:inline-block;animation:rotar-informe-global .7s linear infinite;}
      .informe-global-mensual__spinner[hidden]{display:none;}
      @keyframes rotar-informe-global{to{transform:rotate(360deg);}}
      @media(prefers-reduced-motion:reduce){.informe-global-mensual__spinner{animation-duration:1.7s;}}
    `;
    document.head.appendChild(el);
  }

  function notificar(mensaje, error = false) {
    const estado = $('estadoInformeGlobal');
    if (!estado) return;
    estado.textContent = mensaje;
    estado.classList.toggle('error', error);
    estado.setAttribute('role', error ? 'alert' : 'status');
  }

  function cambiarCarga(activo) {
    generando = activo;
    const boton = $('btnInformeGlobal');
    const mes = $('mesInformeGlobal');
    if (!boton || !mes) return;
    boton.disabled = activo;
    mes.disabled = activo;
    boton.setAttribute('aria-busy', String(activo));
    $('textoBtnInformeGlobal').textContent = activo ? 'Generando PDF…' : 'Descargar informe mensual (PDF)';
    $('spinnerInformeGlobal').hidden = !activo;
  }

  function periodo() {
    const v = String($('mesInformeGlobal')?.value || '');
    const m = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(v);
    if (!m) throw new Error('Selecciona un mes válido.');
    const y = +m[1], mm = +m[2];
    const proximo = mm === 12 ? `${y+1}-01-01` : `${y}-${String(mm+1).padStart(2,'0')}-01`;
    const titulo = new Intl.DateTimeFormat('es-ES', {
      month:'long',year:'numeric',timeZone:'Europe/Madrid'
    }).format(new Date(Date.UTC(y, mm-1, 15, 12)));
    return { clave:v, desde:`${v}-01`, hasta:proximo, titulo };
  }

  function contexto() {
    const perfil = valorGlobal('perfil');
    const convocatoria = valorGlobal('convocatoria');
    const publicadas = valorGlobal('publicadas');
    if (!perfil?.id || !perfil?.unidad_id || !convocatoria?.id) {
      throw new Error('No se ha identificado la unidad activa o la convocatoria. Actualiza el panel.');
    }
    if (typeof supabaseClient === 'undefined' || !supabaseClient?.from) {
      throw new Error('No está disponible la conexión a los registros.');
    }
    return { perfil, convocatoria, publicadas: Array.isArray(publicadas) ? publicadas : [] };
  }

  async function consultarAtenciones(ctx, rango) {
    const registros = [];
    for (let offset = 0; ; offset += PAGINA) {
      const {data, error} = await supabaseClient.from('actividad_itinerancias')
        .select('id,itinerancia_publicada_id,fecha_actividad,personal_tecnico,numero_atenciones,tipo_atencion,tiempo_total_minutos,observaciones')
        .eq('unidad_id',ctx.perfil.unidad_id)
        .eq('convocatoria_id',ctx.convocatoria.id)
        .gte('fecha_actividad',rango.desde)
        .lt('fecha_actividad',rango.hasta)
        .order('fecha_actividad',{ascending:true})
        .order('id',{ascending:true})
        .range(offset,offset+PAGINA-1);
      if (error) throw new Error(`No se pudieron obtener las atenciones: ${error.message}`);
      registros.push(...(data || []));
      if (!data || data.length < PAGINA) break;
      if (offset >= 49500) throw new Error('Hay más de 50.000 registros; no se generará un informe incompleto.');
    }
    return registros;
  }

  async function completarLugares(ctx, registros) {
    const mapa = new Map();
    for (const p of ctx.publicadas) {
      if (p?.id != null) mapa.set(String(p.id), p);
    }
    const faltantes = [...new Set(registros.map(r=>String(r.itinerancia_publicada_id ?? '')).filter(id=>id && !mapa.has(id)))];
    // Recupera itinerancias históricas: pueden no figurar ya en el listado de publicadas.
    for (let i=0; i<faltantes.length; i+=75) {
      const ids = faltantes.slice(i,i+75);
      const {data,error} = await supabaseClient.from('itinerancias_publicadas')
        .select('id,titulo,municipio,direccion,dias,horario,convocatoria_id')
        .in('id',ids)
        .eq('convocatoria_id',ctx.convocatoria.id);
      if (error) {
        // Nunca se inventan ubicaciones. Fallar explícitamente si no es posible identificar lugares.
        throw new Error(`No se pudieron identificar todas las itinerancias: ${error.message}`);
      }
      for (const p of (data || [])) mapa.set(String(p.id), p);
    }
    const sinLugar = faltantes.filter(id=>!mapa.has(id));
    if (sinLugar.length) {
      throw new Error(`No se pudo identificar el municipio de ${sinLugar.length} itinerancia(s) con registros. No se descargará un informe incompleto.`);
    }
    return mapa;
  }

  function txt(v, def='-') { return String(v ?? '').trim() || def; }
  function num(v) { const n=Number(v); return Number.isFinite(n) ? Math.max(0,n) : 0; }
  function duracion(v) { const n=Math.round(num(v)); return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`; }
  function fecha(v) { const s=String(v??'').slice(0,10), p=s.split('-'); return p.length===3 ? `${p[2]}/${p[1]}/${p[0]}` : s; }
  function etiquetaLugar(p) { return txt(p?.titulo, txt(p?.direccion, 'Itinerancia '+txt(p?.id))); }

  function agrupar(registros, lugares) {
    const resumen = new Map();
    for (const r of registros) {
      const p = lugares.get(String(r.itinerancia_publicada_id)) || {};
      const tecnico = txt(r.personal_tecnico,'Sin indicar');
      const municipio = txt(p.municipio,'Sin municipio');
      const lugar = etiquetaLugar(p);
      const clave = JSON.stringify([tecnico,municipio,String(r.itinerancia_publicada_id)]);
      if (!resumen.has(clave)) resumen.set(clave,{tecnico,municipio,lugar,registros:0,atenciones:0,minutos:0});
      const g = resumen.get(clave);
      g.registros++;
      g.atenciones += num(r.numero_atenciones);
      g.minutos += num(r.tiempo_total_minutos);
    }
    return [...resumen.values()].sort((a,b)=>
      a.tecnico.localeCompare(b.tecnico,'es') ||
      a.municipio.localeCompare(b.municipio,'es') ||
      a.lugar.localeCompare(b.lugar,'es'));
  }

  function generarPDF(ctx, rango, registros, lugares) {
    const jsPDF = window.jspdf?.jsPDF;
    if (!jsPDF) throw new Error('No está disponible la biblioteca jsPDF. Comprueba la conexión.');
    const doc = new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
    if (typeof doc.autoTable !== 'function') throw new Error('No se ha cargado la biblioteca de tablas PDF.');
    const ancho = doc.internal.pageSize.getWidth();
    const margen=12;
    const fechaGenerado = new Intl.DateTimeFormat('es-ES', {
      dateStyle:'short',timeStyle:'short',timeZone:'Europe/Madrid'
    }).format(new Date());
    const unidad = txt(ctx.perfil.unidades?.nombre,txt(ctx.perfil.unidad_nombre));
    const convocatoria = txt(ctx.convocatoria.nombre,txt(ctx.convocatoria.id));
    const agrupado=agrupar(registros,lugares);
    const totalA=registros.reduce((v,r)=>v+num(r.numero_atenciones),0);
    const totalMin=registros.reduce((v,r)=>v+num(r.tiempo_total_minutos),0);
    const municipios = new Set(registros.map(r=>txt(lugares.get(String(r.itinerancia_publicada_id))?.municipio)));
    const tecnicos = new Set(registros.map(r=>txt(r.personal_tecnico,'Sin indicar')));
    const itins = new Set(registros.map(r=>String(r.itinerancia_publicada_id)));

    doc.setFont('helvetica','bold');doc.setFontSize(14);
    doc.text('INFORME MENSUAL DE ATENCIONES - TODAS LAS ITINERANCIAS',margen,15);
    doc.setFont('helvetica','normal');doc.setFontSize(10);
    doc.text(doc.splitTextToSize(`Mes: ${rango.titulo}   |   Unidad: ${unidad}   |   Convocatoria: ${convocatoria}`,ancho-2*margen),margen,22);
    doc.setFont('helvetica','bold');doc.setFontSize(9.7);
    doc.text(`PERSONAL: ${tecnicos.size}   MUNICIPIOS: ${municipios.size}   ITINERANCIAS: ${itins.size}   REGISTROS: ${registros.length}   ATENCIONES: ${totalA}   TIEMPO: ${duracion(totalMin)} (hh:mm)`,margen,33);
    doc.setFont('helvetica','bold');doc.setFontSize(10.5);
    doc.text('RESUMEN: QUIEN HA ATENDIDO Y DONDE',margen,42);
    const comun = {
      theme:'grid',margin:{left:margen,right:margen,top:14,bottom:16},
      styles:{font:'helvetica',fontSize:8,cellPadding:2.1,overflow:'linebreak',valign:'top',lineColor:[213,225,233],lineWidth:.12},
      headStyles:{fillColor:[26,74,105],textColor:255,fontStyle:'bold'},
      alternateRowStyles:{fillColor:[245,248,251]},showHead:'everyPage',rowPageBreak:'avoid'
    };
    doc.autoTable({
      ...comun,startY:46,
      head:[['PERSONAL TECNICO','MUNICIPIO','ITINERANCIA / LUGAR','REGISTROS','ATENC.','TIEMPO']],
      body:agrupado.length?agrupado.map(x=>[x.tecnico,x.municipio,x.lugar,String(x.registros),String(x.atenciones),duracion(x.minutos)]):
        [['Sin registros en el mes seleccionado','','','','','']],
      columnStyles:{0:{cellWidth:55},1:{cellWidth:40},2:{cellWidth:'auto'},3:{cellWidth:25,halign:'center'},4:{cellWidth:22,halign:'center'},5:{cellWidth:24,halign:'center'}}
    });
    if (registros.length) {
      doc.addPage();
      doc.setFont('helvetica','bold');doc.setFontSize(12);
      doc.text('DETALLE CRONOLOGICO DEL REGISTRO DE ATENCIONES',margen,16);
      doc.setFont('helvetica','normal');doc.setFontSize(9);
      doc.text(`Mes: ${rango.titulo}   |   Unidad: ${unidad}`,margen,22);
      doc.autoTable({
        ...comun,startY:27,
        head:[['FECHA','PERSONAL TECNICO','MUNICIPIO','ITINERANCIA','TIPO','ATENC.','TIEMPO','OBSERVACIONES']],
        body:registros.map(r=>{
          const p=lugares.get(String(r.itinerancia_publicada_id));
          return [fecha(r.fecha_actividad),txt(r.personal_tecnico),txt(p?.municipio),etiquetaLugar(p),txt(r.tipo_atencion),String(num(r.numero_atenciones)),duracion(r.tiempo_total_minutos),txt(r.observaciones)];
        }),
        columnStyles:{0:{cellWidth:23},1:{cellWidth:38},2:{cellWidth:30},3:{cellWidth:37},4:{cellWidth:34},5:{cellWidth:16,halign:'center'},6:{cellWidth:18,halign:'center'},7:{cellWidth:'auto'}}
      });
    }
    const paginas=doc.internal.getNumberOfPages();
    for(let i=1;i<=paginas;i++){
      doc.setPage(i);
      doc.setDrawColor(209,220,228);
      doc.line(margen,196,ancho-margen,196);
      doc.setFont('helvetica','normal');doc.setFontSize(8);
      doc.text(`Generado: ${fechaGenerado}  |  Registro informativo de atenciones de la unidad activa`,margen,202);
      doc.text(`Pagina ${i} de ${paginas}`,ancho-margen,202,{align:'right'});
    }
    const nombre=`informe_global_atenciones_${rango.clave}_unidad_${String(ctx.perfil.unidad_id).replace(/[^\w-]/g,'').slice(0,30)}.pdf`;
    doc.save(nombre);
    return nombre;
  }

  async function descargar() {
    if (generando) return;
    cambiarCarga(true);
    notificar('Consultando las atenciones de todas las itinerancias de la unidad...');
    try {
      // Permite pintar el indicador antes de empezar las consultas y el PDF.
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const mes = periodo(), ctx = contexto();
      const registros = await consultarAtenciones(ctx,mes);
      notificar(`Localizados ${registros.length} registros. Preparando el informe...`);
      const lugares=await completarLugares(ctx,registros);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const nombre=generarPDF(ctx,mes,registros,lugares);
      notificar(`Informe descargado: ${nombre}${registros.length?'':' (mes sin registros)'}`);
    } catch(e) {
      console.error('Informe mensual global:',e);
      notificar(e?.message||'No se pudo generar el informe.',true);
    } finally {
      cambiarCarga(false);
    }
  }

  function inicializar() {
    estilos();
    crearInterfaz();
    ocultarControlAntiguo();
    // Si la aplicación vuelve a pintar el panel, volver a insertar la tarjeta.
    const observador=new MutationObserver(()=>{
      if (!$(ID)) crearInterfaz();
      ocultarControlAntiguo();
    });
    observador.observe(document.body,{childList:true,subtree:true});
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',inicializar,{once:true});
  else inicializar();
})();
