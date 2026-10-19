/* SAE Granada · Itinerancias Unidades · informe mensual PDF por itinerancia.
   Solo consulta datos existentes; no realiza escrituras ni modifica registros. */
(() => {
  "use strict";
  const $m = (id) => document.getElementById(id);
  const LOTE = 500;

  function aviso(texto, error = false) {
    const el = $m("estadoInformeMensual");
    if (!el) return;
    el.textContent = texto;
    el.classList.toggle("error", error);
    el.setAttribute("role", error ? "alert" : "status");
  }

  function periodoSeleccionado() {
    const v = String($m("mesInformeMensual")?.value || "");
    const match = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(v);
    if (!match) throw new Error("Selecciona un mes válido.");
    const anio = Number(match[1]);
    const mes = Number(match[2]);
    const siguiente = mes === 12
      ? `${anio + 1}-01-01`
      : `${anio}-${String(mes + 1).padStart(2, "0")}-01`;
    const titulo = new Intl.DateTimeFormat("es-ES", {
      year: "numeric", month: "long", timeZone: "Europe/Madrid"
    }).format(new Date(Date.UTC(anio, mes - 1, 15, 12)));
    return { clave: v, desde: `${v}-01`, hasta: siguiente, titulo };
  }

  function contexto() {
    const perfil = typeof perfilActual !== "undefined" ? perfilActual : null;
    const convocatoria = typeof convocatoriaActual !== "undefined" ? convocatoriaActual : null;
    const itinerancia = typeof itineranciaListadoActividadesActual !== "undefined"
      ? itineranciaListadoActividadesActual : null;
    const publicadas = typeof publicadasActuales !== "undefined" ? publicadasActuales : [];
    if (!perfil?.id || !perfil?.unidad_id || !convocatoria?.id || !itinerancia?.id) {
      throw new Error("No se ha identificado correctamente la unidad o la itinerancia.");
    }
    if (!publicadas.some(p => String(p.id) === String(itinerancia.id))) {
      throw new Error("La itinerancia no figura entre las publicadas de esta unidad.");
    }
    return { perfil, convocatoria, itinerancia };
  }

  async function obtenerRegistros(ctx, periodo) {
    const registros = [];
    // Paginación explícita: PostgREST/Supabase puede limitar a 1000 filas por petición.
    for (let desde = 0; ; desde += LOTE) {
      const { data, error } = await supabaseClient
        .from("actividad_itinerancias")
        .select("id,fecha_actividad,personal_tecnico,numero_atenciones,tipo_atencion,tiempo_total_minutos,observaciones")
        .eq("unidad_id", ctx.perfil.unidad_id)
        .eq("convocatoria_id", ctx.convocatoria.id)
        .eq("itinerancia_publicada_id", ctx.itinerancia.id)
        .gte("fecha_actividad", periodo.desde)
        .lt("fecha_actividad", periodo.hasta)
        .order("fecha_actividad", { ascending: true })
        .order("id", { ascending: true })
        .range(desde, desde + LOTE - 1);
      if (error) throw new Error("Error al consultar el registro mensual: " + error.message);
      registros.push(...(data || []));
      if (!data || data.length < LOTE) break;
      if (desde >= 49500) throw new Error("El informe supera las 50.000 filas. Solicita asistencia para exportarlo.");
    }
    return registros;
  }

  function fechaES(iso) {
    const [y, m, d] = String(iso || "").slice(0, 10).split("-");
    return y && m && d ? `${d}/${m}/${y}` : String(iso || "");
  }

  function hhmm(valor) {
    const n = Math.max(0, Math.round(Number(valor) || 0));
    return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  }

  function csvSeguroNombre(s) {
    return String(s || "itinerancia")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "itinerancia";
  }

  function texto(v, defecto = "-") {
    return String(v ?? "").trim() || defecto;
  }

  function crearPDF(ctx, periodo, registros) {
    if (!window.jspdf?.jsPDF) {
      throw new Error("No se ha cargado la biblioteca PDF. Comprueba la conexión y vuelve a intentarlo.");
    }
    const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    if (typeof doc.autoTable !== "function") {
      throw new Error("No se ha cargado el componente de tablas PDF.");
    }
    const p = ctx.itinerancia;
    const u = ctx.perfil.unidades || {};
    const totalAtenciones = registros.reduce((s, a) => s + (Number(a.numero_atenciones) || 0), 0);
    const totalMinutos = registros.reduce((s, a) => s + (Number(a.tiempo_total_minutos) || 0), 0);
    const fechaGeneracion = new Intl.DateTimeFormat("es-ES", {
      dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid"
    }).format(new Date());
    const anchoPagina = doc.internal.pageSize.getWidth();
    const margen = 13;
    let y = 16;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("REGISTRO MENSUAL DE ATENCIONES POR ITINERANCIA", margen, y);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const lineas = [
      `Período: ${periodo.titulo}`,
      `Convocatoria: ${texto(ctx.convocatoria.nombre, ctx.convocatoria.id)}`,
      `Unidad: ${texto(u.nombre)}`,
      `Municipio de la itinerancia: ${texto(p.municipio)}`,
      `Lugar / dirección: ${texto(p.direccion)}`,
      `Días y horario: ${texto(p.dias || p.horario)}`
    ];
    for (const linea of lineas) {
      const renglones = doc.splitTextToSize(linea, anchoPagina - margen * 2);
      doc.text(renglones, margen, y);
      y += 5 * renglones.length;
    }
    y += 2;
    doc.setFont("helvetica", "bold");
    doc.text(`REGISTROS: ${registros.length}    ATENCIONES: ${totalAtenciones}    TIEMPO TOTAL: ${hhmm(totalMinutos)} (hh:mm)`, margen, y);
    y += 6;

    const body = registros.map(a => [
      fechaES(a.fecha_actividad),
      texto(a.personal_tecnico),
      String(Number(a.numero_atenciones) || 0),
      texto(a.tipo_atencion),
      hhmm(a.tiempo_total_minutos),
      texto(a.observaciones)
    ]);
    if (!body.length) body.push(["Sin registros en el mes seleccionado", "", "", "", "", ""]);
    doc.autoTable({
      startY: y,
      head: [["FECHA", "PERSONAL TÉCNICO", "ATENC.", "TIPO DE ATENCIÓN", "TIEMPO", "OBSERVACIONES"]],
      body,
      margin: { left: margen, right: margen, top: 13, bottom: 15 },
      theme: "grid",
      styles: { font: "helvetica", fontSize: 8, cellPadding: 2.2, overflow: "linebreak", valign: "top", lineColor: [217, 225, 231], lineWidth: 0.15 },
      headStyles: { fillColor: [27, 75, 104], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 248, 251] },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 47 },
        2: { cellWidth: 17, halign: "center" },
        3: { cellWidth: 44 },
        4: { cellWidth: 20, halign: "center" },
        5: { cellWidth: "auto" }
      },
      showHead: "everyPage",
      rowPageBreak: "auto"
    });
    const paginas = doc.internal.getNumberOfPages();
    for (let pagina = 1; pagina <= paginas; pagina++) {
      doc.setPage(pagina);
      doc.setDrawColor(215, 225, 231);
      doc.line(margen, 195, anchoPagina - margen, 195);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`Generado: ${fechaGeneracion} · Documento informativo extraído del portal de unidades`, margen, 200);
      doc.text(`Página ${pagina} de ${paginas}`, anchoPagina - margen, 200, { align: "right" });
    }
    const nombre = `informe_atenciones_${periodo.clave}_${csvSeguroNombre(p.municipio || p.titulo)}_${String(p.id).slice(0, 8)}.pdf`;
    doc.save(nombre);
    return nombre;
  }

  async function descargar() {
    const btn = $m("btnDescargarInformeMensual");
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    const antes = btn.textContent;
    btn.textContent = "Generando informe...";
    aviso("Consultando los registros del mes seleccionado...");
    try {
      const periodo = periodoSeleccionado();
      const ctx = contexto();
      const registros = await obtenerRegistros(ctx, periodo);
      const nombre = crearPDF(ctx, periodo, registros);
      aviso(`Informe generado: ${nombre}${registros.length ? "" : " (sin registros en ese mes)"}`);
    } catch (error) {
      console.error("Informe mensual de atenciones:", error);
      aviso(error?.message || "No se ha podido generar el informe.", true);
    } finally {
      btn.disabled = false;
      btn.textContent = antes;
    }
  }

  function inicializar() {
    const mes = $m("mesInformeMensual");
    const boton = $m("btnDescargarInformeMensual");
    if (!mes || !boton || boton.dataset.informeInstalado) return;
    const hoy = new Date();
    mes.value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
    boton.dataset.informeInstalado = "1";
    boton.addEventListener("click", descargar);
    $m("modalListadoActividades")?.addEventListener("close", () => aviso(""));
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inicializar);
  } else {
    inicializar();
  }
})();
