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

// === SOLICITUDES_OCA_2026_V1_6_PUBLIC ===
async function obtenerConvocatoriaVigente() {
  const { data, error } = await supabaseClient
    .from("convocatorias_orienta")
    .select("id,nombre,periodo,fecha_inicio,fecha_fin,estado,visible_web")
    .eq("id", "OCA_2026")
    .eq("visible_web", true)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw new Error("No está disponible la convocatoria OCA_2026.");
  }

  return data;
}

// === PERFIL_MULTIUNIDAD_SIN_EMBED_AMBIGUO_V1 ===
async function obtenerPerfil() {
  const { data: authData, error: authError } =
    await supabaseClient.auth.getUser();

  if (authError || !authData?.user) {
    window.location.href = "login.html";
    return null;
  }

  const user = authData.user;

  /*
    IMPORTANTE:
    No incrustamos aquí unidades(...).

    Desde que existe usuarios_unidades hay varias relaciones
    relacionadas con unidades y PostgREST puede responder HTTP 300
    por relación ambigua.
  */
  const { data, error } = await supabaseClient
    .from("usuarios_perfiles")
    .select(
      "id,email,nombre,rol,unidad_id,activo,debe_cambiar_clave"
    )
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    console.error(
      "Error cargando usuarios_perfiles:",
      error
    );

    mostrarMsg(
      "No se ha podido cargar tu perfil. Contacta con Dirección Provincial.",
      true
    );

    return null;
  }

  if (!data.activo) {
    mostrarMsg(
      "Tu usuario no está activo. Contacta con Dirección Provincial.",
      true
    );

    try {
      await supabaseClient.auth.signOut();
    } catch (err) {
      console.error(
        "No se ha podido cerrar la sesión del usuario inactivo",
        err
      );
    }

    perfilActual = null;

    setTimeout(() => {
      window.location.href =
        "login.html?motivo=usuario-inactivo";
    }, 800);

    return null;
  }

  /*
    Cargamos todas las unidades asignadas al usuario.
  */
  const {
    data: relaciones,
    error: errorRelaciones
  } = await supabaseClient
    .from("usuarios_unidades")
    .select(
      "usuario_id,unidad_id,principal,activo,unidades(id,nombre,municipio,direccion,telefono,cif,colectivo,origen_interno_id,expediente_id,expediente,codigo_expediente,entidad_expediente,convocatoria_id)"
    )
    .eq("usuario_id", user.id)
    .eq("activo", true);

  if (errorRelaciones) {
    console.error(
      "Error cargando usuarios_unidades:",
      errorRelaciones
    );

    mostrarMsg(
      "No se han podido cargar las unidades asignadas a tu usuario. Contacta con Dirección Provincial.",
      true
    );

    return null;
  }

  const asignaciones = Array.isArray(relaciones)
    ? relaciones
    : [];

  /*
    Compatibilidad:
    - si existe una marcada como principal, usamos esa;
    - si no, buscamos la que coincide con usuarios_perfiles.unidad_id;
    - como último recurso, usamos la primera.
  */
  const asignacionPrincipal =
    asignaciones.find(r => r.principal === true) ||
    asignaciones.find(
      r => String(r.unidad_id) === String(data.unidad_id)
    ) ||
    asignaciones[0] ||
    null;

  /*
    Si todavía no hubiera relación en usuarios_unidades,
    mantenemos compatibilidad con perfiles antiguos consultando
    directamente su unidad principal.
  */
  let unidadPrincipal =
    asignacionPrincipal?.unidades ||
    null;

  if (!unidadPrincipal && data.unidad_id) {
    const {
      data: unidadDirecta,
      error: errorUnidadDirecta
    } = await supabaseClient
      .from("unidades")
      .select(
        "id,nombre,municipio,direccion,telefono,cif,colectivo,origen_interno_id,expediente_id,expediente,codigo_expediente,entidad_expediente,convocatoria_id"
      )
      .eq("id", data.unidad_id)
      .maybeSingle();

    if (errorUnidadDirecta) {
      console.error(
        "Error cargando unidad principal:",
        errorUnidadDirecta
      );
    } else {
      unidadPrincipal = unidadDirecta || null;
    }
  }

  /*
    Conservamos las propiedades antiguas para no romper el panel.
  */
  if (asignacionPrincipal?.unidad_id) {
    data.unidad_id =
      asignacionPrincipal.unidad_id;
  }

  data.unidades =
    unidadPrincipal;

  /*
    Nueva información multiunidad.
  */
  data.unidades_asignadas =
    asignaciones.map(r => ({
      usuario_id: r.usuario_id,
      unidad_id: r.unidad_id,
      principal: r.principal === true,
      activo: r.activo !== false,
      ...(r.unidades || {})
    }));


  // === UNIDAD_ACTIVA_SESION_V2 ===
  const unidadPrincipalIdCompat =
    asignacionPrincipal?.unidad_id ||
    data.unidad_id ||
    null;

  data.unidad_principal_id =
    unidadPrincipalIdCompat;

  const claveUnidadActiva =
    `itinerancias_unidad_activa_${data.id}`;

  const unidadActivaGuardada =
    sessionStorage.getItem(
      claveUnidadActiva
    );

  const unidadesActivas =
    Array.isArray(data.unidades_asignadas)
      ? data.unidades_asignadas.filter(
          u => u.activo !== false
        )
      : [];

  const unidadActiva =
    unidadesActivas.find(
      u =>
        unidadActivaGuardada &&
        String(u.unidad_id) ===
        String(unidadActivaGuardada)
    ) ||
    unidadesActivas.find(
      u => u.principal === true
    ) ||
    unidadesActivas.find(
      u =>
        String(u.unidad_id) ===
        String(unidadPrincipalIdCompat)
    ) ||
    unidadesActivas[0] ||
    null;

  if (unidadActiva) {
    data.unidad_id =
      unidadActiva.unidad_id;

    data.unidad_activa_id =
      unidadActiva.unidad_id;

    /*
      Compatibilidad:
      el resto de la aplicación ya utiliza perfil.unidades
      para nombre y origen_interno_id.
    */
    data.unidades =
      unidadActiva;

    sessionStorage.setItem(
      claveUnidadActiva,
      unidadActiva.unidad_id
    );
  }
  // === FIN_UNIDAD_ACTIVA_SESION_V2 ===

  console.log(
    "Perfil cargado:",
    {
      id: data.id,
      email: data.email,
      unidad_principal: data.unidad_id,
      unidades_asignadas:
        data.unidades_asignadas.length
    }
  );

  return data;
}
// === FIN_PERFIL_MULTIUNIDAD_SIN_EMBED_AMBIGUO_V1 ===

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
  const direccion = String(
    u?.direccion || ""
  ).trim();

  return [
    u?.nombre,
    u?.municipio,
    direccion
  ]
    .filter(Boolean)
    .join(" · ");
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

  document.querySelectorAll("#solUnidadSelect").forEach((el, idx) => {
    if (idx > 0) el.remove();
  });

  const selectorExistente = document.getElementById("solUnidadSelect");
  if (selectorExistente) return;

  try {
    convocatoriaSolicitudAcceso = await obtenerConvocatoriaVigente();

    const hiddenConv = $("solConvocatoriaId");
    if (hiddenConv) hiddenConv.value = convocatoriaSolicitudAcceso.id;

    const { data, error } = await supabaseClient
      .from("unidades")
      .select("id,nombre,municipio,direccion,convocatoria_id,activa")
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
        <h3>${escapeHtml(i.municipio || i.localidad || i.titulo || i.entidad || "Itinerancia")}</h3>
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
        <h3>${escapeHtml(p.municipio || p.localidad || p.titulo || "Sin título")}</h3>
        <p class="muted">${escapeHtml(textoUnidadPanelV17B(perfilActual))}</p>
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


// === IDENTIDAD_SEDE_UNIDAD_V17B ===

function normalizarDireccionPanelUnidadV17B(
  valor
) {

  let s =
    String(valor || "")
      .trim()
      .replace(/\s+/g, " ");


  if (!s) {
    return "";
  }


  const n =
    s
      .toLocaleUpperCase("es")
      .normalize("NFD")
      .replace(
        /[\u0300-\u036f]/g,
        ""
      );


  if (
    n === "CR DE MALAGA 43" ||
    n === "CTRA. DE MALAGA 43"
  ) {

    return "Ctra. de Málaga, 43";
  }


  if (
    n === "CL DELFIN 5" ||
    n === "C/ DELFIN 5"
  ) {

    return "C/ Delfín, 5";
  }


  s = s
    .replace(/^CL\s+/i, "C/ ")
    .replace(/^CR\s+/i, "Ctra. ")
    .replace(/^AV\s+/i, "Av. ")
    .replace(/^CM\s+/i, "Camino ")
    .replace(/^PZ\s+/i, "Plaza ")
    .replace(/^PS\s+/i, "Paseo ");


  s = s
    .replace(/^Ctra\.\s+DE\s+/i, "Ctra. de ")
    .replace(/^Av\.\s+DE\s+/i, "Av. de ");


  s = s.replace(
    /\s+(\d+[A-Za-z]?)$/,
    ", $1"
  );


  return s;
}


function textoUnidadPanelV17B(
  perfil = perfilActual
) {

  const u =
    perfil?.unidades ||
    {};


  const nombre =
    String(
      u?.nombre ||
      "Unidad sin asignar"
    ).trim();


  const sede =
    normalizarDireccionPanelUnidadV17B(
      u?.direccion ||
      ""
    );


  const colectivo =
    String(
      u?.colectivo ||
      ""
    ).trim();


  if (!sede) {
    return nombre;
  }


  if (
    nombre
      .toLocaleUpperCase("es")
      .includes(
        sede.toLocaleUpperCase("es")
      )
  ) {

    return nombre;
  }


  if (colectivo) {

    const sufijo =
      ` · ${colectivo}`;


    if (
      nombre.endsWith(sufijo)
    ) {

      const base =
        nombre.slice(
          0,
          -sufijo.length
        );


      return (
        `${base} · ${sede}${sufijo}`
      );
    }
  }


  return `${nombre} · ${sede}`;
}


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
  const filtroEstado = String(
    $("filtroEstadoUnificado")?.value ?? ""
  ).trim().toUpperCase();

  let items = construirItemsUnificados();

  if (filtroEstado) {
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
    const titulo = d.municipio || d.localidad || d.titulo || d.entidad || "Itinerancia";
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
            ${escapeHtml(
              textoUnidadPanelV17B(
                perfilActual
              )
            )}
          </p>

          <p class="muted">
            ${escapeHtml(item.tipoListado === "PROPUESTA" ? tipoPropuestaLegible(d.tipo) : item.tipoListado)}
            ${dias ? " · " + escapeHtml(dias) : ""}
          </p>

          <p>
            ${escapeHtml(direccion)}
            ${tel}
          </p>

          <p class="muted">
            ${escapeHtml(tecnico)}
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


// === AVISO_RECHAZADAS_UNIDAD_V1 ===

function huellaRechazoUnidad(propuesta) {
  const id =
    String(propuesta?.id || "").trim();

  const fecha =
    String(
      propuesta?.rechazada_at ||
      propuesta?.updated_at ||
      "sin-fecha"
    ).trim();

  return `${id}__${fecha}`;
}


function claveRechazoVistoUnidad(propuesta) {
  return (
    "itinerancias_rechazo_visto_" +
    huellaRechazoUnidad(propuesta)
  );
}


function claveRechazoPospuestoUnidad(propuesta) {
  return (
    "itinerancias_rechazo_pospuesto_" +
    huellaRechazoUnidad(propuesta)
  );
}


function rechazoOcultoAutomaticamenteUnidad(
  propuesta
) {
  try {
    return (
      localStorage.getItem(
        claveRechazoVistoUnidad(propuesta)
      ) === "1" ||
      sessionStorage.getItem(
        claveRechazoPospuestoUnidad(propuesta)
      ) === "1"
    );
  } catch (_) {
    return false;
  }
}


function propuestasRechazadasAvisablesUnidad() {
  return (propuestasActuales || [])
    .filter(
      p =>
        String(
          p?.estado || ""
        ).toUpperCase() ===
          "RECHAZADA"
    )
    .filter(
      p =>
        !rechazoOcultoAutomaticamenteUnidad(
          p
        )
    )
    .sort(
      (a, b) =>
        String(
          b.rechazada_at ||
          b.updated_at ||
          ""
        ).localeCompare(
          String(
            a.rechazada_at ||
            a.updated_at ||
            ""
          )
        )
    );
}


function marcarRechazosVistosUnidad(lista) {
  for (
    const propuesta of
    Array.isArray(lista) ? lista : []
  ) {
    try {
      localStorage.setItem(
        claveRechazoVistoUnidad(propuesta),
        "1"
      );

      sessionStorage.removeItem(
        claveRechazoPospuestoUnidad(
          propuesta
        )
      );
    } catch (_) {}
  }
}


function posponerRechazosUnidad(lista) {
  for (
    const propuesta of
    Array.isArray(lista) ? lista : []
  ) {
    try {
      sessionStorage.setItem(
        claveRechazoPospuestoUnidad(
          propuesta
        ),
        "1"
      );
    } catch (_) {}
  }
}


function asegurarModalRechazadasUnidad() {
  let modal =
    document.getElementById(
      "modalRechazadasUnidad"
    );

  if (modal) return modal;

  modal =
    document.createElement("dialog");

  modal.id =
    "modalRechazadasUnidad";

  modal.innerHTML = `
    <div class="modal-card modal-rechazos-unidad-card">

      <div class="modal-rechazos-unidad-header">
        <div>
          <h2>
            Propuestas devueltas por Dirección Provincial
          </h2>

          <p class="muted">
            Revisa las observaciones indicadas,
            corrige la propuesta y vuelve a enviarla
            a validación.
          </p>
        </div>
      </div>

      <div
        id="listaRechazosUnidad"
        class="lista-rechazos-unidad"
      ></div>

      <label
        class="marcar-vistos-rechazos-unidad"
      >
        <input
          type="checkbox"
          id="checkNoMostrarRechazosUnidad"
        >

        <span>
          Marcar estos avisos como vistos y
          no volver a mostrarlos automáticamente
          en este navegador.
        </span>
      </label>

      <div class="acciones modal-actions">
        <button
          type="button"
          id="btnVerMasTardeRechazosUnidad"
          class="secundario"
        >
          Ver más tarde
        </button>
      </div>

    </div>
  `;

  document.body.appendChild(modal);

  const cerrar =
    document.getElementById(
      "btnVerMasTardeRechazosUnidad"
    );

  cerrar?.addEventListener(
    "click",
    () => {
      const lista =
        Array.isArray(
          modal.__rechazosMostrados
        )
          ? modal.__rechazosMostrados
          : [];

      const marcar =
        document.getElementById(
          "checkNoMostrarRechazosUnidad"
        )?.checked === true;

      if (marcar) {
        marcarRechazosVistosUnidad(lista);
      } else {
        /*
          "Ver más tarde":
          no vuelve a interrumpir durante esta
          sesión del navegador, pero reaparecerá
          en una sesión posterior.
        */
        posponerRechazosUnidad(lista);
      }

      modal.close();
    }
  );


  modal.addEventListener(
    "cancel",
    () => {
      posponerRechazosUnidad(
        modal.__rechazosMostrados || []
      );
    }
  );


  modal.addEventListener(
    "click",
    evento => {
      const enlace =
        evento.target.closest(
          "[data-corregir-rechazo]"
        );

      if (!enlace) return;

      const marcar =
        document.getElementById(
          "checkNoMostrarRechazosUnidad"
        )?.checked === true;

      if (marcar) {
        marcarRechazosVistosUnidad(
          modal.__rechazosMostrados || []
        );
      }
    }
  );

  return modal;
}


function mostrarModalRechazadasUnidad() {
  const lista =
    propuestasRechazadasAvisablesUnidad();

  if (!lista.length) return;

  const modal =
    asegurarModalRechazadasUnidad();

  const cont =
    document.getElementById(
      "listaRechazosUnidad"
    );

  if (!cont) return;

  modal.__rechazosMostrados =
    lista.slice();

  const check =
    document.getElementById(
      "checkNoMostrarRechazosUnidad"
    );

  if (check) {
    check.checked = false;
  }

  cont.innerHTML =
    lista.map(
      p => {
        const fecha =
          p.rechazada_at
            ? fechaES(p.rechazada_at)
            : "";

        const motivo =
          String(
            p.observaciones_dp || ""
          ).trim() ||
          "Dirección Provincial no ha indicado observaciones adicionales.";

        return `
          <article class="rechazo-unidad-item">

            <div class="rechazo-unidad-cabecera">
              <div>
                <h3>
                  ${escapeHtml(
                    p.municipio ||
                    p.localidad ||
                    p.titulo ||
                    "Propuesta"
                  )}
                </h3>

                <p class="muted">
                  ${escapeHtml(
                    textoUnidadPanelV17B(
                      perfilActual
                    )
                  )}
                  ${fecha
                    ? " · Devuelta el " +
                      escapeHtml(fecha)
                    : ""}
                </p>
              </div>

              <span
                class="estado estado-rechazada"
              >
                RECHAZADA
              </span>
            </div>

            <div class="motivo-rechazo-unidad">
              <strong>
                Observaciones de Dirección Provincial
              </strong>

              <p>
                ${escapeHtml(motivo)}
              </p>
            </div>

            <div class="acciones rechazo-unidad-acciones">
              <a
                class="btn"
                data-corregir-rechazo="${escapeHtml(
                  p.id
                )}"
                href="nueva-itinerancia.html?id=${encodeURIComponent(
                  p.id
                )}"
              >
                Corregir propuesta
              </a>
            </div>

          </article>
        `;
      }
    ).join("");

  if (!modal.open) {
    modal.showModal();
  }
}

// === FIN_AVISO_RECHAZADAS_UNIDAD_V1 ===


async function cargarPanel() {
  const perfil = await obtenerPerfil();
  if (!perfil) return;

  perfilActual = perfil;

  if (perfil.debe_cambiar_clave === true) {
    const info = $("usuarioInfo");
    if (info) {
      const unidadNombre = textoUnidadPanelV17B(perfil);
      info.textContent = `${perfil.nombre || perfil.email} · ${unidadNombre} · Cambio de clave pendiente`;
    }

    mostrarMsg("Debes cambiar la clave temporal antes de continuar.", true);
    abrirCambioClaveObligatorio(perfil);
    return;
  }

  try {
    convocatoriaActual = await obtenerConvocatoriaVigente();
  } catch (err) {
    console.error(err);
    mostrarMsg("No se ha podido detectar la convocatoria vigente.", true);
    return;
  }

  const unidadNombre = textoUnidadPanelV17B(perfil);

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

    /*
      Una vez cargadas y pintadas las propuestas
      comprobamos si Dirección Provincial ha
      devuelto alguna.
    */
    mostrarModalRechazadasUnidad();

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


// === UNIDAD_RESPONSABLE_EDICION_MULTI_V1 ===

function unidadesAsignadasActivasFormulario(perfil) {
  const lista =
    Array.isArray(perfil?.unidades_asignadas)
      ? perfil.unidades_asignadas
      : [];

  const activas =
    lista.filter(
      u => u && u.activo !== false
    );

  if (activas.length) {
    return activas;
  }

  /*
    Compatibilidad con usuarios antiguos
    que solo tienen usuarios_perfiles.unidad_id.
  */
  if (perfil?.unidades) {
    return [{
      ...perfil.unidades,
      unidad_id:
        perfil.unidades.unidad_id ||
        perfil.unidades.id ||
        perfil.unidad_id,
      principal: true,
      activo: true
    }];
  }

  return [];
}


function idUnidadFormulario(u) {
  return String(
    u?.unidad_id ||
    u?.id ||
    ""
  );
}


function textoUnidadResponsableFormulario(u) {
  const partes = [
    u?.nombre,
    u?.municipio,
    u?.direccion
  ].filter(Boolean);

  let texto =
    partes.join(" · ");

  if (u?.principal === true) {
    texto += " · Principal";
  }

  return texto;
}


function unidadResponsableSeleccionadaFormulario(perfil) {
  const unidades =
    unidadesAsignadasActivasFormulario(
      perfil
    );

  const selector =
    $("unidadResponsableEdicion");

  const idElegido =
    String(
      selector?.value ||
      perfil?.unidad_id ||
      ""
    );

  return (
    unidades.find(
      u =>
        idUnidadFormulario(u) ===
        idElegido
    ) ||
    unidades.find(
      u =>
        idUnidadFormulario(u) ===
        String(perfil?.unidad_id || "")
    ) ||
    unidades[0] ||
    perfil?.unidades ||
    null
  );
}


function aplicarUnidadResponsablePayload(
  payload,
  unidad
) {
  if (!unidad) return;

  const unidadId =
    idUnidadFormulario(unidad);

  payload.unidad_id =
    unidadId || null;

  payload.unidad_nombre =
    unidad.nombre || null;

  payload.cif =
    unidad.cif || null;

  payload.unidad_origen_interno_id =
    unidad.origen_interno_id ??
    null;

  payload.expediente_id =
    unidad.expediente_id || null;

  payload.expediente =
    unidad.expediente || null;

  payload.codigo_expediente =
    unidad.codigo_expediente || null;

  payload.entidad_expediente =
    unidad.entidad_expediente || null;
}


function prepararSelectorUnidadResponsableEdicion(
  perfil,
  propuesta
) {
  const bloque =
    $("bloqueUnidadResponsableEdicion");

  const selector =
    $("unidadResponsableEdicion");

  if (!bloque || !selector) {
    return;
  }

  const unidades =
    unidadesAsignadasActivasFormulario(
      perfil
    );

  /*
    Con una sola unidad no mostramos ningún
    selector adicional.
  */
  if (unidades.length <= 1) {
    bloque.classList.add("oculto");

    if (unidades[0]) {
      selector.innerHTML = `
        <option value="${escapeHtml(idUnidadFormulario(unidades[0]))}">
          ${escapeHtml(textoUnidadResponsableFormulario(unidades[0]))}
        </option>
      `;

      selector.value =
        idUnidadFormulario(
          unidades[0]
        );
    }

    return;
  }

  bloque.classList.remove("oculto");

  selector.innerHTML =
    unidades
      .map(
        u => `
          <option value="${escapeHtml(idUnidadFormulario(u))}">
            ${escapeHtml(textoUnidadResponsableFormulario(u))}
          </option>
        `
      )
      .join("");

  const actual =
    String(
      propuesta?.unidad_id ||
      perfil?.unidad_id ||
      ""
    );

  if (
    unidades.some(
      u =>
        idUnidadFormulario(u) ===
        actual
    )
  ) {
    selector.value =
      actual;
  }
}

// === FIN_UNIDAD_RESPONSABLE_EDICION_MULTI_V1 ===


// === DECIDIR_NUEVA_O_MODIFICAR_V1 ===

function normalizarUbicacionPropuestaV1(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}


async function buscarCoincidenciasUbicacionNuevaV1(
  payload,
  unidadResponsableId,
  convocatoriaId
) {

  const n =
    normalizarUbicacionPropuestaV1;

  const municipio =
    n(payload?.municipio);

  const direccion =
    n(payload?.direccion);

  if (
    !unidadResponsableId ||
    !convocatoriaId ||
    !municipio ||
    !direccion
  ) {
    return {
      publicadas: [],
      propuestas: []
    };
  }


  /*
    PUBLICADAS:
    preferimos identificar la unidad mediante
    unidad_origen_interno_id.
  */
  let queryPublicadas =
    supabaseClient
      .from("itinerancias_publicadas")
      .select(
        "id,titulo,entidad,unidad_nombre," +
        "unidad_origen_interno_id,municipio,direccion," +
        "dias,horario,frecuencia,fecha_inicio,fecha_fin," +
        "contacto,tecnico_orienta,telefono,email," +
        "observaciones_publicas,descripcion," +
        "activa,borrada_admin,despublicada_admin"
      )
      .eq(
        "convocatoria_id",
        convocatoriaId
      )
      .eq(
        "activa",
        true
      );

  const origenInterno =
    String(
      payload?.unidad_origen_interno_id ??
      ""
    ).trim();

  if (origenInterno) {
    queryPublicadas =
      queryPublicadas.eq(
        "unidad_origen_interno_id",
        origenInterno
      );
  }

  const {
    data: datosPublicadas,
    error: errorPublicadas
  } = await queryPublicadas;

  if (errorPublicadas) {
    throw errorPublicadas;
  }

  let publicadas =
    (datosPublicadas || []).filter(
      x =>
        x.activa !== false &&
        x.borrada_admin !== true &&
        x.despublicada_admin !== true
    );

  /*
    Compatibilidad si una publicación antigua
    carece de unidad_origen_interno_id.
  */
  if (!origenInterno) {

    const unidadNombre =
      n(
        payload?.unidad_nombre ||
        payload?.entidad
      );

    if (unidadNombre) {
      publicadas =
        publicadas.filter(
          x =>
            n(
              x.unidad_nombre ||
              x.entidad
            ) === unidadNombre
        );
    }
  }

  publicadas =
    publicadas.filter(
      x =>
        n(x.municipio) === municipio &&
        n(x.direccion) === direccion
    );


  /*
    PROPUESTAS:
    misma unidad exacta, municipio y dirección.
  */
  const {
    data: datosPropuestas,
    error: errorPropuestas
  } =
    await supabaseClient
      .from("itinerancias_propuestas")
      .select(
        "id,tipo,estado,titulo,municipio,direccion," +
        "horario,frecuencia,fecha_inicio,fecha_fin," +
        "itinerancia_publicada_id,created_at"
      )
      .eq(
        "convocatoria_id",
        convocatoriaId
      )
      .eq(
        "unidad_id",
        unidadResponsableId
      )
      .order(
        "created_at",
        { ascending: false }
      );

  if (errorPropuestas) {
    throw errorPropuestas;
  }

  const propuestaActualId =
    String(
      obtenerIdPropuestaEdicion() ||
      ""
    );

  const estadosIgnorados =
    new Set([
      "ARCHIVADA",
      "PUBLICADA"
    ]);

  const propuestas =
    (datosPropuestas || []).filter(
      x =>
        String(x.id) !== propuestaActualId &&
        !estadosIgnorados.has(
          String(
            x.estado || ""
          ).toUpperCase()
        ) &&
        n(x.municipio) === municipio &&
        n(x.direccion) === direccion
    );

  return {
    publicadas,
    propuestas
  };
}


function resumenPublicadaCoincidenteV1(p) {

  return [
    p?.municipio,
    p?.direccion,
    p?.dias || p?.horario,
    p?.frecuencia
  ]
    .filter(Boolean)
    .join(" · ");
}


function resumenPropuestaCoincidenteV1(p) {

  return [
    p?.municipio,
    p?.direccion,
    p?.horario,
    p?.frecuencia
  ]
    .filter(Boolean)
    .join(" · ");
}


async function crearModificacionDesdeCoincidenciaV1(
  original,
  perfil,
  convocatoria,
  unidadResponsableId
) {

  /*
    Antes de crear otro borrador de modificación,
    comprobamos si ya existe uno vinculado
    a esta publicación.
  */
  const {
    data: existentes,
    error: errorExistentes
  } =
    await supabaseClient
      .from("itinerancias_propuestas")
      .select(
        "id,estado,tipo,itinerancia_publicada_id,created_at"
      )
      .eq(
        "convocatoria_id",
        convocatoria.id
      )
      .eq(
        "unidad_id",
        unidadResponsableId
      )
      .eq(
        "itinerancia_publicada_id",
        original.id
      )
      .eq(
        "tipo",
        "MODIFICACION"
      )
      .in(
        "estado",
        [
          "BORRADOR",
          "RECHAZADA",
          "PENDIENTE_VALIDACION",
          "VALIDADA"
        ]
      )
      .order(
        "created_at",
        { ascending: false }
      );

  if (errorExistentes) {
    throw errorExistentes;
  }

  if (existentes?.[0]?.id) {

    window.location.href =
      `nueva-itinerancia.html?id=${encodeURIComponent(existentes[0].id)}`;

    return;
  }


  const payload = {
    tipo: "MODIFICACION",
    estado: "BORRADOR",

    titulo:
      original.titulo ||
      original.entidad ||
      "Modificación de itinerancia",

    descripcion:
      original.descripcion ||
      null,

    municipio:
      original.municipio ||
      null,

    direccion:
      original.direccion ||
      null,

    horario:
      original.horario ||
      original.dias ||
      null,

    frecuencia:
      original.frecuencia ||
      null,

    fecha_inicio:
      original.fecha_inicio ||
      null,

    fecha_fin:
      original.fecha_fin ||
      null,

    contacto:
      original.contacto ||
      original.tecnico_orienta ||
      null,

    telefono:
      original.telefono ||
      null,

    email:
      original.email ||
      null,

    observaciones_publicas:
      original.observaciones_publicas ||
      null,

    observaciones_unidad:
      "Propuesta creada a partir de una itinerancia publicada para solicitar modificación.",

    unidad_id:
      unidadResponsableId,

    creada_por:
      perfil.id,

    convocatoria_id:
      convocatoria.id,

    itinerancia_publicada_id:
      original.id
  };


  const {
    data,
    error
  } =
    await supabaseClient
      .from("itinerancias_propuestas")
      .insert(payload)
      .select("id")
      .single();

  if (error) {
    throw error;
  }

  window.location.href =
    `nueva-itinerancia.html?propuesta=${encodeURIComponent(data.id)}`;
}


async function confirmarNuevaConCoincidenciasV1(
  payload,
  perfil,
  convocatoria,
  unidadResponsableId
) {

  const {
    publicadas,
    propuestas
  } =
    await buscarCoincidenciasUbicacionNuevaV1(
      payload,
      unidadResponsableId,
      convocatoria.id
    );


  /*
    1. Prioridad: ya existe PUBLICADA.
  */
  if (publicadas.length) {

    const existente =
      publicadas[0];

    const detalle =
      resumenPublicadaCoincidenteV1(
        existente
      );

    const modificar =
      confirm(
        "Ya existe una itinerancia PUBLICADA de esta unidad " +
        "en el mismo municipio y dirección.\n\n" +
        detalle +
        "\n\n" +
        (
          publicadas.length > 1
            ? `Además hay ${publicadas.length} itinerancias publicadas en esta misma ubicación.\n\n`
            : ""
        ) +
        "¿Quieres MODIFICAR una itinerancia ya publicada?\n\n" +
        "ACEPTAR = modificar la existente\n" +
        "CANCELAR = valorar crear una nueva distinta"
      );

    if (modificar) {

      await crearModificacionDesdeCoincidenciaV1(
        existente,
        perfil,
        convocatoria,
        unidadResponsableId
      );

      return false;
    }


    const nuevaReal =
      confirm(
        "¿Confirmas que quieres crear una NUEVA itinerancia " +
        "distinta en esta misma ubicación?\n\n" +
        "Úsalo solo si realmente deben existir dos itinerancias " +
        "diferentes de la misma unidad en este municipio y dirección.\n\n" +
        "ACEPTAR = sí, crear otra distinta\n" +
        "CANCELAR = no enviar"
      );

    return nuevaReal;
  }


  /*
    2. No hay publicada, pero sí propuesta existente.
  */
  if (propuestas.length) {

    const prioridad = {
      PENDIENTE_VALIDACION: 1,
      VALIDADA: 2,
      BORRADOR: 3,
      RECHAZADA: 4
    };

    const ordenadas =
      propuestas
        .slice()
        .sort(
          (a, b) =>
            (
              prioridad[
                String(a.estado || "").toUpperCase()
              ] || 99
            ) -
            (
              prioridad[
                String(b.estado || "").toUpperCase()
              ] || 99
            )
        );

    const existente =
      ordenadas[0];

    const estado =
      String(
        existente.estado || ""
      ).toUpperCase();

    const detalle =
      resumenPropuestaCoincidenteV1(
        existente
      );

    const abrir =
      confirm(
        "Ya existe una PROPUESTA de esta unidad " +
        "para el mismo municipio y dirección.\n\n" +
        `Estado: ${estado}\n` +
        detalle +
        "\n\n" +
        (
          propuestas.length > 1
            ? `Se han encontrado ${propuestas.length} propuestas en esta misma ubicación.\n\n`
            : ""
        ) +
        "¿Quieres abrir la propuesta existente?\n\n" +
        "ACEPTAR = abrir la existente\n" +
        "CANCELAR = valorar crear otra nueva distinta"
      );

    if (abrir) {

      window.location.href =
        `nueva-itinerancia.html?id=${encodeURIComponent(existente.id)}`;

      return false;
    }


    const nuevaReal =
      confirm(
        "¿Confirmas que se trata realmente de una NUEVA " +
        "itinerancia distinta en la misma ubicación?\n\n" +
        "ACEPTAR = crear otra distinta\n" +
        "CANCELAR = no enviar"
      );

    return nuevaReal;
  }


  /*
    No existe coincidencia.
  */
  return true;
}

// === FIN_DECIDIR_NUEVA_O_MODIFICAR_V1 ===


// === CAMPOS_OBLIGATORIOS_PROPUESTA_V2 ===

function aplicarCamposObligatoriosPropuestaV2() {

  /*
    Todos los campos de contenido son obligatorios.
    Solo las dos observaciones permanecen opcionales.
  */
  const obligatorios = [
    "municipio",
    "direccion",
    "horario",
    "frecuencia",
    "fechaInicio",
    "fechaFin",
    "contacto",
    "telefono",
    "emailContacto"
  ];

  for (const id of obligatorios) {

    const el =
      document.getElementById(id);

    if (el) {
      el.required = true;
      el.setAttribute(
        "aria-required",
        "true"
      );
    }
  }


  const opcionales = [
    "observacionesPublicas",
    "observacionesUnidad"
  ];

  for (const id of opcionales) {

    const el =
      document.getElementById(id);

    if (el) {
      el.required = false;
      el.removeAttribute(
        "aria-required"
      );
    }
  }
}


function validarCamposObligatoriosPropuestaV2(
  payload
) {

  aplicarCamposObligatoriosPropuestaV2();


  const campos = [

    [
      "municipio",
      "Municipio"
    ],

    [
      "direccion",
      "Dirección"
    ],

    [
      "horario",
      "Día/Días"
    ],

    [
      "frecuencia",
      "Frecuencia"
    ],

    [
      "fecha_inicio",
      "Fecha de inicio"
    ],

    [
      "fecha_fin",
      "Fecha de fin"
    ],

    [
      "contacto",
      "Persona/Contacto"
    ],

    [
      "telefono",
      "Teléfono"
    ],

    [
      "email",
      "Correo electrónico"
    ]
  ];


  const faltan =
    campos.filter(
      ([campo]) =>
        !String(
          payload?.[campo] ?? ""
        ).trim()
    );


  if (faltan.length) {

    const nombres =
      faltan
        .map(
          ([, nombre]) =>
            nombre
        )
        .join(", ");


    mostrarMsg(
      "Debes completar todos los campos obligatorios. " +
      "Falta: " +
      nombres +
      ". Las observaciones son los únicos campos opcionales.",
      true
    );


    /*
      Colocamos el foco en el primer campo vacío.
    */
    const idsPorCampo = {

      municipio:
        "municipio",

      direccion:
        "direccion",

      horario:
        "horario",

      frecuencia:
        "frecuencia",

      fecha_inicio:
        "fechaInicio",

      fecha_fin:
        "fechaFin",

      contacto:
        "contacto",

      telefono:
        "telefono",

      email:
        "emailContacto"
    };


    const primerCampo =
      faltan[0]?.[0];


    const el =
      document.getElementById(
        idsPorCampo[
          primerCampo
        ] || ""
      );


    if (el) {

      try {
        el.focus();
      } catch (_) {}
    }


    return false;
  }


  /*
    Comprobación sencilla del correo.
  */
  const email =
    String(
      payload.email || ""
    ).trim();


  if (
    email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      email
    )
  ) {

    mostrarMsg(
      "El correo electrónico no tiene un formato válido.",
      true
    );


    document.getElementById(
      "emailContacto"
    )?.focus();


    return false;
  }


  return true;
}


/*
  También reflejamos visualmente en el propio
  formulario qué controles son obligatorios.
*/
function inicializarObligatoriosPropuestaV2() {

  aplicarCamposObligatoriosPropuestaV2();
}


if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    inicializarObligatoriosPropuestaV2
  );

} else {

  inicializarObligatoriosPropuestaV2();
}

// === FIN_CAMPOS_OBLIGATORIOS_PROPUESTA_V2 ===


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

  if (
    !validarCamposObligatoriosPropuestaV2(
      payload
    )
  ) {
    return;
  }

  const unidadResponsable =
    unidadResponsableSeleccionadaFormulario(
      perfil
    );

  if (!unidadResponsable) {
    mostrarMsg(
      "No se ha podido determinar la unidad responsable de la propuesta.",
      true
    );
    return;
  }

  const unidadResponsableId =
    idUnidadFormulario(
      unidadResponsable
    );

  if (!unidadResponsableId) {
    mostrarMsg(
      "La unidad responsable seleccionada no es válida.",
      true
    );
    return;
  }

  /*
    Generamos el título utilizando la unidad
    realmente seleccionada, no necesariamente
    la unidad activa con la que entró al formulario.
  */
  const perfilParaTitulo = {
    ...perfil,
    unidad_id:
      unidadResponsableId,
    unidades:
      unidadResponsable
  };

  payload.titulo =
    generarTituloPropuesta(
      perfilParaTitulo,
      payload
    );

  /*
    Guardamos también los datos normalizados de
    la unidad para que filtros y publicación sean
    coherentes.
  */
  aplicarUnidadResponsablePayload(
    payload,
    unidadResponsable
  );

  payload.creada_por = perfil.id;
  payload.convocatoria_id = convocatoria.id;

  // === COMPROBAR_NUEVA_UBICACION_V1 ===
  if (
    estado === "PENDIENTE_VALIDACION" &&
    String(
      payload.tipo || "NUEVA"
    ).toUpperCase() === "NUEVA"
  ) {

    try {

      const continuar =
        await confirmarNuevaConCoincidenciasV1(
          payload,
          perfil,
          convocatoria,
          unidadResponsableId
        );

      if (!continuar) {
        return;
      }

    } catch (err) {

      console.error(
        "Error comprobando propuestas/itinerancias existentes:",
        err
      );

      mostrarMsg(
        "No se ha podido comprobar si ya existe una itinerancia " +
        "o propuesta en esta ubicación. " +
        "Por seguridad no se ha enviado la propuesta.",
        true
      );

      return;
    }
  }
  // === FIN_COMPROBAR_NUEVA_UBICACION_V1 ===

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

  /*
    Si al modificar se ha trasladado a otra unidad,
    al volver al panel dejamos seleccionada esa
    unidad para que el usuario vea inmediatamente
    la propuesta modificada.
  */
  if (
    perfil?.id &&
    unidadResponsableId
  ) {
    sessionStorage.setItem(
      `itinerancias_unidad_activa_${perfil.id}`,
      unidadResponsableId
    );
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

  if (!["BORRADOR", "RECHAZADA", "PENDIENTE_VALIDACION"].includes(String(data.estado || ""))) {
    mostrarMsg("Esta propuesta ya no se puede editar porque está publicada o archivada.", true);
    return;
  }

  /*
    SEGURIDAD MULTIUNIDAD:
    la propuesta solo puede editarse si pertenece a una
    unidad asignada al usuario.

    Además, si el usuario tiene varias unidades y la
    unidad activa no coincide, activamos la unidad de
    la propuesta y recargamos antes de editar.
  */
  const unidadesAutorizadasEdicion =
    Array.isArray(perfil.unidades_asignadas)
      ? perfil.unidades_asignadas
      : [];

  const unidadPropuestaId =
    String(data.unidad_id || "");

  const unidadAutorizada =
    String(perfil.unidad_id || "") === unidadPropuestaId ||
    unidadesAutorizadasEdicion.some(
      u =>
        String(
          u.unidad_id ||
          u.id ||
          ""
        ) === unidadPropuestaId
    );

  if (
    unidadPropuestaId &&
    !unidadAutorizada
  ) {
    mostrarMsg(
      "Esta propuesta pertenece a una unidad que no tienes asignada.",
      true
    );
    return;
  }

  if (
    unidadPropuestaId &&
    String(perfil.unidad_id || "") !==
      unidadPropuestaId
  ) {
    sessionStorage.setItem(
      `itinerancias_unidad_activa_${perfil.id}`,
      unidadPropuestaId
    );

    window.location.reload();
    return;
  }

  prepararSelectorUnidadResponsableEdicion(
    perfil,
    data
  );

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

  const estadoEdicion =
    String(
      data.estado || ""
    ).toUpperCase();

  const h1 =
    document.querySelector("h1");

  if (h1) {
    h1.textContent =
      estadoEdicion === "PENDIENTE_VALIDACION"
        ? "Modificar propuesta pendiente"
        : "Editar propuesta de itinerancia";
  }

  const botonEnviar =
    $("formNuevaItinerancia")
      ?.querySelector(
        'button[type="submit"]'
      );

  const botonBorrador =
    $("btnGuardarBorrador");

  if (
    estadoEdicion ===
    "PENDIENTE_VALIDACION"
  ) {
    /*
      Una propuesta ya enviada no debe volver
      accidentalmente a BORRADOR.
    */
    if (botonBorrador) {
      botonBorrador.classList.add(
        "oculto"
      );
    }

    if (botonEnviar) {
      botonEnviar.textContent =
        "Guardar cambios";
    }

    mostrarMsg(
      "Estás modificando una propuesta pendiente de validación. Al guardar continuará pendiente de revisión."
    );

  } else {
    if (botonEnviar) {
      botonEnviar.textContent =
        "Enviar a validación";
    }

    if (
      estadoEdicion ===
      "RECHAZADA"
    ) {
      const motivoRechazo =
        String(
          data.observaciones_dp || ""
        ).trim();

      mostrarMsg(
        motivoRechazo
          ? "Propuesta devuelta por Dirección Provincial. " +
            "Observaciones DP: " +
            motivoRechazo +
            " Corrige lo indicado y pulsa «Enviar a validación»."
          : "Propuesta devuelta por Dirección Provincial. " +
            "Corrige los datos necesarios y pulsa «Enviar a validación».",
        true
      );

    } else {
      mostrarMsg(
        "Editando borrador de propuesta."
      );
    }
  }
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





// === LOGIN_MOTIVO_USUARIO_INACTIVO_V1 ===
document.addEventListener("DOMContentLoaded", () => {
  try {
    const params = new URLSearchParams(window.location.search || "");
    if (params.get("motivo") === "usuario-inactivo") {
      mostrarMsg("Tu usuario no está activo. Contacta con Dirección Provincial.", true);
    }
  } catch (err) {
    console.error(err);
  }
});
// === FIN_LOGIN_MOTIVO_USUARIO_INACTIVO_V1 ===

// === RECUPERAR_CLAVE_Y_CONTROL_SOLICITUD_V1 ===
function urlRedireccionRecuperarClave() {
  return `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}login.html?modo=cambiar-clave`;
}

async function estadoAccesoPorEmailItinerancias(email) {
  const correo = String(email || "").trim().toLowerCase();

  if (!correo) {
    return { estado: "EMAIL_VACIO" };
  }

  const { data, error } = await supabaseClient.rpc("estado_acceso_itinerancias_por_email", {
    p_email: correo
  });

  if (error) {
    console.error("No se ha podido comprobar el estado del acceso", error);
    return { estado: "DESCONOCIDO", error };
  }

  if (Array.isArray(data) && data[0]) return data[0];
  return data || { estado: "NO_EXISTE", email: correo };
}

async function enviarRecuperacionClaveItinerancias(email, { silencioso = false } = {}) {
  const correo = String(email || "").trim().toLowerCase();

  if (!correo) {
    mostrarMsg("Introduce tu correo electrónico para recuperar o cambiar la clave.", true);
    return false;
  }

  const { error } = await supabaseClient.auth.resetPasswordForEmail(correo, {
    redirectTo: urlRedireccionRecuperarClave()
  });

  if (error) {
    console.error(error);
    const detalle = error?.message && error.message !== "{}"
      ? error.message
      : "revisa la configuración de correos de Supabase Auth: SMTP, plantilla Reset Password y URLs permitidas.";
    mostrarMsg("No se ha podido enviar el correo de recuperación: " + detalle, true);
    return false;
  }

  if (!silencioso) {
    mostrarMsg("Te hemos enviado un correo para cambiar la clave. Revisa también la carpeta de spam.");
  }

  return true;
}

async function pedirCorreoYEnviarRecuperacionClave() {
  const emailInput = $("loginEmail") || $("solEmail");
  const sugerido = emailInput?.value?.trim() || "";

  const correo = prompt("Introduce el correo electrónico con el que accedes al panel:", sugerido);
  if (!correo) return;

  const estado = await estadoAccesoPorEmailItinerancias(correo);

  if (estado.estado === "INACTIVO") {
    mostrarMsg("Tu usuario existe, pero no está activo. Debes solicitar acceso de nuevo.", true);
    return;
  }

  if (estado.estado === "NO_EXISTE") {
    mostrarMsg("No consta un usuario activo con ese correo. Solicita acceso primero.", true);
    return;
  }

  await enviarRecuperacionClaveItinerancias(correo);
}

function activarFormularioCambioClaveSiProcede() {
  const params = new URLSearchParams(window.location.search || "");
  const modo = params.get("modo");
  const bloque = $("bloqueNuevaClave");

  if (modo === "cambiar-clave" && bloque) {
    bloque.classList.remove("oculto");
    mostrarMsg("Introduce la nueva clave para completar el cambio.");
  }
}

async function guardarNuevaClaveItinerancias() {
  const c1 = $("nuevaClave")?.value || "";
  const c2 = $("nuevaClave2")?.value || "";

  if (c1.length < 8) {
    mostrarMsg("La clave debe tener al menos 8 caracteres.", true);
    return;
  }

  if (c1 !== c2) {
    mostrarMsg("Las claves no coinciden.", true);
    return;
  }

  const { error } = await supabaseClient.auth.updateUser({
    password: c1
  });

  if (error) {
    console.error(error);
    mostrarMsg("No se ha podido cambiar la clave: " + error.message, true);
    return;
  }

  mostrarMsg("Clave actualizada correctamente. Ya puedes acceder al panel.");

  setTimeout(() => {
    window.location.href = "login.html";
  }, 1200);
}

async function solicitudAccesoPermitidaPorEstadoEmail(payload) {
  const correo = String(payload?.email || "").trim().toLowerCase();

  if (!correo) {
    mostrarMsg("Debes indicar un correo electrónico.", true);
    return false;
  }

  const estado = await estadoAccesoPorEmailItinerancias(correo);
  const e = String(estado.estado || "").toUpperCase();

  if (e === "ACTIVO") {
    const enviar = confirm(
      "Este correo ya tiene un usuario activo en el panel de itinerancias.\n\n" +
      "No se va a crear una nueva solicitud.\n\n" +
      "¿Quieres que enviemos un correo para recuperar o cambiar la clave?"
    );

    if (enviar) {
      await enviarRecuperacionClaveItinerancias(correo, { silencioso: true });
      mostrarMsg("El usuario ya está activo. Se ha enviado un correo para recuperar o cambiar la clave.");
    } else {
      mostrarMsg("El usuario ya está activo. Debe acceder con su clave o usar recuperación de clave.");
    }

    return false;
  }

  if (e === "INACTIVO") {
    return true;
  }

  if (e === "NO_EXISTE" || e === "AUTH_SIN_PERFIL" || e === "DESCONOCIDO") {
    return true;
  }

  return true;
}

(function instalarRecuperacionClaveYControlSolicitud() {
  const solicitarAccesoOriginal = window.solicitarAcceso || (typeof solicitarAcceso === "function" ? solicitarAcceso : null);

  if (solicitarAccesoOriginal && !window.__solicitarAccesoControlEmailInstalado) {
    window.__solicitarAccesoControlEmailInstalado = true;

    window.solicitarAcceso = async function solicitarAccesoControlEmailWrapper(payload) {
      const permitido = await solicitudAccesoPermitidaPorEstadoEmail(payload);
      if (!permitido) return;
      return await solicitarAccesoOriginal(payload);
    };

    try {
      solicitarAcceso = window.solicitarAcceso;
    } catch {}
  }

  document.addEventListener("DOMContentLoaded", () => {
    activarFormularioCambioClaveSiProcede();

    $("btnRecordarClave")?.addEventListener("click", pedirCorreoYEnviarRecuperacionClave);

    $("formNuevaClave")?.addEventListener("submit", async e => {
      e.preventDefault();
      await guardarNuevaClaveItinerancias();
    });
  });
})();
// === FIN_RECUPERAR_CLAVE_Y_CONTROL_SOLICITUD_V1 ===

// === RESET_CLAVE_SOLO_USUARIOS_ACTIVOS_V2 ===
async function estadoAccesoActivoPorEmailV2(email) {
  const correo = String(email || "").trim().toLowerCase();

  if (!correo) {
    return { estado: "EMAIL_VACIO" };
  }

  const { data, error } = await supabaseClient.rpc("estado_acceso_itinerancias_por_email", {
    p_email: correo
  });

  if (error) {
    console.error(error);
    return { estado: "DESCONOCIDO", error };
  }

  if (Array.isArray(data) && data[0]) return data[0];
  return data || { estado: "NO_EXISTE", email: correo };
}

async function usuarioActualTienePerfilActivoV2() {
  const { data: authData, error: authError } = await supabaseClient.auth.getUser();

  if (authError || !authData?.user) {
    return { ok: false, motivo: "NO_AUTH" };
  }

  const user = authData.user;

  const { data, error } = await supabaseClient
    .from("usuarios_perfiles")
    .select("id,email,nombre,activo")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, motivo: "SIN_PERFIL" };
  }

  if (!data.activo) {
    return { ok: false, motivo: "INACTIVO", perfil: data };
  }

  return { ok: true, perfil: data };
}

async function enviarRecuperacionClaveItineranciasV2(email, { silencioso = false } = {}) {
  const correo = String(email || "").trim().toLowerCase();

  if (!correo) {
    mostrarMsg("Introduce tu correo electrónico para recuperar o cambiar la clave.", true);
    return false;
  }

  const estado = await estadoAccesoActivoPorEmailV2(correo);
  const e = String(estado.estado || "").toUpperCase();

  if (e === "INACTIVO") {
    mostrarMsg("Tu usuario no está activo. Para volver a acceder debes solicitar acceso de nuevo.", true);
    return false;
  }

  if (e !== "ACTIVO") {
    mostrarMsg("No consta un usuario activo con ese correo. Solicita acceso primero.", true);
    return false;
  }

  const { error } = await supabaseClient.auth.resetPasswordForEmail(correo, {
    redirectTo: urlRedireccionRecuperarClave()
  });

  if (error) {
    console.error(error);
    const detalle = error?.message && error.message !== "{}"
      ? error.message
      : "revisa la configuración de correos de Supabase Auth: SMTP, plantilla Reset Password y URLs permitidas.";
    mostrarMsg("No se ha podido enviar el correo de recuperación: " + detalle, true);
    return false;
  }

  if (!silencioso) {
    mostrarMsg("Te hemos enviado un correo para cambiar la clave. Revisa también la carpeta de spam.");
  }

  return true;
}

async function pedirCorreoYEnviarRecuperacionClaveV2() {
  const emailInput = $("loginEmail") || $("solEmail");
  const sugerido = emailInput?.value?.trim() || "";

  const correo = prompt("Introduce el correo electrónico con el que accedes al panel:", sugerido);
  if (!correo) return;

  await enviarRecuperacionClaveItineranciasV2(correo);
}

async function prepararPantallaCambioClaveV2() {
  const params = new URLSearchParams(window.location.search || "");
  const modo = params.get("modo");

  if (modo !== "cambiar-clave") return;

  const formLogin = $("formLogin");
  const bloqueNuevaClave = $("bloqueNuevaClave");
  const btnRecordar = $("btnRecordarClave");

  if (formLogin) formLogin.classList.add("oculto");
  if (btnRecordar) btnRecordar.closest(".enlace-secundario")?.classList.add("oculto");

  const estado = await usuarioActualTienePerfilActivoV2();

  if (!estado.ok) {
    if (bloqueNuevaClave) bloqueNuevaClave.classList.add("oculto");

    try {
      await supabaseClient.auth.signOut();
    } catch {}

    if (estado.motivo === "INACTIVO") {
      mostrarMsg("Tu usuario no está activo. No puedes cambiar la clave. Debes solicitar acceso de nuevo.", true);
    } else {
      mostrarMsg("El enlace de recuperación no es válido o ha caducado. Solicita un nuevo cambio de clave.", true);
    }

    return;
  }

  if (bloqueNuevaClave) bloqueNuevaClave.classList.remove("oculto");
  mostrarMsg("Introduce dos veces tu nueva clave para completar el cambio.");
}

async function guardarNuevaClaveItineranciasV2() {
  const estado = await usuarioActualTienePerfilActivoV2();

  if (!estado.ok) {
    try {
      await supabaseClient.auth.signOut();
    } catch {}

    mostrarMsg("No puedes cambiar la clave porque el usuario no está activo. Solicita acceso de nuevo.", true);
    return;
  }

  const c1 = $("nuevaClave")?.value || "";
  const c2 = $("nuevaClave2")?.value || "";

  if (c1.length < 8) {
    mostrarMsg("La clave debe tener al menos 8 caracteres.", true);
    return;
  }

  if (c1 !== c2) {
    mostrarMsg("Las claves no coinciden.", true);
    return;
  }

  const { error } = await supabaseClient.auth.updateUser({
    password: c1
  });

  if (error) {
    console.error(error);
    mostrarMsg("No se ha podido cambiar la clave: " + error.message, true);
    return;
  }

  mostrarMsg("Clave actualizada correctamente. Ya puedes acceder al panel.");

  setTimeout(() => {
    window.location.href = "login.html";
  }, 1200);
}

async function solicitudAccesoPermitidaPorEstadoEmailV2(payload) {
  const correo = String(payload?.email || "").trim().toLowerCase();

  if (!correo) {
    mostrarMsg("Debes indicar un correo electrónico.", true);
    return false;
  }

  const estado = await estadoAccesoActivoPorEmailV2(correo);
  const e = String(estado.estado || "").toUpperCase();

  if (e === "ACTIVO") {
    const enviar = confirm(
      "Este correo ya tiene un usuario activo en el panel de itinerancias.\n\n" +
      "No procede crear una nueva solicitud.\n\n" +
      "¿Quieres que enviemos un correo para cambiar la clave?"
    );

    if (enviar) {
      await enviarRecuperacionClaveItineranciasV2(correo, { silencioso: true });
      mostrarMsg("El usuario ya está activo. Se ha enviado un correo para cambiar la clave.");
    } else {
      mostrarMsg("El usuario ya está activo. Debe acceder con su clave o usar la opción de cambiar clave.");
    }

    return false;
  }

  if (e === "INACTIVO") {
    return true;
  }

  return true;
}

(function instalarResetClaveSoloActivosV2() {
  // Reasignamos nombres usados por los listeners antiguos para que apunten a la versión corregida.
  try {
    enviarRecuperacionClaveItinerancias = enviarRecuperacionClaveItineranciasV2;
  } catch {}

  try {
    pedirCorreoYEnviarRecuperacionClave = pedirCorreoYEnviarRecuperacionClaveV2;
  } catch {}

  try {
    guardarNuevaClaveItinerancias = guardarNuevaClaveItineranciasV2;
  } catch {}

  try {
    solicitudAccesoPermitidaPorEstadoEmail = solicitudAccesoPermitidaPorEstadoEmailV2;
  } catch {}

  document.addEventListener("DOMContentLoaded", () => {
    prepararPantallaCambioClaveV2();

    const btn = $("btnRecordarClave");
    if (btn) {
      const nuevo = btn.cloneNode(true);
      btn.parentNode.replaceChild(nuevo, btn);
      nuevo.addEventListener("click", pedirCorreoYEnviarRecuperacionClaveV2);
    }

    const formNueva = $("formNuevaClave");
    if (formNueva) {
      const nuevoForm = formNueva.cloneNode(true);
      formNueva.parentNode.replaceChild(nuevoForm, formNueva);
      nuevoForm.addEventListener("submit", async e => {
        e.preventDefault();
        await guardarNuevaClaveItineranciasV2();
      });
    }
  });
})();
// === FIN_RESET_CLAVE_SOLO_USUARIOS_ACTIVOS_V2 ===

// === CAMBIO_CLAVE_MANUAL_ADMIN_V1 ===
async function solicitarCambioClaveManualItinerancias(email) {
  const correo = String(email || "").trim().toLowerCase();

  if (!correo) {
    mostrarMsg("Introduce tu correo electrónico para solicitar el cambio de clave.", true);
    return false;
  }

  const { data, error } = await supabaseClient.rpc("solicitar_cambio_clave_itinerancias", {
    p_email: correo
  });

  if (error) {
    console.error(error);
    mostrarMsg("No se ha podido registrar la solicitud de cambio de clave. Contacta con Dirección Provincial.", true);
    return false;
  }

  const resultado = Array.isArray(data) ? data[0] : data;
  const ok = resultado?.ok === true;
  const mensaje = resultado?.mensaje || "Solicitud procesada.";

  mostrarMsg(mensaje, !ok);

  return ok;
}

async function pedirCambioClaveManualItinerancias() {
  const emailInput = $("loginEmail");
  const sugerido = emailInput?.value?.trim() || "";

  const correo = prompt(
    "Introduce el correo electrónico con el que accedes al panel de itinerancias:",
    sugerido
  );

  if (!correo) return;

  await solicitarCambioClaveManualItinerancias(correo);
}

(function instalarCambioClaveManualAdminV1() {
  document.addEventListener("DOMContentLoaded", () => {
    const btn = $("btnRecordarClave");

    if (btn) {
      btn.textContent = "Solicitar cambio de clave";
      btn.title = "Solicita a Dirección Provincial una clave temporal.";

      const nuevo = btn.cloneNode(true);
      btn.parentNode.replaceChild(nuevo, btn);

      nuevo.addEventListener("click", pedirCambioClaveManualItinerancias);
    }

    const bloqueNuevaClave = $("bloqueNuevaClave");
    if (bloqueNuevaClave) {
      bloqueNuevaClave.classList.add("oculto");
      bloqueNuevaClave.classList.add("bloque-desactivado-recuperacion");
    }
  });
})();
// === FIN_CAMBIO_CLAVE_MANUAL_ADMIN_V1 ===

// === CAMBIO_CLAVE_MANUAL_ADMIN_V1 ===
async function solicitarCambioClaveManualItinerancias(email) {
  const correo = String(email || "").trim().toLowerCase();

  if (!correo) {
    mostrarMsg("Introduce tu correo electrónico para solicitar el cambio de clave.", true);
    return false;
  }

  const { data, error } = await supabaseClient.rpc("solicitar_cambio_clave_itinerancias", {
    p_email: correo
  });

  if (error) {
    console.error(error);
    mostrarMsg("No se ha podido registrar la solicitud de cambio de clave. Contacta con Dirección Provincial.", true);
    return false;
  }

  const resultado = Array.isArray(data) ? data[0] : data;
  const ok = resultado?.ok === true;
  const mensaje = resultado?.mensaje || "Solicitud procesada.";

  mostrarMsg(mensaje, !ok);

  return ok;
}

async function pedirCambioClaveManualItinerancias() {
  const emailInput = $("loginEmail");
  const sugerido = emailInput?.value?.trim() || "";

  const correo = prompt(
    "Introduce el correo electrónico con el que accedes al panel de itinerancias:",
    sugerido
  );

  if (!correo) return;

  await solicitarCambioClaveManualItinerancias(correo);
}

(function instalarCambioClaveManualAdminV1() {
  document.addEventListener("DOMContentLoaded", () => {
    const btn = $("btnRecordarClave");

    if (btn) {
      btn.textContent = "Solicitar cambio de clave";
      btn.title = "Solicita a Dirección Provincial una clave temporal.";

      const nuevo = btn.cloneNode(true);
      btn.parentNode.replaceChild(nuevo, btn);

      nuevo.addEventListener("click", pedirCambioClaveManualItinerancias);
    }

    const bloqueNuevaClave = $("bloqueNuevaClave");
    if (bloqueNuevaClave) {
      bloqueNuevaClave.classList.add("oculto");
      bloqueNuevaClave.classList.add("bloque-desactivado-recuperacion");
    }
  });
})();
// === FIN_CAMBIO_CLAVE_MANUAL_ADMIN_V1 ===

// === CAMBIO_CLAVE_OBLIGATORIO_V1 ===
let cambioClaveObligatorioPendiente = false;
let perfilCambioClaveObligatorio = null;

function msgCambioClaveObligatorio(texto, error = false) {
  const el = $("msgCambioClaveObligatorio");
  if (!el) return;
  el.textContent = texto || "";
  el.className = error ? "msg error" : "msg ok";
}

function abrirCambioClaveObligatorio(perfil) {
  cambioClaveObligatorioPendiente = true;
  perfilCambioClaveObligatorio = perfil || perfilActual || null;

  const modal = $("modalCambioClaveObligatorio");
  if (!modal) {
    mostrarMsg("Debes cambiar la clave temporal antes de continuar.", true);
    return;
  }

  try {
    modal.showModal();
  } catch {
    modal.setAttribute("open", "open");
  }

  msgCambioClaveObligatorio("");

  const c1 = $("claveObligatoria1");
  if (c1) c1.focus();
}

function cerrarCambioClaveObligatorio() {
  const modal = $("modalCambioClaveObligatorio");
  if (!modal) return;

  try {
    modal.close();
  } catch {
    modal.removeAttribute("open");
  }
}

async function guardarCambioClaveObligatorio() {
  const c1 = $("claveObligatoria1")?.value || "";
  const c2 = $("claveObligatoria2")?.value || "";

  if (c1.length < 8) {
    msgCambioClaveObligatorio("La clave debe tener al menos 8 caracteres.", true);
    return;
  }

  if (c1 !== c2) {
    msgCambioClaveObligatorio("Las claves no coinciden.", true);
    return;
  }

  msgCambioClaveObligatorio("Actualizando clave...");

  const { error: authError } = await supabaseClient.auth.updateUser({
    password: c1
  });

  if (authError) {
    console.error(authError);
    msgCambioClaveObligatorio("No se ha podido actualizar la clave: " + authError.message, true);
    return;
  }

  const { data: rpcData, error: perfilError } = await supabaseClient
    .rpc("completar_cambio_clave_itinerancias");

  const resultadoRpc = Array.isArray(rpcData) ? rpcData[0] : rpcData;

  if (perfilError || resultadoRpc?.ok !== true) {
    console.error(perfilError || resultadoRpc);
    msgCambioClaveObligatorio(
      "La clave se ha actualizado, pero no se ha podido completar el cambio en el perfil. Contacta con Dirección Provincial.",
      true
    );
    return;
  }

  cambioClaveObligatorioPendiente = false;

  if (perfilActual) {
    perfilActual.debe_cambiar_clave = false;
  }

  msgCambioClaveObligatorio("Clave cambiada correctamente. Cargando panel...");

  // Limpiamos también el aviso general que se mostró antes de abrir el modal.
  mostrarMsg("");

  setTimeout(async () => {
    cerrarCambioClaveObligatorio();

    try {
      mostrarMsg("");
      await cargarPanel();
      mostrarMsg("");
    } catch (err) {
      console.error(err);
      mostrarMsg("Clave cambiada. Recarga la página para continuar.", true);
    }
  }, 900);
}

function instalarCambioClaveObligatorio() {
  const form = $("formCambioClaveObligatorio");
  if (!form || form.dataset.instaladoCambioClave === "1") return;

  form.dataset.instaladoCambioClave = "1";

  form.addEventListener("submit", async e => {
    e.preventDefault();
    await guardarCambioClaveObligatorio();
  });

  const modal = $("modalCambioClaveObligatorio");
  if (modal) {
    modal.addEventListener("cancel", e => {
      if (cambioClaveObligatorioPendiente) {
        e.preventDefault();
        msgCambioClaveObligatorio("Debes cambiar la clave temporal para continuar.", true);
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", instalarCambioClaveObligatorio);
// === FIN_CAMBIO_CLAVE_OBLIGATORIO_V1 ===


// === SELECTOR_UNIDAD_TRABAJO_V3 ===
(() => {

  function textoUnidadTrabajoV3(unidad) {
    return [
      unidad?.nombre,
      unidad?.municipio
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function detalleUnidadTrabajoV3(unidad) {
    const partes = [];

    if (unidad?.direccion) {
      partes.push(`
        <span>
          <strong>Dirección:</strong>
          ${escapeHtml(unidad.direccion)}
        </span>
      `);
    }

    if (unidad?.telefono) {
      partes.push(`
        <span>
          <strong>Teléfono:</strong>
          ${escapeHtml(unidad.telefono)}
        </span>
      `);
    }

    if (!partes.length) {
      return "";
    }

    return `
      <div class="detalle-unidad-trabajo-v3">
        ${partes.join("")}
      </div>
    `;
  }

  function instalarEstilosUnidadTrabajoV3() {

    if (
      document.getElementById(
        "estilosSelectorUnidadTrabajoV3"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "estilosSelectorUnidadTrabajoV3";

    style.textContent = `
      .selector-unidad-trabajo-v3 {
        display: grid;
        grid-template-columns:
          minmax(0, 1fr)
          minmax(320px, 48%);
        gap: 18px;
        align-items: center;
        margin: 14px 0 18px;
        padding: 14px 16px;
        border: 1px solid #d9dfe5;
        border-radius: 10px;
        background: #f7f9fa;
      }

      .selector-unidad-trabajo-v3 strong {
        display: block;
        margin-bottom: 4px;
      }

      .selector-unidad-trabajo-v3 .descripcion {
        display: block;
        font-size: .9rem;
        opacity: .75;
      }

      .selector-unidad-trabajo-v3 label {
        display: block;
        margin-bottom: 5px;
        font-weight: 600;
      }

      .selector-unidad-trabajo-v3 select {
        width: 100%;
      }

      .unidad-trabajo-nombre-v3 {
        font-weight: 600;
        line-height: 1.35;
      }

      .detalle-unidad-trabajo-v3 {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 18px;
        margin-top: 8px;
        font-size: .9rem;
        line-height: 1.4;
      }

      .detalle-unidad-trabajo-v3 strong {
        display: inline;
        margin: 0;
      }

      @media (max-width: 760px) {
        .selector-unidad-trabajo-v3 {
          grid-template-columns: 1fr;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function instalarSelectorUnidadTrabajoV3() {

    const perfil =
      typeof perfilActual !== "undefined"
        ? perfilActual
        : null;

    if (!perfil) {
      return;
    }

    let unidades =
      Array.isArray(
        perfil.unidades_asignadas
      )
        ? perfil.unidades_asignadas.filter(
            u => u.activo !== false
          )
        : [];

    /*
      Compatibilidad con usuarios antiguos
      que todavía no tengan relación explícita
      en usuarios_unidades.
    */
    if (
      !unidades.length &&
      perfil.unidades
    ) {
      unidades = [{
        ...(perfil.unidades || {}),
        unidad_id:
          perfil.unidad_id ||
          perfil.unidades?.id ||
          null,
        principal: true,
        activo: true
      }];
    }

    const existente =
      document.getElementById(
        "selectorUnidadTrabajoBloqueV2"
      ) ||
      document.getElementById(
        "selectorUnidadTrabajoBloqueV3"
      );

    if (!unidades.length) {
      existente?.remove();
      return;
    }

    instalarEstilosUnidadTrabajoV3();

    let bloque = existente;

    if (!bloque) {

      bloque =
        document.createElement("div");

      const cabecera =
        document.querySelector(
          ".panel-unificado-header"
        );

      if (!cabecera) {
        console.warn(
          "No se ha localizado .panel-unificado-header."
        );
        return;
      }

      cabecera.insertAdjacentElement(
        "afterend",
        bloque
      );
    }

    bloque.id =
      "selectorUnidadTrabajoBloqueV3";

    bloque.className =
      "selector-unidad-trabajo-v3";

    const unidadSeleccionada =
      unidades.find(
        u =>
          String(u.unidad_id) ===
          String(perfil.unidad_id)
      ) ||
      unidades[0] ||
      null;

    const esMultiunidad =
      unidades.length > 1;

    bloque.innerHTML = `
      <div>
        <strong>
          ${
            esMultiunidad
              ? "Gestión multiunidad"
              : "Unidad de trabajo"
          }
        </strong>

        <span class="descripcion">
          ${
            esMultiunidad
              ? `Las itinerancias, propuestas y atenciones
                 corresponden a la unidad de trabajo seleccionada.`
              : `Las itinerancias, propuestas y atenciones
                 corresponden a esta unidad.`
          }
        </span>
      </div>

      <div>
        ${
          esMultiunidad
            ? `
              <label for="selectorUnidadTrabajoV3">
                Unidad de trabajo
              </label>

              <select id="selectorUnidadTrabajoV3">
                ${unidades.map(u => `
                  <option
                    value="${escapeHtml(u.unidad_id)}"
                    ${
                      String(u.unidad_id) ===
                      String(perfil.unidad_id)
                        ? "selected"
                        : ""
                    }
                  >
                    ${escapeHtml(
                      textoUnidadTrabajoV3(u)
                    )}
                    ${
                      u.principal === true
                        ? " · Principal"
                        : ""
                    }
                  </option>
                `).join("")}
              </select>
            `
            : `
              <div class="unidad-trabajo-nombre-v3">
                ${escapeHtml(
                  textoUnidadTrabajoV3(
                    unidadSeleccionada
                  )
                )}
              </div>
            `
        }

        ${detalleUnidadTrabajoV3(
          unidadSeleccionada
        )}
      </div>
    `;

    const selector =
      document.getElementById(
        "selectorUnidadTrabajoV3"
      );

    selector?.addEventListener(
      "change",
      () => {

        const nuevaUnidadId =
          String(
            selector.value || ""
          ).trim();

        const autorizada =
          unidades.some(
            u =>
              String(u.unidad_id) ===
              nuevaUnidadId
          );

        if (!autorizada) {

          selector.value =
            perfil.unidad_id || "";

          mostrarMsg(
            "La unidad seleccionada no está autorizada.",
            true
          );

          return;
        }

        sessionStorage.setItem(
          `itinerancias_unidad_activa_${perfil.id}`,
          nuevaUnidadId
        );

        /*
          Mantenemos el comportamiento actual:
          recarga completa para que propuestas,
          itinerancias y atenciones correspondan
          a la nueva unidad.
        */
        window.location.reload();
      }
    );
  }

  /*
    Envolvemos cargarPanel igual que hacía V2.
  */
  if (
    typeof cargarPanel === "function"
  ) {

    const cargarPanelOriginalV3 =
      cargarPanel;

    cargarPanel =
      async function (...args) {

        const resultado =
          await cargarPanelOriginalV3.apply(
            this,
            args
          );

        instalarSelectorUnidadTrabajoV3();

        return resultado;
      };
  }

})();
// === FIN_SELECTOR_UNIDAD_TRABAJO_V3 ===

// === MODO_ADMIN_IMPERSONACION_V1 ===
(() => {
  const CLAVE_MODO =
    "itinerancias_modo_admin_impersonacion";

  const CLAVE_USUARIO =
    "itinerancias_modo_admin_usuario_id";

  const params =
    new URLSearchParams(
      window.location.search
    );

  if (
    params.get("modo_admin") === "1"
  ) {
    sessionStorage.setItem(
      CLAVE_MODO,
      "1"
    );
  }

  function instalarEstilosModoAdmin() {
    if (
      document.getElementById(
        "estilosModoAdminImpersonacion"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "estilosModoAdminImpersonacion";

    style.textContent = `
      .modo-admin-impersonacion {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        padding: 13px 16px;
        margin: 0 0 18px;
        border: 2px solid #8b1e1e;
        border-radius: 10px;
        background: #fff1f1;
        color: #5c1111;
      }

      .modo-admin-impersonacion strong {
        display: block;
        margin-bottom: 3px;
      }

      .modo-admin-impersonacion span {
        display: block;
      }

      .modo-admin-impersonacion button {
        flex: 0 0 auto;
        white-space: nowrap;
      }

      @media (max-width: 700px) {
        .modo-admin-impersonacion {
          display: block;
        }

        .modo-admin-impersonacion button {
          width: 100%;
          margin-top: 12px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  async function salirModoAdmin() {
    try {
      sessionStorage.removeItem(
        CLAVE_MODO
      );

      sessionStorage.removeItem(
        CLAVE_USUARIO
      );

      await supabaseClient.auth.signOut();

    } catch (error) {
      console.error(
        "Error cerrando modo administración:",
        error
      );
    }

    try {
      window.close();
    } catch {}

    setTimeout(() => {
      window.location.href =
        "login.html";
    }, 250);
  }

  function mostrarModoAdmin() {
    if (
      sessionStorage.getItem(
        CLAVE_MODO
      ) !== "1"
    ) {
      return false;
    }

    if (
      typeof perfilActual === "undefined" ||
      !perfilActual?.id
    ) {
      return false;
    }

    const usuarioGuardado =
      sessionStorage.getItem(
        CLAVE_USUARIO
      );

    /*
      La primera vez vinculamos el modo admin
      al usuario que realmente ha iniciado sesión.
    */
    if (!usuarioGuardado) {
      sessionStorage.setItem(
        CLAVE_USUARIO,
        perfilActual.id
      );
    } else if (
      String(usuarioGuardado) !==
      String(perfilActual.id)
    ) {
      /*
        Evita que una marca antigua de sessionStorage
        aparezca con otro usuario.
      */
      sessionStorage.removeItem(
        CLAVE_MODO
      );

      sessionStorage.removeItem(
        CLAVE_USUARIO
      );

      return true;
    }

    if (
      document.getElementById(
        "modoAdminImpersonacion"
      )
    ) {
      return true;
    }

    instalarEstilosModoAdmin();

    const barra =
      document.createElement("div");

    barra.id =
      "modoAdminImpersonacion";

    barra.className =
      "modo-admin-impersonacion";

    const nombre =
      perfilActual.nombre ||
      perfilActual.email ||
      "usuario";

    barra.innerHTML = `
      <div>
        <strong>
          MODO ADMINISTRACIÓN
        </strong>

        <span>
          Estás actuando como
          <strong style="display:inline">
            ${escapeHtml(nombre)}
          </strong>
          ${perfilActual.email
            ? ` · ${escapeHtml(perfilActual.email)}`
            : ""
          }
        </span>
      </div>

      <button
        type="button"
        id="salirModoAdminImpersonacion"
        class="secundario"
      >
        Salir de este usuario
      </button>
    `;

    const main =
      document.querySelector("main");

    if (main) {
      main.prepend(barra);
    } else {
      document.body.prepend(barra);
    }

    document
      .getElementById(
        "salirModoAdminImpersonacion"
      )
      ?.addEventListener(
        "click",
        salirModoAdmin
      );

    return true;
  }

  /*
    obtenerPerfil() es asíncrono. Esperamos únicamente
    hasta que perfilActual esté disponible.
  */
  let intentos = 0;

  const timer =
    setInterval(() => {
      intentos += 1;

      if (
        mostrarModoAdmin() ||
        intentos >= 100
      ) {
        clearInterval(timer);
      }
    }, 100);
})();
// === FIN_MODO_ADMIN_IMPERSONACION_V1 ===


// === GESTION_PROPUESTA_PENDIENTE_UNIDAD_V1 ===

function itemEsPropuestaPendienteUnidad(
  item
) {
  const d =
    item?.data || item || {};

  return (
    item?.tipoListado === "PROPUESTA" &&
    String(
      item?.estado ||
      d.estado ||
      ""
    ).toUpperCase() ===
      "PENDIENTE_VALIDACION"
  );
}


function botonesGestionPropuestaPendienteUnidad(
  item
) {
  if (
    !itemEsPropuestaPendienteUnidad(
      item
    )
  ) {
    return "";
  }

  const d =
    item?.data || {};

  const id =
    d.id ||
    item.id ||
    "";

  if (!id) {
    return "";
  }

  return `
    <a
      class="btn secundario btn-modificar-pendiente-unidad"
      href="nueva-itinerancia.html?id=${encodeURIComponent(id)}"
    >
      Modificar
    </a>

    <button
      type="button"
      class="btn peligro btn-eliminar-pendiente-unidad"
      onclick="eliminarPropuestaPendienteUnidad('${escapeHtml(id)}')"
    >
      Eliminar propuesta
    </button>
  `;
}


window.eliminarPropuestaPendienteUnidad =
  async function eliminarPropuestaPendienteUnidad(
    id
  ) {
    const propuesta =
      (propuestasActuales || [])
        .find(
          p =>
            String(p.id) ===
            String(id)
        );

    if (!propuesta) {
      mostrarMsg(
        "No se ha encontrado la propuesta pendiente.",
        true
      );
      return;
    }

    if (
      String(
        propuesta.estado || ""
      ).toUpperCase() !==
      "PENDIENTE_VALIDACION"
    ) {
      mostrarMsg(
        "Esta propuesta ya no está pendiente y no puede eliminarse desde aquí.",
        true
      );
      return;
    }

    /*
      Protección multiunidad:
      solo actuamos sobre la unidad que está
      actualmente seleccionada.
    */
    if (
      perfilActual?.unidad_id &&
      propuesta.unidad_id &&
      String(
        perfilActual.unidad_id
      ) !==
      String(
        propuesta.unidad_id
      )
    ) {
      mostrarMsg(
        "La propuesta no pertenece a la unidad de trabajo seleccionada.",
        true
      );
      return;
    }

    const titulo =
      propuesta.titulo ||
      propuesta.municipio ||
      "esta propuesta";

    const ok1 =
      confirm(
        "¿Quieres eliminar esta propuesta pendiente?\n\n" +
        titulo +
        "\n\n" +
        "Desaparecerá del listado de pendientes."
      );

    if (!ok1) {
      return;
    }

    const ok2 =
      confirm(
        "Confirma la eliminación de la propuesta.\n\n" +
        "No se borrará físicamente: quedará archivada para conservar la trazabilidad."
      );

    if (!ok2) {
      return;
    }

    try {
      const cliente =
        typeof supabaseClient !==
        "undefined"
          ? supabaseClient
          : window.supabaseClient;

      if (!cliente) {
        throw new Error(
          "No se ha localizado el cliente de Supabase."
        );
      }

      let consulta =
        cliente
          .from(
            "itinerancias_propuestas"
          )
          .update({
            estado:
              "ARCHIVADA",

            updated_at:
              new Date().toISOString()
          })
          .eq(
            "id",
            id
          )
          .eq(
            "estado",
            "PENDIENTE_VALIDACION"
          );

      if (
        perfilActual?.unidad_id
      ) {
        consulta =
          consulta.eq(
            "unidad_id",
            perfilActual.unidad_id
          );
      }

      const {
        data,
        error
      } =
        await consulta
          .select("id");

      if (error) {
        throw error;
      }

      if (
        !Array.isArray(data) ||
        !data.length
      ) {
        throw new Error(
          "La propuesta no se ha modificado. Puede que su estado o unidad hayan cambiado."
        );
      }

      propuestasActuales =
        (propuestasActuales || [])
          .filter(
            p =>
              String(p.id) !==
              String(id)
          );

      mostrarMsg(
        "Propuesta pendiente eliminada correctamente. Se ha conservado como archivada."
      );

      if (
        typeof renderPanelUnificado ===
        "function"
      ) {
        renderPanelUnificado();
      } else {
        window.location.reload();
      }

    } catch (err) {
      console.error(err);

      mostrarMsg(
        "No se ha podido eliminar la propuesta pendiente: " +
        (
          err.message ||
          err
        ),
        true
      );
    }
  };


function instalarGestionPropuestasPendientesUnidad() {
  if (
    typeof accionesItemUnificado !==
    "function"
  ) {
    console.warn(
      "No se ha localizado accionesItemUnificado para instalar la gestión de pendientes."
    );
    return;
  }

  if (
    accionesItemUnificado
      .__gestionPendientesUnidadWrapped
  ) {
    return;
  }

  const original =
    accionesItemUnificado;

  const envuelta =
    function accionesItemUnificadoConGestionPendientes(
      item
    ) {
      const htmlOriginal =
        original.call(
          this,
          item
        ) || "";

      if (
        !itemEsPropuestaPendienteUnidad(
          item
        )
      ) {
        return htmlOriginal;
      }

      /*
        PENDIENTE_VALIDACION no tenía acciones
        en la función original.
      */
      return (
        htmlOriginal +
        botonesGestionPropuestaPendienteUnidad(
          item
        )
      );
    };

  envuelta
    .__gestionPendientesUnidadWrapped =
      true;

  accionesItemUnificado =
    envuelta;
}


instalarGestionPropuestasPendientesUnidad();

// === FIN_GESTION_PROPUESTA_PENDIENTE_UNIDAD_V1 ===
