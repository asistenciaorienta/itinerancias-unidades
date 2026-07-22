function $(id) {
  return document.getElementById(id);
}

function mostrarMsg(texto, error = false) {
  const msg = $("msg");
  if (!msg) return;

  msg.textContent = texto || "";
  msg.className = error ? "msg aviso-global error" : "msg aviso-global ok";

  if (texto) {
    msg.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function mostrarMsgActividad(texto, error = false) {
  const msg = $("msgActividad");
  if (!msg) {
    mostrarMsg(texto, error);
    return;
  }

  msg.textContent = texto || "";
  msg.className = error ? "msg msg-modal error" : "msg msg-modal ok";

  if (texto) {
    msg.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}


function normalizarTexto(v = "") {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function entidadesCoinciden(a, b) {
  const na = normalizarTexto(a);
  const nb = normalizarTexto(b);

  if (!na || !nb) return false;

  return na === nb || na.includes(nb) || nb.includes(na);
}

async function obtenerSesion() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function exigirLogin() {
  const session = await obtenerSesion();

  if (!session) {
    window.location.href = "login.html";
    return null;
  }

  return session;
}

async function obtenerConvocatoriaVigente() {
  const { data, error } = await supabaseClient
    .from("convocatorias_orienta")
    .select("id,nombre,periodo,fecha_inicio,fecha_fin,estado,visible_web")
    .eq("visible_web", true)
    .eq("estado", "VIGENTE")
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw new Error("No hay ninguna convocatoria vigente disponible.");
  }

  return data;
}

async function obtenerPerfil() {
  const session = await exigirLogin();
  if (!session) return null;

  const { data, error } = await supabaseClient
    .from("usuarios_perfiles")
    .select("id,email,nombre,rol,unidad_id,activo,unidades(nombre,origen_interno_id)")
    .eq("id", session.user.id)
    .single();

  if (error) {
    console.error(error);
    mostrarMsg("No se ha podido cargar tu perfil. Contacta con Dirección Provincial.", true);
    return null;
  }

  if (!data.activo) {
    mostrarMsg("Tu usuario no está activo. Contacta con Dirección Provincial.", true);
    await supabaseClient.auth.signOut();
    return null;
  }

  return data;
}

async function login(email, password) {
  const { error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    mostrarMsg("No se ha podido iniciar sesión: " + error.message, true);
    return;
  }

  window.location.href = "panel.html";
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
}



// === SOLICITUD_ACCESO_UNIDAD_ID_CONVOCATORIA_V1 ===
let unidadesSolicitudAcceso = [];
let convocatoriaSolicitudAcceso = null;

function textoUnidadSolicitudAcceso(u) {
  return [u.nombre, u.municipio].filter(Boolean).join(" · ");
}

function unidadSeleccionadaSolicitudAcceso() {
  const unidadId = $("solUnidadId")?.value || "";
  if (!unidadId) return null;
  return unidadesSolicitudAcceso.find(u => String(u.id) === String(unidadId)) || null;
}

async function prepararSolicitudAccesoUnidadConvocatoria() {
  const inputUnidad = $("solUnidad");
  const form = $("formSolicitudAcceso");

  if (!inputUnidad || !form) return;

  try {
    convocatoriaSolicitudAcceso = await obtenerConvocatoriaVigente();

    const hiddenConv = $("solConvocatoriaId");
    if (hiddenConv) hiddenConv.value = convocatoriaSolicitudAcceso.id;

    const { data, error } = await supabaseClient
      .from("unidades")
      .select("id,nombre,municipio,convocatoria_id,activa")
      .eq("activa", true)
      .eq("convocatoria_id", convocatoriaSolicitudAcceso.id)
      .order("nombre", { ascending: true });

    if (error) throw error;

    unidadesSolicitudAcceso = data || [];

    const select = document.createElement("select");
    select.id = "solUnidadSelect";
    select.required = true;
    select.innerHTML = `
      <option value="">Selecciona tu unidad...</option>
      ${unidadesSolicitudAcceso.map(u => `
        <option value="${escapeHtml(u.id)}">${escapeHtml(textoUnidadSolicitudAcceso(u))}</option>
      `).join("")}
    `;

    select.addEventListener("change", () => {
      const unidad = unidadesSolicitudAcceso.find(u => String(u.id) === String(select.value));

      const hiddenUnidadId = $("solUnidadId");
      if (hiddenUnidadId) hiddenUnidadId.value = unidad?.id || "";

      inputUnidad.value = unidad ? textoUnidadSolicitudAcceso(unidad) : "";
    });

    inputUnidad.type = "hidden";
    inputUnidad.required = false;
    inputUnidad.parentNode.insertBefore(select, inputUnidad.nextSibling);

  } catch (err) {
    console.error(err);
    mostrarMsg("No se han podido cargar las unidades disponibles para solicitar acceso.", true);
  }
}
// === FIN_SOLICITUD_ACCESO_UNIDAD_ID_CONVOCATORIA_V1 ===

async function solicitarAcceso(payload) {
  try {
    const convocatoria = convocatoriaSolicitudAcceso || await obtenerConvocatoriaVigente();
    payload.convocatoria_id = convocatoria.id;

    const unidad = unidadSeleccionadaSolicitudAcceso();

    if (!unidad?.id) {
      mostrarMsg("Debes seleccionar una unidad del listado.", true);
      return;
    }

    payload.unidad_id = unidad.id;
    payload.unidad_nombre = textoUnidadSolicitudAcceso(unidad);

  } catch (err) {
    console.error(err);
    mostrarMsg("No se ha podido detectar la convocatoria o unidad vigente. Inténtalo más tarde.", true);
    return;
  }

  const { error } = await supabaseClient
    .from("solicitudes_acceso")
    .insert(payload);

  if (error) {
    console.error(error);
    mostrarMsg("No se ha podido enviar la solicitud: " + error.message, true);
    return;
  }

  mostrarMsg("Solicitud enviada correctamente. Dirección Provincial la revisará.");
  const form = $("formSolicitudAcceso");
  if (form) form.reset();

  const hiddenUnidadId = $("solUnidadId");
  if (hiddenUnidadId) hiddenUnidadId.value = "";

  const select = $("solUnidadSelect");
  if (select) select.value = "";
}

async function cargarItineranciasPublicadasEntidad(convocatoriaId, perfil) {
  const unidadNombre = perfil?.unidades?.nombre || "";
  const origenInternoId = perfil?.unidades?.origen_interno_id;

  let query = supabaseClient
    .from("itinerancias_publicadas")
    .select("*")
    .eq("convocatoria_id", convocatoriaId)
    .eq("activa", true)
    .order("municipio", { ascending: true })
    .order("entidad", { ascending: true });

  if (origenInternoId !== null && origenInternoId !== undefined && origenInternoId !== "") {
    query = query.eq("unidad_origen_interno_id", origenInternoId);
  }

  const { data, error } = await query;

  if (error) throw error;

  const lista = data || [];

  // Fallback solo si la unidad no tiene origen_interno_id informado.
  if (origenInternoId === null || origenInternoId === undefined || origenInternoId === "") {
    return lista.filter(i => entidadesCoinciden(i.entidad, unidadNombre));
  }

  return lista;
}

async function cargarPropuestasEntidad(convocatoriaId, unidadId) {
  let query = supabaseClient
    .from("itinerancias_propuestas")
    .select("*")
    .eq("convocatoria_id", convocatoriaId)
    .order("created_at", { ascending: false });

  if (unidadId) {
    query = query.eq("unidad_id", unidadId);
  }

  const { data, error } = await query;

  if (error) throw error;

  return data || [];
}


function fechaES(fecha) {
  if (!fecha) return "";
  const [y, m, d] = String(fecha).slice(0, 10).split("-");
  if (!y || !m || !d) return fecha;
  return `${d}/${m}/${y}`;
}

function formatoTiempo(minutos) {
  const total = Number(minutos || 0);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function actividadesDeItinerancia(idPublicada) {
  return actividadesActuales
    .filter(a => String(a.itinerancia_publicada_id) === String(idPublicada))
    .sort((a, b) => {
      const f = String(b.fecha_actividad || "").localeCompare(String(a.fecha_actividad || ""));
      if (f !== 0) return f;
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
}

function renderActividadesItinerancia(idPublicada) {
  const actividades = actividadesDeItinerancia(idPublicada);
  const total = actividades.length;
  const ultima = actividades[0];

  if (!total) {
    return `<p class="muted actividad-resumen">Sin atención registrada todavía.</p>`;
  }

  return `
    <p class="muted actividad-resumen">
      ${total} actividad/es registrada/s
      ${ultima ? ` · Última: ${escapeHtml(fechaES(ultima.fecha_actividad))}` : ""}
    </p>
  `;
}

async function cargarActividadesUnidad(convocatoriaId) {
  if (!perfilActual?.unidad_id || !convocatoriaId) {
    actividadesActuales = [];
    return;
  }

  const { data, error } = await supabaseClient
    .from("actividad_itinerancias")
    .select("*")
    .eq("unidad_id", perfilActual.unidad_id)
    .eq("convocatoria_id", convocatoriaId)
    .order("fecha_actividad", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    mostrarMsg("No se han podido cargar las atenciones registradas: " + error.message, true);
    actividadesActuales = [];
    return;
  }

  actividadesActuales = data || [];
}

function renderItineranciasPublicadas(lista, unidadNombre) {
  const cont = $("listaPublicadas");
  if (!cont) return;

  if (!lista.length) {
    cont.innerHTML = `
      <p class="muted">
        No se han encontrado itinerancias publicadas asociadas a ${escapeHtml(unidadNombre)}.
      </p>
    `;
    return;
  }

  cont.innerHTML = lista.map(i => `
    <article class="item">
      <div>
        <h3>${escapeHtml(i.titulo || i.entidad || "Itinerancia")}</h3>
        <p class="muted">
          ${escapeHtml(i.municipio || "")}
          ${i.dias ? " · " + escapeHtml(i.dias) : ""}
        </p>
        <p>
          ${escapeHtml(i.direccion || "")}
          ${i.telefono ? " · Tel. " + escapeHtml(i.telefono) : ""}
        </p>
        <p class="muted">
          ${escapeHtml(i.tecnico_orienta || i.contacto || "")}
          ${i.colectivo ? " · " + escapeHtml(i.colectivo) : ""}
        </p>
        ${renderActividadesItinerancia(i.id)}
      </div>
      <div class="acciones-item">
        <button class="btn" onclick="abrirModalActividad('${escapeHtml(i.id)}')">
          Registrar atenciones
        </button>
        <button class="btn secundario" onclick="abrirModalListadoActividades('${escapeHtml(i.id)}')">
          Ver Registro de Atenciones
        </button>
        <button class="btn secundario" onclick="crearPropuestaModificacion('${escapeHtml(i.id)}')">
          Solicitar modificación de Itinerancia
        </button>
      </div>
    </article>
  `).join("");
}

function renderPropuestas(lista) {
  const listaCont = $("listaPropuestas");
  if (!listaCont) return;

  if (!lista.length) {
    listaCont.innerHTML = `<p class="muted">Todavía no tienes propuestas para la convocatoria vigente.</p>`;
    return;
  }

  listaCont.innerHTML = lista.map(p => `
    <article class="item">
      <div>
        <h3>${escapeHtml(p.titulo || "Sin título")}</h3>
        <p class="muted">
          ${escapeHtml(p.tipo || "")} · ${escapeHtml(p.estado || "")}
        </p>
        <p>${escapeHtml(p.municipio || "")} ${p.horario ? "· " + escapeHtml(p.horario) : ""}</p>
      </div>
      <span class="estado estado-${escapeHtml(String(p.estado || "").toLowerCase())}">
        ${escapeHtml(p.estado || "")}
      </span>
    </article>
  `).join("");
}

let perfilActual = null;
let convocatoriaActual = null;
let publicadasActuales = [];
let propuestasActuales = [];
let itineranciaActividadActual = null;
let itineranciaListadoActividadesActual = null;
let actividadesActuales = [];
let publicadasFormularioActuales = [];


function estadoEtiquetaClase(estado) {
  const e = String(estado || "").toUpperCase();
  if (e === "PUBLICADA") return "estado-publicada";
  if (e === "BORRADOR") return "estado-borrador";
  if (e === "PENDIENTE_VALIDACION") return "estado-pendiente";
  if (e === "RECHAZADA") return "estado-rechazada";
  if (e === "ARCHIVADA") return "estado-archivada";
  return "estado-neutro";
}


function tipoPropuestaLegible(tipo) {
  const t = String(tipo || "NUEVA").toUpperCase();

  if (t === "MODIFICACION") return "MODIFICACIÓN DE ITINERANCIA EXISTENTE";
  if (t === "BAJA") return "BAJA DE ITINERANCIA";
  return "NUEVA ITINERANCIA";
}

function etiquetaItemUnificado(item) {
  const estado = estadoLegible(item.estado);

  if (item.tipoListado === "PROPUESTA") {
    return `${estado} · ${tipoPropuestaLegible(item.data?.tipo)}`;
  }

  return estado;
}

function estadoLegible(estado) {
  const e = String(estado || "").toUpperCase();
  if (e === "PENDIENTE_VALIDACION") return "PENDIENTE";
  return e || "SIN ESTADO";
}

function textoBusquedaItemUnificado(item) {
  const d = item.data || {};
  return normalizarTexto([
    item.tipoListado,
    item.estado,
    d.titulo,
    d.entidad,
    d.municipio,
    d.dias,
    d.horario,
    d.frecuencia,
    d.direccion,
    d.telefono,
    d.tecnico_orienta,
    d.contacto,
    d.colectivo,
    d.observaciones_publicas,
    d.observaciones_unidad
  ].join(" "));
}

function construirItemsUnificados() {
  const publicadas = (publicadasActuales || []).map(i => ({
    id: `pub-${i.id}`,
    tipoListado: "ITINERANCIA",
    estado: "PUBLICADA",
    data: i
  }));

  const propuestas = (propuestasActuales || [])
    // Las propuestas PUBLICADA ya han generado una itinerancia publicada real.
    // No se muestran para evitar duplicidades visuales.
    .filter(p => String(p.estado || "").toUpperCase() !== "PUBLICADA")
    .map(p => ({
      id: `prop-${p.id}`,
      tipoListado: "PROPUESTA",
      estado: p.estado || "BORRADOR",
      data: p
    }));

  return [...publicadas, ...propuestas].sort((a, b) => {
    const fa = a.data.fecha_actividad || a.data.fecha_inicio || a.data.created_at || "";
    const fb = b.data.fecha_actividad || b.data.fecha_inicio || b.data.created_at || "";
    return String(fb).localeCompare(String(fa));
  });
}

function accionesItemUnificado(item) {
  const d = item.data || {};
  const estado = String(item.estado || "").toUpperCase();

  // Solo las ITINERANCIAS reales publicadas permiten registrar/ver actividad
  // y solicitar modificación. Las PROPUESTAS publicadas no se muestran.
  if (estado === "PUBLICADA" && item.tipoListado === "ITINERANCIA") {
    return `
      <button class="btn" onclick="abrirModalActividad('${escapeHtml(d.id)}')">
        Registrar atenciones
      </button>
      <button class="btn secundario" onclick="abrirModalListadoActividades('${escapeHtml(d.id)}')">
        Ver Registro de Atenciones
      </button>
      <button class="btn secundario" onclick="crearPropuestaModificacion('${escapeHtml(d.id)}')">
        Solicitar modificación de Itinerancia
      </button>
    `;
  }

  if (item.tipoListado === "PROPUESTA" && ["BORRADOR", "RECHAZADA"].includes(estado)) {
    return `
      <a class="btn secundario" href="nueva-itinerancia.html?id=${encodeURIComponent(d.id)}">
        Editar propuesta
      </a>
    `;
  }

  return "";
}


function itemUnificadoEsPublicadaUnidad(item) {
  const estado = String(item?.estado || item?.data?.estado || "").toUpperCase();
  const tipo = String(item?.tipoListado || item?.__tipo || item?.__tipoRegistro || item?.tipo || "").toUpperCase();

  return estado === "PUBLICADA" || tipo.includes("PUBLICADA") || tipo.includes("ITINERANCIA");
}

function filtrarItemsPanelUnificadoPorAtencionesUnidad(items) {
  const filtro = String(filtroAtencionesUnidadResumen || "TODAS").toUpperCase();

  if (!vistaResumenUnidadPermiteMostrar()) return items || [];
  if (!filtro || filtro === "TODAS") return items || [];

  return (items || []).filter(item => {
    if (!itemUnificadoEsPublicadaUnidad(item)) return true;

    const d = item.data || item;
    const estadoAtenciones = estadoAtencionesPublicadaUnidad(d);

    if (filtro === "CON") return estadoAtenciones !== "SIN";
    if (filtro === "SIN") return estadoAtenciones === "SIN";
    if (filtro === "RECIENTES") return estadoAtenciones === "RECIENTES";
    if (filtro === "DESACTUALIZADAS") return estadoAtenciones === "DESACTUALIZADAS";

    return true;
  });
}


function claseEstadoAtencionesUnidad(item) {
  const d = item?.data || item || {};

  if (String(item?.estado || d?.estado || "").toUpperCase() !== "PUBLICADA") {
    return "";
  }

  if (typeof estadoAtencionesPublicadaUnidad !== "function") return "";

  const estado = estadoAtencionesPublicadaUnidad(d);

  if (estado === "SIN") return " item-atenciones-sin";
  if (estado === "DESACTUALIZADAS") return " item-atenciones-desactualizadas";
  if (estado === "RECIENTES") return " item-atenciones-recientes";

  return "";
}

function textoAvisoAtencionesUnidad(item) {
  const d = item?.data || item || {};

  if (String(item?.estado || d?.estado || "").toUpperCase() !== "PUBLICADA") {
    return "";
  }

  if (typeof estadoAtencionesPublicadaUnidad !== "function") return "";

  const estado = estadoAtencionesPublicadaUnidad(d);
  const resumen = typeof resumenActividadPublicadaUnidad === "function"
    ? resumenActividadPublicadaUnidad(d)
    : null;

  if (estado === "SIN") {
    return `<p class="aviso-atenciones-item aviso-sin">Sin atenciones mecanizadas</p>`;
  }

  if (estado === "DESACTUALIZADAS") {
    const fecha = resumen?.ultimaFecha ? ` Última fecha: ${escapeHtml(resumen.ultimaFecha)}.` : "";
    return `<p class="aviso-atenciones-item aviso-desactualizada">Atenciones desactualizadas.${fecha}</p>`;
  }

  if (estado === "RECIENTES") {
    return `<p class="aviso-atenciones-item aviso-ok">Atenciones recientes</p>`;
  }

  return "";
}

function asegurarAvisoSuperiorAtencionesUnidad() {
  let aviso = document.getElementById("avisoSuperiorAtencionesUnidad");

  if (aviso) return aviso;

  aviso = document.createElement("section");
  aviso.id = "avisoSuperiorAtencionesUnidad";
  aviso.className = "aviso-superior-atenciones-unidad oculto";

  /*
    El aviso debe quedar también en zona superior:
    debajo del título principal y antes del resumen/panel.
  */
  const resumen = document.getElementById("resumenAtencionesUnidad");
  const panel = document.querySelector(".panel-unificado");
  const msg = document.getElementById("msg");

  if (resumen && resumen.parentElement) {
    resumen.parentElement.insertBefore(aviso, resumen);
  } else if (panel && panel.parentElement) {
    panel.parentElement.insertBefore(aviso, panel);
  } else if (msg && msg.parentElement) {
    msg.insertAdjacentElement("afterend", aviso);
  } else {
    (document.querySelector("main") || document.body).prepend(aviso);
  }

  return aviso;
}

function renderAvisoSuperiorAtencionesUnidad() {
  const aviso = asegurarAvisoSuperiorAtencionesUnidad();

  const lista = Array.isArray(publicadasResumenUnidadBase) ? publicadasResumenUnidadBase : [];

  if (!lista.length || typeof estadoAtencionesPublicadaUnidad !== "function") {
    aviso.classList.add("oculto");
    aviso.innerHTML = "";
    return;
  }

  const sin = lista.filter(p => estadoAtencionesPublicadaUnidad(p) === "SIN").length;
  const desactualizadas = lista.filter(p => estadoAtencionesPublicadaUnidad(p) === "DESACTUALIZADAS").length;

  if (!sin && !desactualizadas) {
    aviso.classList.add("oculto");
    aviso.innerHTML = "";
    return;
  }

  aviso.classList.remove("oculto");
  aviso.innerHTML = `
    <strong>Atención: hay registros de atenciones pendientes de revisar.</strong>
    <span>${sin} itinerancia(s) sin atenciones mecanizadas y ${desactualizadas} desactualizada(s).</span>
  `;
}

function renderPanelUnificado() {
  const cont = $("listaUnificada");
  if (!cont) {
    renderPanelUnificado();
    renderPropuestas(propuestasActuales);
    return;
  }

  const filtroTexto = normalizarTexto($("filtroPanelUnificado")?.value || "");
  const filtroEstado = String($("filtroEstadoUnificado")?.value || "PUBLICADA").trim().toUpperCase();

  let items = construirItemsUnificados();

  if (filtroEstado === "ACTIVAS") {
    items = items.filter(item => {
      const estado = String(item.estado || "").toUpperCase();
      return ["PUBLICADA", "BORRADOR", "PENDIENTE_VALIDACION"].includes(estado);
    });
  } else if (filtroEstado) {
    items = items.filter(item => String(item.estado || "").toUpperCase() === filtroEstado);
  }

  if (filtroTexto) {
    items = items.filter(item => textoBusquedaItemUnificado(item).includes(filtroTexto));
  }

  items = filtrarItemsPanelUnificadoPorAtencionesUnidad(items);

  if (!items.length) {
    cont.innerHTML = `<p class="muted sin-resultados-panel">No hay resultados con los filtros aplicados.</p>`;
    return;
  }

  cont.innerHTML = items.map(item => {
    const d = item.data || {};
    const titulo = d.titulo || d.entidad || "Itinerancia";
    const municipio = d.municipio || "";
    const dias = d.dias || d.horario || "";
    const tecnico = d.tecnico_orienta || d.contacto || "";
    const direccion = d.direccion || "";
    const tel = d.telefono ? ` · Tel. ${escapeHtml(d.telefono)}` : "";
    const etiqueta = etiquetaItemUnificado(item);
    const claseAtenciones = claseEstadoAtencionesUnidad(item);
    const avisoAtenciones = textoAvisoAtencionesUnidad(item);

    return `
      <article class="item item-unificado${claseAtenciones}">
        <div class="item-unificado-main">
          <div class="item-unificado-top">
            <h3>${escapeHtml(titulo)}</h3>
            <span class="estado-badge ${estadoEtiquetaClase(item.estado)}">${escapeHtml(etiqueta)}</span>
          </div>

          <p class="muted">
            ${escapeHtml(item.tipoListado === "PROPUESTA" ? tipoPropuestaLegible(d.tipo) : item.tipoListado)}
            ${municipio ? " · " + escapeHtml(municipio) : ""}
            ${dias ? " · " + escapeHtml(dias) : ""}
          </p>

          <p>
            ${escapeHtml(direccion)}
            ${tel}
          </p>

          <p class="muted">
            ${escapeHtml(tecnico)}
            ${d.colectivo ? " · " + escapeHtml(d.colectivo) : ""}
          </p>

          ${avisoAtenciones}
          ${item.estado === "PUBLICADA" ? renderActividadesItinerancia(d.id) : ""}
        </div>

        <div class="acciones-item">
          ${accionesItemUnificado(item)}
        </div>
      </article>
    `;
  }).join("");
}

async function cargarPanel() {
  const perfil = await obtenerPerfil();
  if (!perfil) return;

  perfilActual = perfil;

  try {
    convocatoriaActual = await obtenerConvocatoriaVigente();
  } catch (err) {
    console.error(err);
    mostrarMsg("No se ha podido detectar la convocatoria vigente.", true);
    return;
  }

  const unidadNombre = perfil.unidades?.nombre || "Unidad sin asignar";

  const info = $("usuarioInfo");
  if (info) {
    info.textContent = `${perfil.nombre || perfil.email} · ${unidadNombre} · ${convocatoriaActual.nombre}`;
  }

  try {
    const [publicadas, propuestas] = await Promise.all([
      cargarItineranciasPublicadasEntidad(convocatoriaActual.id, perfil),
      cargarPropuestasEntidad(convocatoriaActual.id, perfil.unidad_id)
    ]);

    publicadasActuales = publicadas;
    propuestasActuales = propuestas;
    await cargarActividadesUnidad(convocatoriaActual.id);

    renderPanelUnificado();

  } catch (error) {
    console.error(error);
    mostrarMsg("No se han podido cargar los datos: " + error.message, true);
  }
}


function setValorFormulario(id, valor) {
  const el = $(id);
  if (el) el.value = valor ?? "";
}

function getTipoPropuestaFormulario() {
  return String($("tipo")?.value || "NUEVA").toUpperCase();
}

function requiereItineranciaExistente() {
  const tipo = getTipoPropuestaFormulario();
  return tipo === "MODIFICACION" || tipo === "BAJA";
}

function textoItineranciaOpcionFormulario(i) {
  return [
    i.municipio,
    i.titulo || i.entidad,
    i.horario || i.dias,
    i.direccion
  ].filter(Boolean).join(" · ");
}

function rellenarFormularioDesdeItineranciaPublicada(idPublicada, opciones = {}) {
  const i = publicadasFormularioActuales.find(x => String(x.id) === String(idPublicada));
  if (!i) return;

  const forzar = opciones.forzar !== false;

  const set = (id, valor) => {
    const el = $(id);
    if (!el) return;
    if (forzar || !String(el.value || "").trim()) {
      el.value = valor ?? "";
    }
  };

  set("municipio", i.municipio || "");
  set("direccion", i.direccion || "");
  set("horario", i.horario || i.dias || "");
  set("frecuencia", i.frecuencia || "");
  set("fechaInicio", i.fecha_inicio || "");
  set("fechaFin", i.fecha_fin || "");
  set("contacto", i.contacto || i.tecnico_orienta || "");
  set("telefono", i.telefono || "");
  set("emailContacto", i.email || "");
  set("observacionesPublicas", i.observaciones_publicas || "");
}

async function cargarItineranciasFormulario() {
  if (!$("formNuevaItinerancia")) return [];

  const perfil = await obtenerPerfil();
  if (!perfil) return [];

  const convocatoria = await obtenerConvocatoriaVigente();
  const lista = await cargarItineranciasPublicadasEntidad(convocatoria.id, perfil);

  publicadasFormularioActuales = lista || [];

  const select = $("itineranciaPublicadaId");
  if (select) {
    const valorActual = select.value || "";

    select.innerHTML = `
      <option value="">Seleccionar itinerancia...</option>
      ${publicadasFormularioActuales
        .slice()
        .sort((a, b) => textoItineranciaOpcionFormulario(a).localeCompare(textoItineranciaOpcionFormulario(b), "es"))
        .map(i => `<option value="${escapeHtml(i.id)}">${escapeHtml(textoItineranciaOpcionFormulario(i))}</option>`)
        .join("")}
    `;

    if (valorActual && publicadasFormularioActuales.some(i => String(i.id) === String(valorActual))) {
      select.value = valorActual;
    }
  }

  return publicadasFormularioActuales;
}

async function actualizarTipoPropuestaFormulario(opciones = {}) {
  const bloque = $("bloqueItineranciaExistente");
  const select = $("itineranciaPublicadaId");
  const mostrar = requiereItineranciaExistente();

  if (bloque) bloque.classList.toggle("oculto", !mostrar);
  if (select) select.required = mostrar;

  if (!mostrar) {
    if (select) select.value = "";
    return;
  }

  if (!publicadasFormularioActuales.length) {
    await cargarItineranciasFormulario();
  }

  if (select?.value && opciones.rellenar !== false) {
    rellenarFormularioDesdeItineranciaPublicada(select.value, { forzar: true });
  }
}

function datosFormularioItinerancia(estado) {
  const dias = $("horario")?.value.trim() || null;
  const tipo = getTipoPropuestaFormulario();

  const payload = {
    tipo,
    estado,
    titulo: "",
    descripcion: null,
    municipio: $("municipio")?.value.trim() || null,
    direccion: $("direccion")?.value.trim() || null,
    horario: dias,
    frecuencia: $("frecuencia")?.value.trim() || null,
    fecha_inicio: $("fechaInicio")?.value || null,
    fecha_fin: $("fechaFin")?.value || null,
    contacto: $("contacto")?.value.trim() || null,
    telefono: $("telefono")?.value.trim() || null,
    email: $("emailContacto")?.value.trim() || null,
    observaciones_publicas: $("observacionesPublicas")?.value.trim() || null,
    observaciones_unidad: $("observacionesUnidad")?.value.trim() || null
  };

  if (tipo === "MODIFICACION" || tipo === "BAJA") {
    payload.itinerancia_publicada_id = $("itineranciaPublicadaId")?.value || null;
  } else {
    payload.itinerancia_publicada_id = null;
  }

  return payload;
}




function generarTituloPropuesta(perfil, payload) {
  const unidad = perfil?.unidades?.nombre || "Unidad";
  const municipio = payload?.municipio || "Itinerancia";
  return `${unidad} - ${municipio}`;
}


async function aplicarFechaFinConvocatoriaPorDefecto() {
  if (!$("formNuevaItinerancia") || !$("fechaFin")) return;

  try {
    const convocatoria = await obtenerConvocatoriaVigente();

    if (convocatoria?.fecha_fin && !$("fechaFin").value) {
      $("fechaFin").value = String(convocatoria.fecha_fin).slice(0, 10);
    }
  } catch (err) {
    console.error(err);
    // No bloqueamos el formulario si no puede detectarse la fecha.
  }
}

async function guardarPropuesta(estado) {
  const perfil = await obtenerPerfil();
  if (!perfil) return;

  let convocatoria;

  try {
    convocatoria = await obtenerConvocatoriaVigente();
  } catch (err) {
    console.error(err);
    mostrarMsg("No se ha podido detectar la convocatoria vigente. No se puede guardar la propuesta.", true);
    return;
  }

  const payload = datosFormularioItinerancia(estado);

  if (["MODIFICACION", "BAJA"].includes(String(payload.tipo || "").toUpperCase()) && !payload.itinerancia_publicada_id) {
    mostrarMsg("Debes seleccionar la itinerancia existente sobre la que solicitas la modificación o baja.", true);
    return;
  }

  if (!payload.municipio) {
    mostrarMsg("El municipio es obligatorio.", true);
    return;
  }

  if (!payload.horario) {
    mostrarMsg("El campo Día/Días es obligatorio.", true);
    return;
  }

  if (!payload.frecuencia) {
    mostrarMsg("La frecuencia es obligatoria.", true);
    return;
  }

  payload.titulo = generarTituloPropuesta(perfil, payload);

  payload.unidad_id = perfil.unidad_id;
  payload.creada_por = perfil.id;
  payload.convocatoria_id = convocatoria.id;

  if (estado === "PENDIENTE_VALIDACION") {
    payload.enviada_at = new Date().toISOString();
  }

  const idPropuesta = obtenerIdPropuestaEdicion();

  let error;

  if (idPropuesta) {
    const res = await supabaseClient
      .from("itinerancias_propuestas")
      .update(payload)
      .eq("id", idPropuesta);

    error = res.error;
  } else {
    const res = await supabaseClient
      .from("itinerancias_propuestas")
      .insert(payload);

    error = res.error;
  }

  if (error) {
    console.error(error);
    mostrarMsg("No se ha podido guardar la propuesta: " + error.message, true);
    return;
  }

  mostrarMsg(
    estado === "BORRADOR"
      ? "Borrador guardado correctamente."
      : "Propuesta enviada a validación correctamente."
  );

  setTimeout(() => {
    window.location.href = "panel.html";
  }, 900);
}


function hoyISO() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
}

function setValorActividad(id, valor) {
  const el = $(id);
  if (el) el.value = valor ?? "";
}

function getValorActividad(id) {
  const el = $(id);
  return el ? String(el.value ?? "").trim() : "";
}

function minutosActividad() {
  const hTxt = getValorActividad("actividadHoras");
  const mTxt = getValorActividad("actividadMinutos");

  if (hTxt === "" || mTxt === "") {
    return null;
  }

  const h = Number(hTxt);
  const m = Number(mTxt);

  if (!Number.isInteger(h) || !Number.isInteger(m)) {
    return null;
  }

  return h * 60 + m;
}


function textoFiltroActividad(a) {
  return [
    fechaES(a.fecha_actividad),
    a.fecha_actividad,
    a.personal_tecnico,
    a.numero_atenciones,
    a.tipo_atencion,
    formatoTiempo(a.tiempo_total_minutos),
    a.observaciones
  ].join(" ").toLowerCase();
}

function renderListadoActividadesModal() {
  const cont = $("contenidoListadoActividades");
  if (!cont || !itineranciaListadoActividadesActual) return;

  const filtro = String($("filtroActividades")?.value || "").trim().toLowerCase();

  let actividades = actividadesDeItinerancia(itineranciaListadoActividadesActual.id);

  if (filtro) {
    actividades = actividades.filter(a => textoFiltroActividad(a).includes(filtro));
  }

  if (!actividades.length) {
    cont.innerHTML = `<p class="muted sin-resultados-actividad">No hay actividades que coincidan con el filtro.</p>`;
    return;
  }

  cont.innerHTML = `
    <div class="actividad-tabla-cabecera">
      <span>Fecha</span>
      <span>Técnico/a</span>
      <span>Atenc.</span>
      <span>Tipo</span>
      <span>Tiempo</span>
      <span>Observaciones</span>
      <span></span>
    </div>
    ${actividades.map(a => `
      <div class="actividad-tabla-row">
        <span>${escapeHtml(fechaES(a.fecha_actividad))}</span>
        <span title="${escapeHtml(a.personal_tecnico || "")}">${escapeHtml(a.personal_tecnico || "-")}</span>
        <span>${escapeHtml(String(a.numero_atenciones ?? 0))}</span>
        <span title="${escapeHtml(a.tipo_atencion || "")}">${escapeHtml(a.tipo_atencion || "-")}</span>
        <span>${escapeHtml(formatoTiempo(a.tiempo_total_minutos))}</span>
        <span title="${escapeHtml(a.observaciones || "")}">${escapeHtml(a.observaciones || "-")}</span>
        <span>
          <button class="btn mini secundario" onclick="abrirModalActividad('${escapeHtml(itineranciaListadoActividadesActual.id)}', '${escapeHtml(a.id)}')">
            Editar
          </button>
        </span>
      </div>
    `).join("")}
  `;
}

window.abrirModalListadoActividades = function abrirModalListadoActividades(idPublicada) {
  const itinerancia = publicadasActuales.find(i => String(i.id) === String(idPublicada));

  if (!itinerancia) {
    mostrarMsg("No se ha encontrado la itinerancia seleccionada.", true);
    return;
  }

  itineranciaListadoActividadesActual = itinerancia;

  const titulo = $("listadoActividadesTitulo");
  if (titulo) titulo.textContent = "Registro de Atenciones";

  const subtitulo = $("listadoActividadesSubtitulo");
  if (subtitulo) {
    subtitulo.textContent = [
      itinerancia.municipio || "",
      itinerancia.dias || itinerancia.horario || "",
      perfilActual?.unidades?.nombre || itinerancia.entidad || ""
    ].filter(Boolean).join(" · ");
  }

  const filtro = $("filtroActividades");
  if (filtro) filtro.value = "";

  renderListadoActividadesModal();
  $("modalListadoActividades").showModal();
};

window.abrirModalActividad = function abrirModalActividad(idPublicada, idActividad = null) {
  const itinerancia = publicadasActuales.find(i => String(i.id) === String(idPublicada));

  if (!itinerancia) {
    mostrarMsg("No se ha encontrado la itinerancia seleccionada.", true);
    return;
  }

  const actividad = idActividad
    ? actividadesActuales.find(a => String(a.id) === String(idActividad))
    : null;

  if (idActividad && !actividad) {
    mostrarMsg("No se ha encontrado la actividad seleccionada.", true);
    return;
  }

  itineranciaActividadActual = itinerancia;

  const totalMin = actividad ? Number(actividad.tiempo_total_minutos || 0) : null;
  const horas = actividad ? Math.floor(totalMin / 60) : "";
  const minutos = actividad ? totalMin % 60 : "";

  setValorActividad("actividadRegistroId", actividad?.id || "");
  setValorActividad("actividadItineranciaId", itinerancia.id);
  setValorActividad("actividadFecha", actividad?.fecha_actividad || hoyISO());
  setValorActividad("actividadTecnico", actividad?.personal_tecnico || itinerancia.contacto || itinerancia.tecnico_orienta || "");
  setValorActividad("actividadAtenciones", actividad?.numero_atenciones ?? "");
  setValorActividad("actividadTipo", actividad?.tipo_atencion || "");
  setValorActividad("actividadHoras", horas);
  setValorActividad("actividadMinutos", minutos === "" ? "" : String(minutos));
  setValorActividad("actividadObservaciones", actividad?.observaciones || "");
  mostrarMsgActividad("");

  const titulo = $("actividadModalTitulo");
  if (titulo) {
    titulo.textContent = actividad ? "Editar actividad" : "Registrar atenciones";
  }

  const info = $("actividadInfo");
  if (info) {
    info.innerHTML = `
      <p><strong>Unidad:</strong> ${escapeHtml(perfilActual?.unidades?.nombre || itinerancia.entidad || "")}</p>
      <p><strong>Municipio:</strong> ${escapeHtml(itinerancia.municipio || "")}</p>
      <p><strong>Día/Días:</strong> ${escapeHtml(itinerancia.dias || itinerancia.horario || "")}</p>
      <p><strong>Colectivo:</strong> ${escapeHtml(itinerancia.colectivo || "")}</p>
      ${actividad ? `<p><strong>Registro:</strong> ${escapeHtml(fechaES(actividad.fecha_actividad))}</p>` : ""}
    `;
  }

  $("modalActividad").showModal();
};

async function guardarActividadItinerancia() {
  if (!perfilActual || !convocatoriaActual || !itineranciaActividadActual) {
    mostrarMsgActividad("No se ha podido identificar la unidad, convocatoria o itinerancia.", true);
    return;
  }

  const fecha = getValorActividad("actividadFecha");
  const tecnico = getValorActividad("actividadTecnico");
  const tipo = getValorActividad("actividadTipo");
  const atencionesTexto = getValorActividad("actividadAtenciones");
  const horasTexto = getValorActividad("actividadHoras");
  const minutosTexto = getValorActividad("actividadMinutos");
  const atenciones = Number(atencionesTexto);
  const totalMin = minutosActividad();
  const observaciones = getValorActividad("actividadObservaciones");

  if (!fecha) {
    mostrarMsgActividad("La fecha de las atenciones es obligatoria.", true);
    return;
  }

  if (!tecnico) {
    mostrarMsgActividad("El personal técnico es obligatorio.", true);
    return;
  }

  if (atencionesTexto === "" || !Number.isInteger(atenciones) || atenciones < 0) {
    mostrarMsgActividad("El número de atenciones es obligatorio y debe ser 0 o superior.", true);
    return;
  }

  if (atenciones > 0 && !tipo) {
    mostrarMsgActividad("El tipo de atención es obligatorio cuando hay una o más atenciones.", true);
    return;
  }

  if (horasTexto === "") {
    mostrarMsgActividad("Debes indicar las horas, aunque sean 0.", true);
    return;
  }

  if (minutosTexto === "") {
    mostrarMsgActividad("Debes indicar los minutos, aunque sean 00.", true);
    return;
  }

  if (totalMin === null) {
    mostrarMsgActividad("El tiempo total no es válido.", true);
    return;
  }

  if (totalMin > 420) {
    mostrarMsgActividad("El tiempo total no puede superar 07:00 horas.", true);
    return;
  }

  if (totalMin > 0 && totalMin < 1) {
    mostrarMsgActividad("El tiempo mínimo es 00:01.", true);
    return;
  }

  if (totalMin === 0 && observaciones.length < 5) {
    mostrarMsgActividad("Si el tiempo total es 00:00, las observaciones son obligatorias.", true);
    return;
  }

  const idActividad = getValorActividad("actividadRegistroId");

  const payload = {
    itinerancia_publicada_id: itineranciaActividadActual.id,
    unidad_id: perfilActual.unidad_id,
    convocatoria_id: convocatoriaActual.id,
    fecha_actividad: fecha,
    personal_tecnico: tecnico,
    numero_atenciones: atenciones,
    tipo_atencion: tipo || null,
    tiempo_total_minutos: totalMin,
    observaciones: observaciones || null
  };

  let error;

  if (idActividad) {
    const res = await supabaseClient
      .from("actividad_itinerancias")
      .update(payload)
      .eq("id", idActividad)
      .eq("unidad_id", perfilActual.unidad_id);

    error = res.error;
  } else {
    const res = await supabaseClient
      .from("actividad_itinerancias")
      .insert({
        ...payload,
        creada_por: perfilActual.id
      });

    error = res.error;
  }

  if (error) {
    console.error(error);
    mostrarMsgActividad("No se han podido guardar las atenciones: " + error.message, true);
    return;
  }

  $("modalActividad").close();
  mostrarMsgActividad("");

  await cargarActividadesUnidad(convocatoriaActual.id);
  renderPanelUnificado();

  if ($("modalListadoActividades")?.open) {
    renderListadoActividadesModal();
  }

  mostrarMsg(idActividad ? "Actividad actualizada correctamente." : "Registro de Atenciones correctamente.");
}

async function crearPropuestaModificacion(idPublicada) {
  if (!perfilActual || !convocatoriaActual) {
    mostrarMsg("No se ha podido cargar tu perfil o la convocatoria.", true);
    return;
  }

  const original = publicadasActuales.find(i => String(i.id) === String(idPublicada));

  if (!original) {
    mostrarMsg("No se ha encontrado la itinerancia seleccionada.", true);
    return;
  }

  const payload = {
    tipo: "MODIFICACION",
    estado: "BORRADOR",
    titulo: original.titulo || original.entidad || "Modificación de itinerancia",
    descripcion: original.descripcion || null,
    municipio: original.municipio || null,
    direccion: original.direccion || null,
    horario: original.horario || original.dias || null,
    frecuencia: original.frecuencia || original.dias || null,
    fecha_inicio: original.fecha_inicio || null,
    fecha_fin: original.fecha_fin || null,
    contacto: original.contacto || original.tecnico_orienta || null,
    telefono: original.telefono || null,
    email: original.email || null,
    observaciones_publicas: original.observaciones_publicas || null,
    observaciones_unidad: "Propuesta creada a partir de una itinerancia publicada para solicitar modificación.",
    unidad_id: perfilActual.unidad_id,
    creada_por: perfilActual.id,
    convocatoria_id: convocatoriaActual.id,
    itinerancia_publicada_id: original.id
  };

  const { data, error } = await supabaseClient
    .from("itinerancias_propuestas")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    console.error(error);
    mostrarMsg("No se ha podido crear la propuesta de modificación: " + error.message, true);
    return;
  }

  window.location.href = `nueva-itinerancia.html?propuesta=${encodeURIComponent(data.id)}`;
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[ch]));
}

function obtenerIdPropuestaEdicion() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id") || params.get("propuesta");
}

function setValor(id, valor) {
  const el = $(id);
  if (el) el.value = valor ?? "";
}

async function cargarPropuestaParaEditar() {
  const idPropuesta = obtenerIdPropuestaEdicion();
  if (!idPropuesta || !$("formNuevaItinerancia")) return;

  const perfil = await obtenerPerfil();
  if (!perfil) return;

  const { data, error } = await supabaseClient
    .from("itinerancias_propuestas")
    .select("*")
    .eq("id", idPropuesta)
    .maybeSingle();

  if (error) {
    console.error(error);
    mostrarMsg("No se ha podido cargar la propuesta para editar.", true);
    return;
  }

  if (!data) {
    mostrarMsg("No se ha encontrado la propuesta.", true);
    return;
  }

  if (!["BORRADOR", "RECHAZADA"].includes(String(data.estado || ""))) {
    mostrarMsg("Esta propuesta ya no se puede editar porque está enviada o publicada.", true);
    return;
  }

  setValorFormulario("tipo", data.tipo || "NUEVA");

  await actualizarTipoPropuestaFormulario({ rellenar: false });

  if (data.itinerancia_publicada_id) {
    setValorFormulario("itineranciaPublicadaId", data.itinerancia_publicada_id);
  }

  setValorFormulario("municipio", data.municipio);
  setValorFormulario("direccion", data.direccion);
  setValorFormulario("horario", data.horario);
  setValorFormulario("frecuencia", data.frecuencia);
  setValorFormulario("fechaInicio", data.fecha_inicio);
  setValorFormulario("fechaFin", data.fecha_fin);
  setValorFormulario("contacto", data.contacto);
  setValorFormulario("telefono", data.telefono);
  setValorFormulario("emailContacto", data.email);
  setValorFormulario("observacionesPublicas", data.observaciones_publicas);
  setValorFormulario("observacionesUnidad", data.observaciones_unidad);

  const h1 = document.querySelector("h1");
  if (h1) h1.textContent = "Editar propuesta de itinerancia";

  mostrarMsg("Editando borrador de propuesta.");
}

document.addEventListener("DOMContentLoaded", () => {
  prepararSolicitudAccesoUnidadConvocatoria();
  if ($("formNuevaItinerancia")) {
    cargarItineranciasFormulario()
      .then(() => actualizarTipoPropuestaFormulario({ rellenar: false }))
      .then(() => cargarPropuestaParaEditar())
      .catch(err => {
        console.error(err);
        mostrarMsg("No se han podido cargar las itinerancias existentes.", true);
      });
  }

  const tipoPropuesta = $("tipo");
  if (tipoPropuesta) {
    tipoPropuesta.addEventListener("change", async () => {
      await actualizarTipoPropuestaFormulario({ rellenar: true });
    });
  }

  const selectItineranciaPublicada = $("itineranciaPublicadaId");
  if (selectItineranciaPublicada) {
    selectItineranciaPublicada.addEventListener("change", () => {
      if (selectItineranciaPublicada.value) {
        rellenarFormularioDesdeItineranciaPublicada(selectItineranciaPublicada.value, { forzar: true });
      }
    });
  }


  aplicarFechaFinConvocatoriaPorDefecto();
  const formLogin = $("formLogin");
  if (formLogin) {
    formLogin.addEventListener("submit", async e => {
      e.preventDefault();
      await login($("loginEmail").value.trim(), $("loginPassword").value);
    });
  }

  const formSolicitud = $("formSolicitudAcceso");
  if (formSolicitud) {
    formSolicitud.addEventListener("submit", async e => {
      e.preventDefault();

      await solicitarAcceso({
        nombre: $("solNombre").value.trim(),
        email: $("solEmail").value.trim(),
        telefono: $("solTelefono").value.trim() || null,
        unidad_id: $("solUnidadId")?.value || null,
        unidad_nombre: $("solUnidad").value.trim(),
        cargo: $("solCargo").value.trim() || null,
        observaciones: $("solObservaciones").value.trim() || null,
        estado: "PENDIENTE"
      });
    });
  }

  const btnLogout = $("btnLogout");
  if (btnLogout) {
    btnLogout.addEventListener("click", logout);
  }

  if ($("listaPropuestas")) {
    cargarPanel();
  }

  const formNueva = $("formNuevaItinerancia");
  if (formNueva) {
    formNueva.addEventListener("submit", async e => {
      e.preventDefault();
      await guardarPropuesta("PENDIENTE_VALIDACION");
    });
  }

  const btnGuardarBorrador = $("btnGuardarBorrador");
  if (btnGuardarBorrador) {
    btnGuardarBorrador.addEventListener("click", async () => {
      await guardarPropuesta("BORRADOR");
    });
  }

  const btnGuardarActividad = $("btnGuardarActividad");
  if (btnGuardarActividad) {
    btnGuardarActividad.addEventListener("click", async () => {
      await guardarActividadItinerancia();
    });
  }

  const btnCancelarActividad = $("btnCancelarActividad");
  if (btnCancelarActividad) {
    btnCancelarActividad.addEventListener("click", () => {
      $("modalActividad").close();
    });
  }

  const btnCerrarListadoActividades = $("btnCerrarListadoActividades");
  if (btnCerrarListadoActividades) {
    btnCerrarListadoActividades.addEventListener("click", () => {
      $("modalListadoActividades").close();
    });
  }

  const filtroActividades = $("filtroActividades");
  if (filtroActividades) {
    filtroActividades.addEventListener("input", () => {
      renderListadoActividadesModal();
    });
  }

  const filtroPanelUnificado = $("filtroPanelUnificado");
  if (filtroPanelUnificado) {
    filtroPanelUnificado.addEventListener("input", () => {
      renderPanelUnificado();
    });
  }

  const filtroEstadoUnificado = $("filtroEstadoUnificado");
  if (filtroEstadoUnificado) {
    filtroEstadoUnificado.addEventListener("change", () => {
      filtroAtencionesUnidadResumen = "TODAS";
      renderPanelUnificado();
    });
  }
});


// === RESUMEN_ATENCIONES_UNIDAD_V1 ===
let filtroAtencionesUnidadResumen = "TODAS";
let actividadResumenUnidadCache = new Map();
let actividadResumenUnidadListaCargadaKey = "";
let repintandoPanelPorActividadUnidad = false;
let publicadasResumenUnidadBase = [];
let nombreUnidadResumenActual = "";
let renderItineranciasPublicadasOriginalUnidad = null;

function escResumenUnidad(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clienteSupabaseResumenUnidad() {
  if (typeof supabase !== "undefined" && supabase && typeof supabase.from === "function") return supabase;
  if (typeof supabaseClient !== "undefined" && supabaseClient && typeof supabaseClient.from === "function") return supabaseClient;
  if (typeof sb !== "undefined" && sb && typeof sb.from === "function") return sb;
  if (window.supabaseClient && typeof window.supabaseClient.from === "function") return window.supabaseClient;
  if (window.sb && typeof window.sb.from === "function") return window.sb;
  throw new Error("No se ha localizado el cliente de Supabase.");
}

function idPublicadaResumenUnidad(p) {
  return p?.id || p?.itinerancia_publicada_id || p?.publicada_id || "";
}

function frecuenciaResumenUnidad(p) {
  return String(p?.frecuencia || p?.periodicidad || p?.dias || p?.horario || "").toLowerCase();
}

function umbralDesactualizadaUnidad(p) {
  const f = frecuenciaResumenUnidad(p);

  if (f.includes("seman")) return 10;
  if (f.includes("quinc") || f.includes("altern")) return 20;
  if (f.includes("mens")) return 35;

  // Puntual / cita / demanda: no se considera desactualizada por días.
  if (f.includes("puntual") || f.includes("cita") || f.includes("demanda")) return null;

  return 20;
}

function diasDesdeFechaResumenUnidad(fechaISO) {
  if (!fechaISO) return null;

  const hoy = new Date();
  const fecha = new Date(`${fechaISO}T00:00:00`);

  if (Number.isNaN(fecha.getTime())) return null;

  hoy.setHours(0, 0, 0, 0);
  fecha.setHours(0, 0, 0, 0);

  return Math.floor((hoy - fecha) / 86400000);
}

function resumenActividadPublicadaUnidad(p) {
  const id = idPublicadaResumenUnidad(p);
  return actividadResumenUnidadCache.get(id) || {
    registros: 0,
    totalAtenciones: 0,
    totalMinutos: 0,
    ultimaFecha: null
  };
}

function estadoAtencionesPublicadaUnidad(p) {
  const id = idPublicadaResumenUnidad(p);
  const ids = [...new Set((publicadasResumenUnidadBase || []).map(idPublicadaResumenUnidad).filter(Boolean))];
  const key = ids.slice().sort().join("|");

  /*
    Mientras la actividad no está cargada, no clasificamos como SIN.
    Así evitamos pintar en naranja itinerancias que sí tienen atenciones.
  */
  if (key && actividadResumenUnidadListaCargadaKey !== key) {
    return "CARGANDO";
  }

  const r = resumenActividadPublicadaUnidad(p);

  if (!r.registros || !r.totalAtenciones) return "SIN";

  const umbral = umbralDesactualizadaUnidad(p);
  const dias = diasDesdeFechaResumenUnidad(r.ultimaFecha);

  if (umbral !== null && dias !== null && dias > umbral) return "DESACTUALIZADAS";

  return "RECIENTES";
}

function formatoTiempoResumenUnidad(minutos) {
  const total = Number(minutos || 0);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

async function cargarActividadResumenUnidad(lista) {
  const ids = [...new Set((lista || []).map(idPublicadaResumenUnidad).filter(Boolean))];
  const key = ids.slice().sort().join("|");

  actividadResumenUnidadCache = new Map();
  actividadResumenUnidadListaCargadaKey = "";

  for (const id of ids) {
    actividadResumenUnidadCache.set(id, {
      registros: 0,
      totalAtenciones: 0,
      totalMinutos: 0,
      ultimaFecha: null
    });
  }

  if (!ids.length) {
    actividadResumenUnidadListaCargadaKey = key;
    return;
  }

  const cliente = clienteSupabaseResumenUnidad();

  for (let i = 0; i < ids.length; i += 80) {
    const lote = ids.slice(i, i + 80);

    const { data, error } = await cliente
      .from("actividad_itinerancias")
      .select("itinerancia_publicada_id, fecha_actividad, numero_atenciones, tiempo_total_minutos")
      .in("itinerancia_publicada_id", lote);

    if (error) throw error;

    for (const r of data || []) {
      const id = r.itinerancia_publicada_id;
      const actual = actividadResumenUnidadCache.get(id) || {
        registros: 0,
        totalAtenciones: 0,
        totalMinutos: 0,
        ultimaFecha: null
      };

      actual.registros += 1;
      actual.totalAtenciones += Number(r.numero_atenciones || 0);
      actual.totalMinutos += Number(r.tiempo_total_minutos || 0);

      const fecha = r.fecha_actividad || null;
      if (fecha && (!actual.ultimaFecha || String(fecha) > String(actual.ultimaFecha))) {
        actual.ultimaFecha = fecha;
      }

      actividadResumenUnidadCache.set(id, actual);
    }
  }

  actividadResumenUnidadListaCargadaKey = key;
}

function asegurarBloqueResumenAtencionesUnidad() {
  let bloque = document.getElementById("resumenAtencionesUnidad");

  if (!bloque) {
    bloque = document.createElement("section");
    bloque.id = "resumenAtencionesUnidad";
    bloque.className = "resumen-atenciones-unidad resumen-atenciones-unidad-superior";

    bloque.innerHTML = `
      <div class="resumen-atenciones-unidad-cabecera">
        <h2>Resumen de Atenciones de mi unidad</h2>
        <p>Datos calculados únicamente sobre las itinerancias publicadas de esta unidad.</p>
      </div>
      <div id="resumenAtencionesUnidadCards" class="resumen-atenciones-unidad-cards"></div>
    `;
  }

  /*
    Ubicación correcta:
    debajo del título principal/cabecera del panel, NO dentro de
    "Mis itinerancias y propuestas".
  */
  const main = document.querySelector("main.container") || document.querySelector("main") || document.body;
  const panelUnificado = document.querySelector(".panel-unificado");
  const msg = document.getElementById("msg");

  if (panelUnificado && panelUnificado.parentElement) {
    panelUnificado.parentElement.insertBefore(bloque, panelUnificado);
  } else if (msg && msg.parentElement) {
    msg.insertAdjacentElement("afterend", bloque);
  } else {
    main.prepend(bloque);
  }

  return bloque;
}

function renderResumenAtencionesUnidad(lista) {
  const bloque = asegurarBloqueResumenAtencionesUnidad();
  const cont = document.getElementById("resumenAtencionesUnidadCards");

  if (!cont) return;

  const base = Array.isArray(lista) ? lista : [];

  const total = base.length;
  const sin = base.filter(p => estadoAtencionesPublicadaUnidad(p) === "SIN").length;
  const recientes = base.filter(p => estadoAtencionesPublicadaUnidad(p) === "RECIENTES").length;
  const desactualizadas = base.filter(p => estadoAtencionesPublicadaUnidad(p) === "DESACTUALIZADAS").length;
  const con = Math.max(0, total - sin);

  const totalAtenciones = base.reduce((acc, p) => acc + resumenActividadPublicadaUnidad(p).totalAtenciones, 0);
  const totalMinutos = base.reduce((acc, p) => acc + resumenActividadPublicadaUnidad(p).totalMinutos, 0);

  const activo = filtroAtencionesUnidadResumen || "TODAS";
  const cls = valor => activo === valor ? " activo" : "";

  cont.innerHTML = `
    <button type="button" class="resumen-atencion-unidad-card${cls("TODAS")}" onclick="filtrarResumenAtencionesUnidad('TODAS')">
      <strong>${escResumenUnidad(total)}</strong>
      <span>Itinerancias publicadas</span>
    </button>

    <button type="button" class="resumen-atencion-unidad-card${cls("CON")}" onclick="filtrarResumenAtencionesUnidad('CON')">
      <strong>${escResumenUnidad(con)}</strong>
      <span>Con atenciones registradas</span>
    </button>

    <button type="button" class="resumen-atencion-unidad-card alerta${cls("SIN")}" onclick="filtrarResumenAtencionesUnidad('SIN')">
      <strong>${escResumenUnidad(sin)}</strong>
      <span>Sin atenciones</span>
    </button>

    <button type="button" class="resumen-atencion-unidad-card aviso${cls("DESACTUALIZADAS")}" onclick="filtrarResumenAtencionesUnidad('DESACTUALIZADAS')">
      <strong>${escResumenUnidad(desactualizadas)}</strong>
      <span>Desactualizadas</span>
    </button>

    <button type="button" class="resumen-atencion-unidad-card${cls("TODAS")}" onclick="filtrarResumenAtencionesUnidad('TODAS')">
      <strong>${escResumenUnidad(totalAtenciones)}</strong>
      <span>Total atenciones</span>
    </button>

    <button type="button" class="resumen-atencion-unidad-card${cls("TODAS")}" onclick="filtrarResumenAtencionesUnidad('TODAS')">
      <strong>${escResumenUnidad(formatoTiempoResumenUnidad(totalMinutos))}</strong>
      <span>Tiempo total</span>
    </button>
  `;

  bloque.classList.remove("oculto");
}

function filtrarListaAtencionesUnidad(lista) {
  const filtro = String(filtroAtencionesUnidadResumen || "TODAS").toUpperCase();
  const base = Array.isArray(lista) ? lista : [];

  if (filtro === "TODAS") return base;
  if (filtro === "CON") return base.filter(p => estadoAtencionesPublicadaUnidad(p) !== "SIN");
  if (filtro === "SIN") return base.filter(p => estadoAtencionesPublicadaUnidad(p) === "SIN");
  if (filtro === "RECIENTES") return base.filter(p => estadoAtencionesPublicadaUnidad(p) === "RECIENTES");
  if (filtro === "DESACTUALIZADAS") return base.filter(p => estadoAtencionesPublicadaUnidad(p) === "DESACTUALIZADAS");

  return base;
}

window.filtrarResumenAtencionesUnidad = function filtrarResumenAtencionesUnidad(tipo) {
  filtroAtencionesUnidadResumen = String(tipo || "TODAS").toUpperCase();

  renderResumenAtencionesUnidad(publicadasResumenUnidadBase);
  renderAvisoSuperiorAtencionesUnidad();
        renderAvisoSuperiorAtencionesUnidad();

  if (typeof renderPanelUnificado === "function") {
    renderPanelUnificado();
    return;
  }

  if (typeof renderItineranciasPublicadas === "function") {
    renderItineranciasPublicadas(publicadasResumenUnidadBase, nombreUnidadResumenActual);
  }
};;

function instalarResumenAtencionesUnidad() {
  if (typeof renderItineranciasPublicadas !== "function") {
    console.warn("No se ha localizado renderItineranciasPublicadas para instalar el resumen de atenciones.");
    return;
  }

  if (renderItineranciasPublicadasOriginalUnidad) return;

  renderItineranciasPublicadasOriginalUnidad = renderItineranciasPublicadas;

  renderItineranciasPublicadas = function renderItineranciasPublicadasConResumen(lista, unidadNombre) {
    publicadasResumenUnidadBase = Array.isArray(lista) ? lista : [];
    nombreUnidadResumenActual = unidadNombre || nombreUnidadResumenActual || "";

    const filtrada = filtrarListaAtencionesUnidad(publicadasResumenUnidadBase);

    renderItineranciasPublicadasOriginalUnidad.call(this, filtrada, unidadNombre);

    cargarActividadResumenUnidad(publicadasResumenUnidadBase)
      .then(() => {
        renderResumenAtencionesUnidad(publicadasResumenUnidadBase);

        if (filtroAtencionesUnidadResumen !== "TODAS") {
          const filtradaActualizada = filtrarListaAtencionesUnidad(publicadasResumenUnidadBase);
          renderItineranciasPublicadasOriginalUnidad.call(this, filtradaActualizada, unidadNombre);
        }
      })
      .catch(err => {
        console.error(err);
        const bloque = asegurarBloqueResumenAtencionesUnidad();
        const cont = document.getElementById("resumenAtencionesUnidadCards");
        if (cont) {
          cont.innerHTML = `<p class="msg error">No se ha podido cargar el resumen de atenciones de la unidad.</p>`;
        }
        bloque.classList.remove("oculto");
      });
  };
}

instalarResumenAtencionesUnidad();
// === FIN_RESUMEN_ATENCIONES_UNIDAD_V1 ===


// === RESUMEN_ATENCIONES_UNIDAD_PANEL_UNIFICADO_V1 ===
function vistaResumenUnidadPermiteMostrar() {
  const valor = String(
    document.getElementById("filtroEstadoUnificado")?.value ||
    document.getElementById("filtroEstado")?.value ||
    ""
  ).toUpperCase();

  /*
    En panel.html la opción Publicadas tiene value="PUBLICADA".
    Activas y Todas también deben mostrar el resumen.
  */
  return valor === "PUBLICADA" || valor === "PUBLICADAS" || valor === "ACTIVAS" || valor === "TODAS" || valor === "";
}

function obtenerPublicadasDesdePanelUnificadoUnidad() {
  const posibles = [
    window.publicadasActuales,
    window.itineranciasPublicadasActuales,
    window.publicadasActualesUnidad,
    window.itineranciasPublicadas,
    typeof publicadasActuales !== "undefined" ? publicadasActuales : null,
    typeof itineranciasPublicadasActuales !== "undefined" ? itineranciasPublicadasActuales : null,
    typeof publicadasActualesUnidad !== "undefined" ? publicadasActualesUnidad : null,
    typeof itineranciasPublicadas !== "undefined" ? itineranciasPublicadas : null
  ];

  for (const lista of posibles) {
    if (Array.isArray(lista) && lista.length) {
      return lista.filter(x => {
        const tipo = String(x.__tipo || x.__tipoRegistro || x.tipo || "").toUpperCase();
        const estado = String(x.estado || "").toUpperCase();

        return (
          tipo.includes("ITINERANCIA") ||
          tipo.includes("PUBLICADA") ||
          estado === "PUBLICADA" ||
          x.activa === true ||
          Object.prototype.hasOwnProperty.call(x, "publicada_at")
        );
      });
    }
  }

  if (Array.isArray(window.itemsPanelUnificadoActuales)) {
    return window.itemsPanelUnificadoActuales.filter(x => {
      const tipo = String(x.__tipo || x.__tipoRegistro || x.tipo || "").toUpperCase();
      const estado = String(x.estado || "").toUpperCase();

      return (
        tipo.includes("ITINERANCIA") ||
        tipo.includes("PUBLICADA") ||
        estado === "PUBLICADA" ||
        x.activa === true ||
        Object.prototype.hasOwnProperty.call(x, "publicada_at")
      );
    });
  }

  return [];
}

async function mostrarResumenAtencionesUnidadPanelUnificado() {
  if (!vistaResumenUnidadPermiteMostrar()) {
    const bloque = document.getElementById("resumenAtencionesUnidad");
    if (bloque) bloque.classList.add("oculto");

    const aviso = document.getElementById("avisoSuperiorAtencionesUnidad");
    if (aviso) {
      aviso.classList.add("oculto");
      aviso.innerHTML = "";
    }

    return;
  }

  const lista = obtenerPublicadasDesdePanelUnificadoUnidad();

  if (!lista.length) {
    const bloque = document.getElementById("resumenAtencionesUnidad");
    if (bloque) bloque.classList.add("oculto");

    const aviso = document.getElementById("avisoSuperiorAtencionesUnidad");
    if (aviso) {
      aviso.classList.add("oculto");
      aviso.innerHTML = "";
    }

    return;
  }

  publicadasResumenUnidadBase = lista;

  await cargarActividadResumenUnidad(publicadasResumenUnidadBase);

  renderResumenAtencionesUnidad(publicadasResumenUnidadBase);

  if (typeof renderAvisoSuperiorAtencionesUnidad === "function") {
    renderAvisoSuperiorAtencionesUnidad();
  }

  /*
    El primer render del panel se hace antes de cargar las atenciones.
    Repintamos una sola vez cuando la actividad ya está cargada para que:
    - aparezca el aviso superior al entrar;
    - no marque en naranja itinerancias que sí tienen atenciones.
  */
  if (!repintandoPanelPorActividadUnidad && typeof renderPanelUnificado === "function") {
    repintandoPanelPorActividadUnidad = true;
    try {
      renderPanelUnificado();
    } finally {
      repintandoPanelPorActividadUnidad = false;
    }
  }
}

function instalarResumenAtencionesUnidadPanelUnificado() {
  if (typeof renderPanelUnificado !== "function") {
    console.warn("No se ha localizado renderPanelUnificado para instalar resumen de atenciones de unidad.");
    return;
  }

  if (window.__resumenAtencionesUnidadPanelUnificadoInstalado) return;
  window.__resumenAtencionesUnidadPanelUnificadoInstalado = true;

  const original = renderPanelUnificado;

  renderPanelUnificado = function renderPanelUnificadoConResumenAtencionesUnidad(...args) {
    const resultado = original.apply(this, args);

    if (!repintandoPanelPorActividadUnidad) {
      setTimeout(() => {
        mostrarResumenAtencionesUnidadPanelUnificado().catch(err => {
          console.error("Error cargando resumen de atenciones de unidad:", err);
        });
      }, 0);
    }

    return resultado;
  };

  setTimeout(() => {
    mostrarResumenAtencionesUnidadPanelUnificado().catch(err => {
      console.error("Error cargando resumen inicial de atenciones de unidad:", err);
    });
  }, 250);
}

instalarResumenAtencionesUnidadPanelUnificado();
// === FIN_RESUMEN_ATENCIONES_UNIDAD_PANEL_UNIFICADO_V1 ===


// === ELIMINAR_BORRADOR_PROPUESTA_V1 ===
let propuestaBorradorEditableActual = null;

function clienteSupabaseEliminarBorrador() {
  if (typeof supabase !== "undefined" && supabase && typeof supabase.from === "function") return supabase;
  if (typeof supabaseClient !== "undefined" && supabaseClient && typeof supabaseClient.from === "function") return supabaseClient;
  if (typeof sb !== "undefined" && sb && typeof sb.from === "function") return sb;
  if (window.supabaseClient && typeof window.supabaseClient.from === "function") return window.supabaseClient;
  if (window.sb && typeof window.sb.from === "function") return window.sb;
  throw new Error("No se ha localizado el cliente de Supabase.");
}

function idPropuestaDesdeUrlEliminarBorrador() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id") || params.get("propuesta") || params.get("propuesta_id") || "";
}

function setVisibleEliminarBorrador(visible) {
  const btn = document.getElementById("btnEliminarBorrador");
  if (!btn) return;
  btn.classList.toggle("oculto", !visible);
}

async function prepararBotonEliminarBorrador() {
  const btn = document.getElementById("btnEliminarBorrador");
  if (!btn) return;

  setVisibleEliminarBorrador(false);

  const id = idPropuestaDesdeUrlEliminarBorrador();
  if (!id) return;

  const cliente = clienteSupabaseEliminarBorrador();

  const { data, error } = await cliente
    .from("itinerancias_propuestas")
    .select("id, titulo, entidad, municipio, estado")
    .eq("id", id)
    .single();

  if (error || !data) {
    console.warn("No se ha podido comprobar si la propuesta es borrador:", error);
    return;
  }

  propuestaBorradorEditableActual = data;

  if (String(data.estado || "").toUpperCase() === "BORRADOR") {
    setVisibleEliminarBorrador(true);
  }
}

async function eliminarBorradorPropuestaActual() {
  const btn = document.getElementById("btnEliminarBorrador");
  const id = propuestaBorradorEditableActual?.id || idPropuestaDesdeUrlEliminarBorrador();

  if (!id) {
    alert("No se ha podido localizar el borrador.");
    return;
  }

  const titulo = propuestaBorradorEditableActual?.titulo || propuestaBorradorEditableActual?.entidad || "este borrador";

  const ok1 = confirm(`¿Quieres eliminar el borrador?\n\n${titulo}`);
  if (!ok1) return;

  const ok2 = confirm("Segunda confirmación: ¿estás seguro/a de que quieres eliminar este borrador?\n\nDesaparecerá del listado normal de trabajo.");
  if (!ok2) return;

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Eliminando...";
    }

    const cliente = clienteSupabaseEliminarBorrador();

    /*
      No hacemos borrado físico.
      Lo pasamos a ARCHIVADA para conservar trazabilidad y evitar pérdidas accidentales.
    */
    const { error } = await cliente
      .from("itinerancias_propuestas")
      .update({
        estado: "ARCHIVADA",
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("estado", "BORRADOR");

    if (error) throw error;

    alert("Borrador eliminado correctamente.");

    window.location.href = "panel.html";
  } catch (err) {
    console.error(err);
    alert("No se ha podido eliminar el borrador: " + (err.message || err));

    if (btn) {
      btn.disabled = false;
      btn.textContent = "Eliminar borrador";
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("btnEliminarBorrador");

  if (btn) {
    btn.addEventListener("click", () => {
      eliminarBorradorPropuestaActual();
    });

    prepararBotonEliminarBorrador().catch(err => {
      console.error("Error preparando botón Eliminar borrador:", err);
    });
  }
});
// === FIN_ELIMINAR_BORRADOR_PROPUESTA_V1 ===


// === ELIMINAR_BORRADOR_PANEL_UNIDAD_V1 ===
function tipoPropuestaEsNuevaParaEliminarBorradorUnidad(item) {
  const d = item?.data || item || {};
  const tipo = String(d.tipo || d.tipo_propuesta || d.tipoPropuesta || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

  /*
    Solo permitimos eliminar desde el panel los borradores de NUEVA ITINERANCIA.
    Las propuestas de MODIFICACION o BAJA se dejan fuera para evitar confusiones.
  */
  return !tipo || tipo === "NUEVA" || tipo === "ALTA" || tipo.includes("NUEVA");
}

function itemEsBorradorNuevaItineranciaUnidad(item) {
  const d = item?.data || item || {};
  const estado = String(item?.estado || d.estado || "").toUpperCase();

  return estado === "BORRADOR" && tipoPropuestaEsNuevaParaEliminarBorradorUnidad(item);
}

function clienteSupabaseEliminarBorradorPanelUnidad() {
  if (typeof supabase !== "undefined" && supabase && typeof supabase.from === "function") return supabase;
  if (typeof supabaseClient !== "undefined" && supabaseClient && typeof supabaseClient.from === "function") return supabaseClient;
  if (typeof sb !== "undefined" && sb && typeof sb.from === "function") return sb;
  if (window.supabaseClient && typeof window.supabaseClient.from === "function") return window.supabaseClient;
  if (window.sb && typeof window.sb.from === "function") return window.sb;
  throw new Error("No se ha localizado el cliente de Supabase.");
}

function botonEliminarBorradorPanelUnidad(item) {
  if (!itemEsBorradorNuevaItineranciaUnidad(item)) return "";

  const d = item?.data || item || {};
  const id = d.id || item.id || "";

  if (!id) return "";

  return `
    <button type="button"
            class="peligro btn-eliminar-borrador-panel"
            onclick="eliminarBorradorPanelUnidad('${escapeHtml(id)}')">
      Eliminar borrador
    </button>
  `;
}

window.eliminarBorradorPanelUnidad = async function eliminarBorradorPanelUnidad(id) {
  const propuesta = (propuestasActuales || []).find(p => String(p.id) === String(id));
  const titulo = propuesta?.titulo || propuesta?.entidad || propuesta?.municipio || "este borrador";

  const ok1 = confirm(`¿Quieres eliminar el borrador?\n\n${titulo}`);
  if (!ok1) return;

  const ok2 = confirm("Segunda confirmación: ¿estás seguro/a de que quieres eliminar este borrador?\n\nDesaparecerá del listado normal de trabajo.");
  if (!ok2) return;

  try {
    const cliente = clienteSupabaseEliminarBorradorPanelUnidad();

    const { error } = await cliente
      .from("itinerancias_propuestas")
      .update({
        estado: "ARCHIVADA",
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("estado", "BORRADOR");

    if (error) throw error;

    propuestasActuales = (propuestasActuales || []).filter(p => String(p.id) !== String(id));

    if (typeof mostrarMsg === "function") {
      mostrarMsg("Borrador eliminado correctamente.");
    } else {
      alert("Borrador eliminado correctamente.");
    }

    if (typeof renderPanelUnificado === "function") {
      renderPanelUnificado();
    } else {
      window.location.reload();
    }
  } catch (err) {
    console.error(err);
    alert("No se ha podido eliminar el borrador: " + (err.message || err));
  }
};

function instalarBotonEliminarBorradorPanelUnidad() {
  if (typeof accionesItemUnificado !== "function") {
    console.warn("No se ha localizado accionesItemUnificado para añadir Eliminar borrador.");
    return;
  }

  if (accionesItemUnificado.__eliminarBorradorPanelUnidadWrapped) return;

  const original = accionesItemUnificado;

  const envuelta = function accionesItemUnificadoConEliminarBorrador(item) {
    const htmlOriginal = original.call(this, item) || "";
    const htmlEliminar = botonEliminarBorradorPanelUnidad(item);

    if (!htmlEliminar) return htmlOriginal;
    if (htmlOriginal.includes("btn-eliminar-borrador-panel")) return htmlOriginal;

    return htmlOriginal + htmlEliminar;
  };

  envuelta.__eliminarBorradorPanelUnidadWrapped = true;
  accionesItemUnificado = envuelta;
}

instalarBotonEliminarBorradorPanelUnidad();
// === FIN_ELIMINAR_BORRADOR_PANEL_UNIDAD_V1 ===


// === SOLICITAR_ACCESO_UNIDAD_SELECT_V1 ===
function clienteSupabaseUnidadSelectAcceso() {
  if (typeof supabase !== "undefined" && supabase && typeof supabase.from === "function") return supabase;
  if (typeof supabaseClient !== "undefined" && supabaseClient && typeof supabaseClient.from === "function") return supabaseClient;
  if (typeof sb !== "undefined" && sb && typeof sb.from === "function") return sb;
  if (window.supabaseClient && typeof window.supabaseClient.from === "function") return window.supabaseClient;
  if (window.sb && typeof window.sb.from === "function") return window.sb;
  throw new Error("No se ha localizado el cliente de Supabase.");
}

function normalizarTextoUnidadSelectAcceso(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function localizarCampoUnidadEntidadAcceso() {
  const candidatos = [
    document.getElementById("solUnidad"),
    document.getElementById("unidad"),
    document.getElementById("unidadEntidad"),
    document.getElementById("unidad_entidad"),
    document.getElementById("entidad"),
    document.querySelector('[name="solUnidad"]'),
    document.querySelector('[name="unidad"]'),
    document.querySelector('[name="unidadEntidad"]'),
    document.querySelector('[name="unidad_entidad"]'),
    document.querySelector('[name="entidad"]')
  ].filter(Boolean);

  for (const el of candidatos) {
    if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return el;
  }

  const labels = [...document.querySelectorAll("label")];

  for (const label of labels) {
    const texto = normalizarTextoUnidadSelectAcceso(label.textContent);
    if (texto.includes("unidad") && texto.includes("entidad")) {
      const dentro = label.querySelector("input, textarea, select");
      if (dentro) return dentro;

      if (label.getAttribute("for")) {
        const porFor = document.getElementById(label.getAttribute("for"));
        if (porFor) return porFor;
      }
    }
  }

  return null;
}

function textoUnidadOpcionAcceso(u) {
  const nombre = u.nombre || u.unidad || u.entidad || "";
  const municipio = u.municipio || u.poblacion || "";

  /*
    Texto visible del desplegable:
    no mostramos código tipo AO_UNIT00 para que sea más claro para las unidades.
  */
  return [nombre, municipio]
    .filter(Boolean)
    .join(" · ");
}

async function cargarUnidadesSelectAcceso() {
  if (!location.pathname.includes("solicitar-acceso")) return;

  const campoOriginal = localizarCampoUnidadEntidadAcceso();
  if (!campoOriginal) {
    console.warn("No se ha localizado el campo Unidad/Entidad en solicitar-acceso.");
    return;
  }

  if (document.getElementById("unidadEntidadSelectAcceso")) return;

  const cliente = clienteSupabaseUnidadSelectAcceso();

  const { data, error } = await cliente
    .from("unidades")
    .select("*")
    .order("nombre", { ascending: true });

  if (error) {
    console.error("No se han podido cargar las unidades:", error);
    return;
  }

  const unidades = (data || [])
    .filter(u => u.activo !== false)
    .sort((a, b) => textoUnidadOpcionAcceso(a).localeCompare(textoUnidadOpcionAcceso(b), "es"));

  const select = document.createElement("select");
  select.id = "unidadEntidadSelectAcceso";
  select.className = "unidad-entidad-select-acceso";
  select.required = campoOriginal.required !== false;

  select.innerHTML = `
    <option value="">Selecciona la unidad/entidad...</option>
    ${unidades.map(u => {
      const texto = textoUnidadOpcionAcceso(u);
      const nombre = u.nombre || u.unidad || u.entidad || texto;
      return `
        <option value="${escapeHtml(nombre)}" data-unidad-id="${escapeHtml(u.id || "")}">
          ${escapeHtml(texto)}
        </option>
      `;
    }).join("")}
  `;

  const ayuda = document.createElement("p");
  ayuda.className = "muted ayuda-unidad-entidad-select";
  ayuda.textContent = "Selecciona la unidad para la que solicitas acceso.";

  campoOriginal.classList.add("oculto");
  campoOriginal.required = false;
  campoOriginal.insertAdjacentElement("afterend", select);
  select.insertAdjacentElement("afterend", ayuda);

  const hiddenUnidadId = document.createElement("input");
  hiddenUnidadId.type = "hidden";
  hiddenUnidadId.id = "unidadIdSeleccionadaAcceso";
  hiddenUnidadId.name = "unidad_id";
  campoOriginal.insertAdjacentElement("afterend", hiddenUnidadId);

  select.addEventListener("change", () => {
    const opt = select.selectedOptions[0];
    campoOriginal.value = select.value || "";
    hiddenUnidadId.value = opt?.dataset?.unidadId || "";
    campoOriginal.dispatchEvent(new Event("input", { bubbles: true }));
    campoOriginal.dispatchEvent(new Event("change", { bubbles: true }));
  });

  if (campoOriginal.value) {
    const valorActual = normalizarTextoUnidadSelectAcceso(campoOriginal.value);
    const encontrada = [...select.options].find(opt =>
      normalizarTextoUnidadSelectAcceso(opt.value) === valorActual ||
      normalizarTextoUnidadSelectAcceso(opt.textContent).includes(valorActual)
    );

    if (encontrada) {
      select.value = encontrada.value;
      hiddenUnidadId.value = encontrada.dataset.unidadId || "";
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  cargarUnidadesSelectAcceso().catch(err => {
    console.error("Error cargando desplegable Unidad/Entidad:", err);
  });
});
// === FIN_SOLICITAR_ACCESO_UNIDAD_SELECT_V1 ===

