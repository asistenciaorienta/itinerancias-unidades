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
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
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

async function solicitarAcceso(payload) {
  try {
    const convocatoria = await obtenerConvocatoriaVigente();
    payload.convocatoria_id = convocatoria.id;
  } catch (err) {
    console.error(err);
    mostrarMsg("No se ha podido detectar la convocatoria vigente. Inténtalo más tarde.", true);
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
    return `<p class="muted actividad-resumen">Sin actividad registrada todavía.</p>`;
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
    mostrarMsg("No se han podido cargar las actividades registradas: " + error.message, true);
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
          Registrar actividad
        </button>
        <button class="btn secundario" onclick="abrirModalListadoActividades('${escapeHtml(i.id)}')">
          Ver actividades
        </button>
        <button class="btn secundario" onclick="crearPropuestaModificacion('${escapeHtml(i.id)}')">
          Solicitar modificación
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


function estadoEtiquetaClase(estado) {
  const e = String(estado || "").toUpperCase();
  if (e === "PUBLICADA") return "estado-publicada";
  if (e === "BORRADOR") return "estado-borrador";
  if (e === "PENDIENTE_VALIDACION") return "estado-pendiente";
  if (e === "RECHAZADA") return "estado-rechazada";
  if (e === "ARCHIVADA") return "estado-archivada";
  return "estado-neutro";
}

function estadoLegible(estado) {
  const e = String(estado || "").toUpperCase();
  if (e === "PENDIENTE_VALIDACION") return "PENDIENTE";
  return e || "SIN ESTADO";
}

function textoBusquedaItemUnificado(item) {
  const d = item.data || {};
  return [
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
  ].join(" ").toLowerCase();
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
        Registrar actividad
      </button>
      <button class="btn secundario" onclick="abrirModalListadoActividades('${escapeHtml(d.id)}')">
        Ver actividades
      </button>
      <button class="btn secundario" onclick="crearPropuestaModificacion('${escapeHtml(d.id)}')">
        Solicitar modificación
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

function renderPanelUnificado() {
  const cont = $("listaUnificada");
  if (!cont) {
    renderPanelUnificado();
    renderPropuestas(propuestasActuales);
    return;
  }

  const filtroTexto = String($("filtroPanelUnificado")?.value || "").trim().toLowerCase();
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
    const etiqueta = estadoLegible(item.estado);

    return `
      <article class="item item-unificado">
        <div class="item-unificado-main">
          <div class="item-unificado-top">
            <h3>${escapeHtml(titulo)}</h3>
            <span class="estado-badge ${estadoEtiquetaClase(item.estado)}">${escapeHtml(etiqueta)}</span>
          </div>

          <p class="muted">
            ${escapeHtml(item.tipoListado)}
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

function datosFormularioItinerancia(estado) {
  const dias = $("horario")?.value.trim() || null;

  return {
    tipo: $("tipo")?.value || "NUEVA",
    estado,
    titulo: "",
    descripcion: null,
    municipio: $("municipio")?.value.trim() || null,
    direccion: $("direccion")?.value.trim() || null,
    horario: dias,
    dias,
    frecuencia: $("frecuencia")?.value.trim() || null,
    fecha_inicio: $("fechaInicio")?.value || null,
    fecha_fin: $("fechaFin")?.value || null,
    contacto: $("contacto")?.value.trim() || null,
    telefono: $("telefono")?.value.trim() || null,
    email: $("emailContacto")?.value.trim() || null,
    observaciones_publicas: $("observacionesPublicas")?.value.trim() || null,
    observaciones_unidad: $("observacionesUnidad")?.value.trim() || null
  };
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
  if (titulo) titulo.textContent = "Actividades registradas";

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
    titulo.textContent = actividad ? "Editar actividad" : "Registrar actividad";
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
    mostrarMsgActividad("La fecha de actividad es obligatoria.", true);
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
    mostrarMsgActividad("No se ha podido guardar la actividad: " + error.message, true);
    return;
  }

  $("modalActividad").close();
  mostrarMsgActividad("");

  await cargarActividadesUnidad(convocatoriaActual.id);
  renderPanelUnificado();

  if ($("modalListadoActividades")?.open) {
    renderListadoActividadesModal();
  }

  mostrarMsg(idActividad ? "Actividad actualizada correctamente." : "Actividad registrada correctamente.");
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
  return params.get("propuesta");
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

  setValor("tipo", data.tipo || "MODIFICACION");
  setValor("titulo", data.titulo);
  setValor("descripcion", data.descripcion);
  setValor("municipio", data.municipio);
  setValor("direccion", data.direccion);
  setValor("horario", data.horario);
  setValor("frecuencia", data.frecuencia);
  setValor("fechaInicio", data.fecha_inicio);
  setValor("fechaFin", data.fecha_fin || $("fechaFin")?.value || "");
  setValor("contacto", data.contacto);
  setValor("telefono", data.telefono);
  setValor("emailContacto", data.email);
  setValor("observacionesPublicas", data.observaciones_publicas);
  setValor("observacionesUnidad", data.observaciones_unidad);

  const h1 = document.querySelector("h1");
  if (h1) h1.textContent = "Editar propuesta de itinerancia";

  mostrarMsg("Editando borrador de propuesta.");
}

document.addEventListener("DOMContentLoaded", () => {
  aplicarFechaFinConvocatoriaPorDefecto();
  cargarPropuestaParaEditar();
  
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
      renderPanelUnificado();
    });
  }
});
